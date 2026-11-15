import type { FastifyInstance } from "fastify";
import type { Deps } from "../deps";
import { billingRoutes } from "./billing";
import { accountRoutes } from "./account";
import { learningRoutes } from "./learning";

/** Learner-facing routes beyond the live session: billing, account/privacy, appeals, learning. */
export function extraRoutes(app: FastifyInstance, deps: Deps): void {
  billingRoutes(app, deps);
  accountRoutes(app, deps);
  learningRoutes(app, deps);
}
