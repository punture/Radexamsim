import { randomToken } from "../auth/crypto";

/**
 * Single-use, short-lived WebSocket tickets issued over authenticated HTTP. The browser
 * presents the ticket when opening the socket, so session cookies never need to cross
 * origins. In-memory: a multi-instance deployment must route a session's sockets to one
 * instance (sticky routing) — see docs/ARCHITECTURE.md.
 */
type Ticket = { userId: string; sessionId: string; expiresAt: number };

export class TicketStore {
  private readonly tickets = new Map<string, Ticket>();
  constructor(private readonly ttlMs = 60_000) {}

  issue(userId: string, sessionId: string): string {
    this.sweep();
    const t = randomToken(24);
    this.tickets.set(t, { userId, sessionId, expiresAt: Date.now() + this.ttlMs });
    return t;
  }

  redeem(ticket: string): Ticket | null {
    const t = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!t || t.expiresAt < Date.now()) return null;
    return t;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.tickets) if (v.expiresAt < now) this.tickets.delete(k);
  }
}
