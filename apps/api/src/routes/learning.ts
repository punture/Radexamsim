import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SKILL_LABELS, type SkillId } from "@sim/contracts";
import { and, caseAttempts, caseVersions, desc, eq, isNull, learningPlans, skillObservations, users } from "@sim/db";
import { applyPlanPreferences } from "@sim/ai";
import type { Deps } from "../deps";
import { HttpError, notFound, route } from "../http";
import { createStationSession } from "../services/sessions";

/**
 * Learning plans and progress (spec §12). Trends report their evidence (observation counts,
 * case-family diversity) and keep exam/practice, first/repeat exposure, assisted/unassisted
 * and assessable/uncertain separate. No pass probabilities are shown.
 */
export function learningRoutes(app: FastifyInstance, deps: Deps): void {
  const { db } = deps;

  route(app, {
    method: "GET",
    url: "/api/learning/plan",
    summary: "Current learning plan (opaque assignment tokens only)",
    tags: ["learning"],
    auth: "user",
    handler: async ({ auth }) => {
      const [row] = await db.select().from(learningPlans).where(and(eq(learningPlans.userId, auth!.userId), isNull(learningPlans.supersededAt))).orderBy(desc(learningPlans.createdAt)).limit(1);
      const [u] = await db.select({ pace: users.planPace }).from(users).where(eq(users.id, auth!.userId));
      const pace = u?.pace ?? "standard";
      return { plan: row ? applyPlanPreferences(row.payload, pace, row.itemStates) : null, pace };
    },
  });

  route(app, {
    method: "PUT",
    url: "/api/learning/preferences",
    summary: "Set the learner's plan pace (spacing between plan items)",
    tags: ["learning"],
    auth: "user",
    body: z.object({ pace: z.enum(["compressed", "standard", "relaxed"]) }),
    handler: async ({ auth, body }) => {
      await db.update(users).set({ planPace: body.pace }).where(eq(users.id, auth!.userId));
      return { pace: body.pace };
    },
  });

  route(app, {
    method: "POST",
    url: "/api/learning/plan/items/:itemId/status",
    summary: "Record progress on a plan item (the generated plan itself is not edited)",
    tags: ["learning"],
    auth: "user",
    params: z.object({ itemId: z.string().min(1).max(80) }),
    body: z.object({ status: z.enum(["suggested", "started", "completed", "skipped"]) }),
    handler: async ({ auth, params, body }) => {
      const [row] = await db.select().from(learningPlans).where(and(eq(learningPlans.userId, auth!.userId), isNull(learningPlans.supersededAt))).orderBy(desc(learningPlans.createdAt)).limit(1);
      if (!row || !row.payload.items.some((it) => it.id === params.itemId)) throw notFound("plan item");
      await db.update(learningPlans).set({ itemStates: { ...row.itemStates, [params.itemId]: body.status } }).where(eq(learningPlans.id, row.id));
      return { itemId: params.itemId, status: body.status };
    },
  });

  route(app, {
    method: "POST",
    url: "/api/learning/plan/start",
    summary: "Start the practice station for a plan item (resolves the opaque assignment server-side)",
    tags: ["learning"],
    auth: "user",
    body: z.object({ assignmentToken: z.string().regex(/^as_[a-f0-9]{24}$/), profileVersionId: z.string() }),
    handler: async ({ auth, body }) => {
      const [row] = await db.select().from(learningPlans).where(and(eq(learningPlans.userId, auth!.userId), isNull(learningPlans.supersededAt))).orderBy(desc(learningPlans.createdAt)).limit(1);
      const caseId = row?.assignments[body.assignmentToken];
      if (!caseId) throw notFound("assignment");
      return createStationSession(deps, auth!, { profileVersionId: body.profileVersionId, mode: "practice", inputMode: "voice", caseCount: 1, assignedCaseIds: [caseId] });
    },
  });

  route(app, {
    method: "GET",
    url: "/api/learning/progress",
    summary: "Skill trends with denominators, separated by mode/exposure/assistance",
    tags: ["learning"],
    auth: "user",
    handler: async ({ auth }) => {
      const obs = await db.select().from(skillObservations).where(and(eq(skillObservations.userId, auth!.userId), eq(skillObservations.superseded, false)));
      const assessable = (s: string) => s !== "not_assessable" && s !== "uncertain";
      const skills = Object.keys(SKILL_LABELS) as SkillId[];
      const bucket = (rows: typeof obs) => {
        const a = rows.filter((r) => assessable(r.status));
        const credited = a.filter((r) => r.status === "demonstrated" && !r.assisted).length;
        return { observations: a.length, credited, uncertainOrNotAssessable: rows.length - a.length, caseFamilies: new Set(a.map((r) => r.caseFamilyId)).size };
      };
      const perSkill = skills.map((skill) => {
        const rows = obs.filter((o) => o.skill === skill && !o.isFixture);
        const fixtureRows = obs.filter((o) => o.skill === skill && o.isFixture);
        return {
          skill,
          label: SKILL_LABELS[skill],
          exam: bucket(rows.filter((r) => r.mode === "exam")),
          practice: bucket(rows.filter((r) => r.mode === "practice")),
          firstExposure: bucket(rows.filter((r) => r.firstExposure)),
          repeatExposure: bucket(rows.filter((r) => !r.firstExposure)),
          developmentFixtures: bucket(fixtureRows),
        };
      });
      const attempts = await db
        .select({ payload: caseVersions.payload, isFixture: caseVersions.isFixture })
        .from(caseAttempts)
        .innerJoin(caseVersions, eq(caseVersions.versionId, caseAttempts.caseVersionId))
        .where(and(eq(caseAttempts.userId, auth!.userId), eq(caseAttempts.status, "closed")));
      const coverage: Record<string, number> = {};
      const fixtureCoverage: Record<string, number> = {};
      for (const a of attempts) for (const t of a.payload.tags.anatomy) (a.isFixture ? fixtureCoverage : coverage)[t] = ((a.isFixture ? fixtureCoverage : coverage)[t] ?? 0) + 1;
      return {
        note: "Trends are descriptive and based on the counts shown. One attempt is a signal, not a stable trait; repeated exposure to the same case is not evidence of transfer to new cases. Development-fixture results are shown separately and excluded from trends.",
        perSkill,
        anatomyCoverage: coverage,
        fixtureAnatomyCoverage: fixtureCoverage,
      };
    },
  });

  route(app, {
    method: "GET",
    url: "/api/learning/practice-recommendation",
    summary: "Practice targeting from the learner's weakest skill (deterministic)",
    tags: ["learning"],
    auth: "user",
    handler: async ({ auth }) => {
      const [row] = await db.select().from(learningPlans).where(and(eq(learningPlans.userId, auth!.userId), isNull(learningPlans.supersededAt))).orderBy(desc(learningPlans.createdAt)).limit(1);
      if (!row) throw new HttpError(404, "no_plan", "complete a station first");
      return { focusSkills: row.payload.focusSkills };
    },
  });
}
