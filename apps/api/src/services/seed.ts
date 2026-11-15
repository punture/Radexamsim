import type { CaseVersion } from "@sim/contracts";
import { ALL_PROFILES, computeContentHashes, validateCaseVersion } from "@sim/clinical-content";
import { allotPeriod } from "@sim/billing";
import { caseVersions, cases, contentRequests, entitlements, eq, examProfiles, systemConfig, users, type Db } from "@sim/db";
import { loadFixtureCases } from "@sim/fixtures";
import { encryptSecret, hashPassword, newTotpSecret } from "../auth/crypto";

/**
 * Development seed. Everything it creates is labelled: fixture cases are fictional with
 * placeholder images, the dev "approval" is explicitly NOT a clinical approval, and the dev
 * minute allotment is not a paid entitlement.
 */
export type SeedOptions = {
  ownerEmail: string;
  ownerPassword: string;
  learnerEmail: string;
  learnerPassword: string;
  encryptionKey: string;
  /** Fixture case ids to auto-publish; others are left ready_for_owner. */
  publishFixtures: string[];
  learnerMinutes: number;
};

export const DEFAULT_SEED: SeedOptions = {
  ownerEmail: "owner@example.test",
  ownerPassword: "owner-dev-password-123",
  learnerEmail: "learner@example.test",
  learnerPassword: "learner-dev-password-123",
  encryptionKey: "dev-only-encryption-key-change-me-0000000000",
  publishFixtures: ["fx-stroke-lmca", "fx-spine-cord-compression"],
  learnerMinutes: 300,
};

const FIRST_TEN_REQUESTS = [
  { slot: "first-10-01", title: "Common brain: acute ischemic stroke (CT/CTA ± MRI)", categories: ["brain", "urgent", "common"] },
  { slot: "first-10-02", title: "Urgent: acute intracranial hemorrhage or subarachnoid hemorrhage with aneurysm", categories: ["brain", "urgent"] },
  { slot: "first-10-03", title: "Common brain: extra-axial mass (e.g. meningioma) vs intra-axial tumour", categories: ["brain", "common"] },
  { slot: "first-10-04", title: "Common brain: demyelinating disease (MS) with differential", categories: ["brain", "common"] },
  { slot: "first-10-05", title: "Urgent spine: cord compression (metastatic or epidural abscess)", categories: ["spine", "urgent"] },
  { slot: "first-10-06", title: "Spine: degenerative vs infective discitis/osteomyelitis", categories: ["spine"] },
  { slot: "first-10-07", title: "Head and neck: deep neck space infection or retropharyngeal process", categories: ["head_and_neck", "urgent"] },
  { slot: "first-10-08", title: "Head and neck: neoplasm with nodal staging (e.g. oropharyngeal SCC)", categories: ["head_and_neck"] },
  { slot: "first-10-09", title: "Appropriately uncertain case: image-limited differential (e.g. ring-enhancing lesion)", categories: ["brain", "uncertain"] },
  { slot: "first-10-10", title: "Stack-based case using de-identified DICOM (if suitable source data exists)", categories: ["dicom", "stack"] },
];

export async function seedDev(db: Db, opts: SeedOptions = DEFAULT_SEED): Promise<{ ownerId: string; learnerId: string; ownerTotpSecret: string }> {
  for (const p of ALL_PROFILES) {
    await db.insert(examProfiles).values({ versionId: p.versionId, profileId: p.profileId, payload: p }).onConflictDoUpdate({ target: examProfiles.versionId, set: { payload: p } });
  }

  const upsertUser = async (email: string, password: string, role: "owner" | "learner") => {
    const [existing] = await db.select().from(users).where(eq(users.email, email));
    if (existing) return existing;
    const [u] = await db.insert(users).values({ email, role, authProvider: "local", passwordHash: await hashPassword(password), displayName: role === "owner" ? "Owner (dev)" : "Learner (dev)" }).returning();
    return u!;
  };
  const owner = await upsertUser(opts.ownerEmail, opts.ownerPassword, "owner");
  const learner = await upsertUser(opts.learnerEmail, opts.learnerPassword, "learner");

  let ownerTotpSecret = "";
  if (!owner.totpSecret) {
    ownerTotpSecret = newTotpSecret();
    await db.update(users).set({ totpSecret: encryptSecret(ownerTotpSecret, opts.encryptionKey), totpEnabled: true }).where(eq(users.id, owner.id));
  }

  for (const cv of loadFixtureCases()) {
    const publish = opts.publishFixtures.includes(cv.caseId);
    const hashes = computeContentHashes(cv);
    const payload: CaseVersion = publish
      ? {
          ...cv,
          publicationStatus: "published",
          ownerApproval: {
            approvedBy: owner.id,
            approvedAt: new Date().toISOString(),
            ...hashes,
            attestation: "DEVELOPMENT FIXTURE AUTO-APPROVAL BY SEED SCRIPT — NOT A CLINICAL APPROVAL.",
            notes: "Fictional development fixture with placeholder images.",
          },
        }
      : { ...cv, publicationStatus: "ready_for_owner" };
    const v = validateCaseVersion(payload);
    if (!v.ok) throw new Error(`fixture ${cv.caseId} failed validation: ${JSON.stringify(v.issues.slice(0, 3))}`);
    await db.insert(cases).values({ caseId: cv.caseId, caseFamilyId: cv.caseFamilyId, publishedVersionId: publish ? cv.versionId : null }).onConflictDoNothing();
    await db
      .insert(caseVersions)
      .values({ versionId: cv.versionId, caseId: cv.caseId, versionNumber: cv.versionNumber, payload, publicationStatus: payload.publicationStatus, ...hashes, isFixture: true, validationIssues: v.warnings, createdBy: "seed" })
      .onConflictDoNothing();
  }

  for (const r of FIRST_TEN_REQUESTS) {
    const [exists] = await db.select().from(contentRequests).where(eq(contentRequests.slot, r.slot));
    if (!exists) {
      await db.insert(contentRequests).values({ ...r, description: "Content request: provide an approved, de-identified teaching case (images + your diagnosis and its basis) for this slot. Placeholder fixtures are never counted as clinical cases." });
    }
  }

  await db.insert(systemConfig).values({ key: "demo_case_ids", value: ["fx-stroke-lmca"] }).onConflictDoNothing();
  await db.insert(entitlements).values({ userId: learner.id, status: "active", planId: "individual_monthly" }).onConflictDoNothing();
  await db.transaction((tx) => allotPeriod(tx, learner.id, `dev-allotment:${learner.id}`, opts.learnerMinutes, "seed"));
  return { ownerId: owner.id, learnerId: learner.id, ownerTotpSecret };
}
