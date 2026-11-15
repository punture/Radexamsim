import { desc, eq, inArray, sessionEvents, stationSessions } from "@sim/db";
import type { Deps } from "../deps";
import { LiveSession } from "./session";

/**
 * In-process registry of live session controllers. A session's controller lives on one
 * API instance; multi-instance deployments need sticky routing by session id (see
 * docs/ARCHITECTURE.md). Durable state is always in PostgreSQL, so a restarted process
 * can recover any session.
 */
export class LiveRegistry {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly loading = new Map<string, Promise<LiveSession>>();
  constructor(private readonly deps: Deps) {}

  async get(sessionId: string): Promise<LiveSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    let p = this.loading.get(sessionId);
    if (!p) {
      p = LiveSession.load(this.deps, sessionId).then((s) => {
        this.sessions.set(sessionId, s);
        s.onClosed = () => {
          if (this.sessions.get(sessionId) === s) this.sessions.delete(sessionId);
        };
        return s;
      });
      this.loading.set(sessionId, p);
      p.finally(() => this.loading.delete(sessionId)).catch(() => undefined);
    }
    return p;
  }

  peek(sessionId: string): LiveSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * After a process restart, sessions that were active are paused as a PLATFORM failure
   * (clock stopped at the last durable event) so the learner loses no time.
   */
  async recoverOrphans(): Promise<number> {
    const rows = await this.deps.db.select({ id: stationSessions.id }).from(stationSessions).where(inArray(stationSessions.status, ["active"]));
    for (const r of rows) {
      const [last] = await this.deps.db.select({ t: sessionEvents.serverTime }).from(sessionEvents).where(eq(sessionEvents.sessionId, r.id)).orderBy(desc(sessionEvents.seq)).limit(1);
      const s = await this.get(r.id);
      await s.markInterruptedAfterRestart(last?.t.getTime() ?? Date.now());
    }
    return rows.length;
  }

  async shutdown(): Promise<void> {
    for (const s of this.sessions.values()) await s.drain();
  }
}
