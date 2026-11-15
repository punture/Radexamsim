import { auditEvents, type DbOrTx } from "@sim/db";

/** Audit trail without clinical text or credentials. */
export async function audit(db: DbOrTx, actorUserId: string | null, action: string, targetType: string, targetId: string, detail: Record<string, unknown> = {}): Promise<void> {
  await db.insert(auditEvents).values({ actorUserId, action, targetType, targetId, detail });
}
