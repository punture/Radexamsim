import { randomBytes, randomUUID } from "node:crypto";
import type {
  CandidateSessionState,
  CaseVersion,
  ClientMessage,
  ClockState,
  EventType,
  ExamProfileVersion,
  ExaminerProposal,
  PromptClass,
  ServerMessage,
  SessionOutcome,
  SessionStatus,
  StageState,
  UtteranceKind,
  ViewerAck,
  ViewerCommand,
  ViewerPane,
} from "@sim/contracts";
import { ClientMessage as ClientMessageSchema, decodeBinaryFrame, encodeBinaryFrame, BINARY_FRAME_MIC, BINARY_FRAME_TTS, ExaminerProposal as ExaminerProposalSchema } from "@sim/contracts";
import { caseTimeGuidanceMs } from "@sim/clinical-content";
import {
  applyReveal,
  buildExaminerMenu,
  checkReveal,
  consumedMinutes,
  cumulativeHistory,
  currentStage,
  dueWarnings,
  elapsedActiveMs,
  fallbackDecision,
  findFactReply,
  getQuestion,
  getStage,
  initialStageState,
  isRunning,
  markFactReplyDelivered,
  markQuestionDelivered,
  neutralPhrase,
  openingQuestion,
  outcomeForEndReason,
  pauseClock,
  projectCandidateAsset,
  projectCandidateAssets,
  recordRender,
  remainingMs,
  startClock,
  stopClock,
  validateProposal,
  viewerPermissionsFor,
  type ConversationTurn,
  type EndStationReason,
  type ExaminerCommand,
  type NeutralPhraseId,
} from "@sim/exam-engine";
import { NEURO_VOCABULARY, NEURO_VOCABULARY_VERSION, SpendTracker, examinerPrompt, playedCharsFromAlignment, runPrompt, type AsrStream, type TtsAlignment } from "@sim/ai";
import { consumeDemoCase, reconcileSession, reserveForSession } from "@sim/billing";
import {
  appendEvent,
  assetHandles,
  caseAttempts,
  enqueue,
  eq,
  examinerUtterances,
  isUniqueViolation,
  ownerReviewItems,
  processedCommands,
  sql,
  stationSessions,
  transcriptSegments,
  viewerCommands,
  and,
  consents,
  desc,
  type Tx,
} from "@sim/db";
import type { Deps } from "../deps";
import { POLICY_VERSION } from "../policy";
import { getCaseVersion, getProfile, getSwitches } from "../services/content";

/**
 * Live session controller (spec §7). The server owns the clock, attempt status, case order,
 * stage state, allowed actions and usage accounting. The examiner model only PROPOSES an
 * action from a menu; validated application code executes it.
 *
 * Every input (client message, ASR event, timer) is processed sequentially through a
 * per-session queue, and every state change is persisted transactionally together with
 * its durable event before the client is told about it.
 */

type SocketLike = { send(data: string | Uint8Array): void; close(code?: number, reason?: string): void; readonly readyState: number };

type AttemptRow = typeof caseAttempts.$inferSelect;

type Speaking = {
  id: string;
  kind: UtteranceKind;
  text: string;
  playedChars: number;
  started: boolean;
  alignment: TtsAlignment | null;
  after: (() => Promise<void>) | null;
  safety: NodeJS.Timeout | null;
};

type PendingViewer = {
  assetIds: string[];
  onRendered: () => Promise<void>;
  onFailed: () => Promise<void>;
  timer: NodeJS.Timeout;
};

type Current = {
  idx: number;
  attemptId: string;
  cv: CaseVersion;
  state: StageState;
  startedAtMs: number;
  handles: Record<string, string>;
  conversation: ConversationTurn[];
  heard: { utteranceId: string; heardText: string; atMs: number }[];
  layout: ViewerCommand["layout"];
  panes: ViewerPane[];
  lastCommandSeq: number;
  timeCheckDone: boolean;
  hintsGiven: Set<string>;
  candidateSpoke: boolean;
  /** Provider confidence of the most recent candidate segment in this case. */
  lastCandidateConfidence?: number | null;
};

const ACK_TIMEOUT_MS = 12_000;

export class LiveSession {
  readonly sessionId: string;
  readonly userId: string;
  private status: SessionStatus;
  private outcome: SessionOutcome | null;
  private clock: ClockState;
  private current: Current | null = null;
  private socket: SocketLike | null = null;
  private msgSeq = 0;
  private chain: Promise<void> = Promise.resolve();
  private speaking: Speaking | null = null;
  private readonly pendingViewer = new Map<string, PendingViewer>();
  private turnTimer: NodeJS.Timeout | null = null;
  private silenceTimer: NodeJS.Timeout | null = null;
  private graceTimer: NodeJS.Timeout | null = null;
  private maxPauseTimer: NodeJS.Timeout | null = null;
  private tick: NodeJS.Timeout | null = null;
  private candidateSpeaking = false;
  private explicitEndTurn = false;
  private warningsElapsedMs = 0;
  private lastClockSentAt = 0;
  private ended = false;
  private practicePaused = false;
  private asr: AsrStream | null = null;
  private asrBaseSessionMs = 0;
  private lastPauseReason: "technical_platform" | "technical_connection" | "practice_pause" | null = null;
  private readonly spend: SpendTracker;
  private readonly technicalNotes: string[] = [];
  private interacting = false;
  private viewerSeq: number;
  /** A decision requested while the examiner was speaking or images were loading. */
  private deferredTrigger: "candidate_turn_ended" | "extended_silence" | "time_check" | null = null;
  onClosed: (() => void) | null = null;

  private constructor(
    private readonly deps: Deps,
    row: typeof stationSessions.$inferSelect,
    readonly profile: ExamProfileVersion,
    private readonly caseVersions: CaseVersion[],
    private attempts: AttemptRow[],
  ) {
    this.sessionId = row.id;
    this.userId = row.userId;
    this.status = row.status;
    this.outcome = row.outcome ?? null;
    this.clock = row.clock;
    this.viewerSeq = row.viewerSeq;
    this.mode = row.mode;
    this.inputMode = row.inputMode;
    this.isDemo = (row.speechConfig as { demo?: boolean }).demo === true;
    this.spend = new SpendTracker(deps.config.SESSION_SPEND_CAP_USD);
    this.technicalNotes.push(...row.technicalNotes);
  }
  readonly mode: "exam" | "practice" | "owner_preview";
  readonly inputMode: "voice" | "typed_practice";
  private readonly isDemo: boolean;

  // ------------------------------------------------------------------ loading

  static async load(deps: Deps, sessionId: string): Promise<LiveSession> {
    const [row] = await deps.db.select().from(stationSessions).where(eq(stationSessions.id, sessionId));
    if (!row) throw new Error("session not found");
    const profile = await getProfile(deps.db, row.profileVersionId);
    const attempts = await deps.db.select().from(caseAttempts).where(eq(caseAttempts.sessionId, sessionId)).orderBy(caseAttempts.ordinal);
    const cvs = await Promise.all(attempts.map((a) => getCaseVersion(deps.db, a.caseVersionId)));
    const s = new LiveSession(deps, row, profile, cvs, attempts);
    await s.restoreCurrentCase();
    return s;
  }

  private async restoreCurrentCase(): Promise<void> {
    const active = this.attempts.find((a) => a.status === "active");
    if (!active || !active.stageState) return;
    const idx = this.attempts.indexOf(active);
    const handles = await this.deps.db.select().from(assetHandles).where(eq(assetHandles.caseAttemptId, active.id));
    const segs = await this.deps.db.select().from(transcriptSegments).where(and(eq(transcriptSegments.caseAttemptId, active.id), eq(transcriptSegments.status, "final")));
    const utts = await this.deps.db.select().from(examinerUtterances).where(eq(examinerUtterances.caseAttemptId, active.id));
    const startedAtMs = active.startedAtMs ?? 0;
    const conversation: ConversationTurn[] = [
      ...segs.map((s) => ({ speaker: "candidate" as const, text: s.text, atMs: s.endMs - startedAtMs })),
      ...utts.filter((u) => u.playedChars > 0).map((u) => ({ speaker: "examiner" as const, text: u.text.slice(0, u.playedChars), atMs: (u.playbackStartedAtMs ?? u.plannedAtMs) - startedAtMs })),
    ].sort((a, b) => a.atMs - b.atMs);
    const cv = this.caseVersions[idx]!;
    const stage = currentStage(cv, active.stageState);
    const preset = stage.defaultViewportPresetId ? cv.viewportPresets.find((p) => p.id === stage.defaultViewportPresetId) : undefined;
    const handleMap = Object.fromEntries(handles.map((h) => [h.assetId, h.handle]));
    this.current = {
      idx,
      attemptId: active.id,
      cv,
      state: active.stageState,
      startedAtMs,
      handles: handleMap,
      conversation,
      heard: utts.filter((u) => u.playedChars > 0).map((u) => ({ utteranceId: u.id, heardText: u.text.slice(0, u.playedChars), atMs: (u.playbackStartedAtMs ?? 0) - startedAtMs })),
      layout: preset?.layout ?? "single",
      panes: (preset?.panes ?? []).filter((p) => handleMap[p.assetId]).map((p, i) => ({ paneId: `p${i}`, handle: handleMap[p.assetId]!, frameIndex: p.frameIndex, zoom: p.zoom })),
      lastCommandSeq: this.viewerSeq,
      timeCheckDone: false,
      hintsGiven: new Set(),
      candidateSpoke: segs.length > 0,
    };
  }

  // ------------------------------------------------------------------ plumbing

  private enqueueWork(fn: () => Promise<void>): Promise<void> {
    const next = this.chain.then(fn).catch((err: unknown) => {
      // Technical failure is made visible without inventing any clinical result.
      this.deps.config.NODE_ENV !== "test" && console.error(`[live ${this.sessionId}]`, err instanceof Error ? err.message : err);
      this.notice("error", "server_error", "A technical problem occurred. Your work so far is saved.");
    });
    this.chain = next;
    return next;
  }

  private now(): number {
    return this.deps.now();
  }
  sessionMs(): number {
    return elapsedActiveMs(this.clock, this.now());
  }
  private caseMs(): number {
    return this.current ? Math.max(0, this.sessionMs() - this.current.startedAtMs) : 0;
  }

  private send(msg: ServerMessage): void {
    if (this.socket && this.socket.readyState === 1) this.socket.send(JSON.stringify(msg));
  }
  private nextSeq(): number {
    return ++this.msgSeq;
  }
  private notice(level: "info" | "warning" | "error", code: string, message: string): void {
    this.send({ type: "notice", seq: this.nextSeq(), level, code, message });
  }

  private contentVersions() {
    const cv = this.current?.cv ?? null;
    return { profileVersionId: this.profile.versionId, caseVersionId: cv?.versionId ?? null, rubricVersionId: cv?.rubric.versionId ?? null };
  }

  private async event(tx: Tx, type: EventType, payload: Record<string, unknown>, caseAttemptId: string | null = this.current?.attemptId ?? null): Promise<void> {
    await appendEvent(tx, { sessionId: this.sessionId, caseAttemptId, type, sessionClockMs: this.sessionMs(), payload, contentVersions: this.contentVersions() });
  }

  private async persistSession(tx: Tx, extra: Partial<typeof stationSessions.$inferInsert> = {}): Promise<void> {
    await tx
      .update(stationSessions)
      .set({ status: this.status, outcome: this.outcome, clock: this.clock, currentCaseIndex: this.current?.idx ?? 0, viewerSeq: this.viewerSeq, technicalNotes: this.technicalNotes, rowVersion: sql`${stationSessions.rowVersion} + 1`, ...extra })
      .where(eq(stationSessions.id, this.sessionId));
  }

  private async persistStage(tx: Tx): Promise<void> {
    if (!this.current) return;
    await tx.update(caseAttempts).set({ stageState: this.current.state }).where(eq(caseAttempts.id, this.current.attemptId));
  }

  private tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.deps.db.transaction(fn);
  }

  // ------------------------------------------------------------------ socket lifecycle

  attach(socket: SocketLike): void {
    void this.enqueueWork(async () => {
      if (this.socket && this.socket !== socket) {
        try {
          this.socket.send(JSON.stringify({ type: "notice", seq: this.nextSeq(), level: "warning", code: "superseded", message: "This session was opened in another window." }));
          this.socket.close(4001, "superseded");
        } catch {
          /* ignore */
        }
      }
      this.socket = socket;
      if (this.graceTimer) {
        clearTimeout(this.graceTimer);
        this.graceTimer = null;
      }
      await this.tx(async (tx) => this.event(tx, "connection.opened", {}));
      if (this.status === "technically_interrupted" && !this.ended) await this.resumeAfterInterruption();
      this.sendState();
      // Re-send any viewer commands still awaiting acknowledgement.
      for (const [commandId] of this.pendingViewer) {
        const [cmd] = await this.deps.db.select().from(viewerCommands).where(eq(viewerCommands.id, commandId));
        if (cmd) this.send({ type: "viewer_command", seq: this.nextSeq(), command: cmd.payload as unknown as ViewerCommand });
      }
      if (this.status === "active" && !this.tick) this.startTick();
    });
  }

  detach(socket: SocketLike): void {
    void this.enqueueWork(async () => {
      if (socket !== this.socket) return;
      this.socket = null;
      await this.tx(async (tx) => this.event(tx, "connection.closed", {}));
      if (this.speaking) await this.finishUtterance("interrupted", this.speaking.playedChars, "connection_lost");
      if (this.status === "active" && !this.ended) {
        const disconnectedAt = this.now();
        const graceMs = this.profile.timing.reconnectGraceSeconds * 1000;
        this.graceTimer = setTimeout(() => {
          void this.enqueueWork(() => this.technicalPause("technical_connection", disconnectedAt + graceMs));
        }, graceMs);
      }
    });
  }

  // ------------------------------------------------------------------ inbound messages

  handleText(raw: string): void {
    let parsed: ClientMessage;
    try {
      const r = ClientMessageSchema.safeParse(JSON.parse(raw));
      if (!r.success) {
        this.notice("error", "invalid_message", "Invalid message.");
        return;
      }
      parsed = r.data;
    } catch {
      this.notice("error", "invalid_message", "Invalid message.");
      return;
    }
    void this.enqueueWork(() => this.dispatch(parsed));
  }

  handleBinary(data: Uint8Array): void {
    try {
      const f = decodeBinaryFrame(data);
      if (f.frameType === BINARY_FRAME_MIC && this.asr && this.status === "active" && !this.practicePaused) this.asr.sendAudio(f.payload);
    } catch {
      /* drop malformed audio frames */
    }
  }

  private async commandSeen(commandId: string): Promise<boolean> {
    const [row] = await this.deps.db.select().from(processedCommands).where(and(eq(processedCommands.sessionId, this.sessionId), eq(processedCommands.commandId, commandId)));
    if (row) {
      this.send({ type: "command_result", commandId, ok: true, error: null });
      return true;
    }
    return false;
  }

  private async markCommand(tx: Tx, commandId: string, result: Record<string, unknown> = { ok: true }): Promise<void> {
    await tx.insert(processedCommands).values({ sessionId: this.sessionId, commandId, result }).onConflictDoNothing();
  }

  private fail(commandId: string, code: string, message: string): void {
    this.send({ type: "command_result", commandId, ok: false, error: { code, message } });
  }

  private async dispatch(m: ClientMessage): Promise<void> {
    switch (m.type) {
      case "hello":
        this.sendState();
        return;
      case "ping":
        this.send({ type: "pong", clientMs: m.clientMs, serverNowMs: this.now() });
        return;
      case "start_station":
        if (await this.commandSeen(m.commandId)) return;
        return this.startStation(m.commandId);
      case "candidate_transcript":
        if (await this.commandSeen(m.commandId)) return;
        return this.onCandidateTranscript(m);
      case "speech_activity":
        return this.onSpeechActivity(m.state === "started");
      case "end_turn":
        if (await this.commandSeen(m.commandId)) return;
        await this.tx((tx) => this.markCommand(tx, m.commandId));
        this.explicitEndTurn = true;
        this.clearTurnTimers();
        return this.decide("candidate_turn_ended");
      case "tts_playback":
        return this.onTtsPlayback(m.utteranceId, m.event, m.playedChars, m.error);
      case "viewer_ack":
        return this.onViewerAck(m.ack);
      case "viewer_view":
        return this.onViewerView(m.samples);
      case "viewer_interaction":
        this.interacting = m.active;
        return;
      case "request_end_case":
        if (await this.commandSeen(m.commandId)) return;
        await this.tx((tx) => this.markCommand(tx, m.commandId));
        this.explicitEndTurn = true;
        return this.decide("candidate_turn_ended");
      case "request_end_station":
        if (await this.commandSeen(m.commandId)) return;
        await this.tx((tx) => this.markCommand(tx, m.commandId));
        if (this.status === "ready" || this.status === "preflight") return this.abort();
        return this.endStation("candidate_ended");
      case "practice_request_hint":
        if (await this.commandSeen(m.commandId)) return;
        return this.giveHint(m.commandId);
      case "practice_pause":
      case "practice_resume":
        if (await this.commandSeen(m.commandId)) return;
        return this.practicePause(m.type === "practice_pause", m.commandId);
      case "audio_start":
        // Server speech recognition processes microphone audio: explicit consent required.
        if (!(await this.hasConsent(["microphone_processing"]))) {
          this.notice("error", "consent_required", "Consent to microphone processing is required before audio can be processed.");
          return;
        }
        return this.openServerAsr(m.sampleRate);
      case "audio_stop":
        this.asr?.finalize();
        return;
    }
  }

  // ------------------------------------------------------------------ station start / end

  private async startStation(commandId: string): Promise<void> {
    if (this.status === "active") {
      this.send({ type: "command_result", commandId, ok: true, error: null });
      return;
    }
    if (this.status !== "ready") return this.fail(commandId, "not_ready", "Complete the preflight checks first.");
    const minutes = Math.ceil(this.profile.station.durationSeconds / 60);
    const result = await this.tx(async (tx) => {
      const locked = await tx.execute<{ status: string }>(sql`SELECT status FROM station_sessions WHERE id = ${this.sessionId} FOR UPDATE`);
      if (locked.rows[0]?.status !== "ready") return { ok: false as const, code: "not_ready", message: "Session is not ready." };
      if (this.mode !== "owner_preview") {
        if (this.isDemo) {
          if (!(await consumeDemoCase(tx, this.userId))) return { ok: false as const, code: "demo_used", message: "The free demonstration has already been used." };
        } else if (this.deps.config.BILLING_ENFORCED) {
          const r = await reserveForSession(tx, this.userId, this.sessionId, minutes);
          if (!r.ok) return { ok: false as const, code: r.code, message: r.message };
          await this.event(tx, "usage.reserved", { minutes }, null);
        }
      }
      this.clock = startClock(this.clock, this.now());
      this.status = "active";
      await this.persistSession(tx, { startedAt: new Date() });
      await this.event(tx, "session.started", { mode: this.mode, caseCount: this.attempts.length }, null);
      await this.markCommand(tx, commandId);
      return { ok: true as const };
    });
    if (!result.ok) return this.fail(commandId, result.code, result.message);
    this.send({ type: "command_result", commandId, ok: true, error: null });
    this.startTick();
    await this.startCase(0);
  }

  private async abort(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.status = "aborted";
    this.outcome = "user_aborted";
    await this.tx(async (tx) => {
      await this.persistSession(tx, { endedAt: new Date() });
      await this.event(tx, "session.ended", { reason: "user_aborted_before_start" }, null);
    });
    this.send({ type: "station_ended", seq: this.nextSeq(), outcome: "user_aborted" });
    this.cleanup();
  }

  private async startCase(idx: number): Promise<void> {
    const cv = this.caseVersions[idx];
    const attempt = this.attempts[idx];
    if (!cv || !attempt) return this.endStation("all_cases_complete");
    const state = initialStageState(cv);
    const startedAtMs = this.sessionMs();
    const assetIds = getStage(cv, state.currentStageId).assetIds;
    const handles: Record<string, string> = {};
    for (const a of assetIds) handles[a] = `h_${randomBytes(16).toString("hex")}`;
    const stage = currentStage(cv, state);
    const preset = stage.defaultViewportPresetId ? cv.viewportPresets.find((p) => p.id === stage.defaultViewportPresetId) : undefined;
    this.current = {
      idx,
      attemptId: attempt.id,
      cv,
      state,
      startedAtMs,
      handles,
      conversation: [],
      heard: [],
      layout: preset?.layout ?? "single",
      panes: [],
      lastCommandSeq: this.viewerSeq,
      timeCheckDone: false,
      hintsGiven: new Set(),
      candidateSpoke: false,
    };
    await this.tx(async (tx) => {
      await tx.update(caseAttempts).set({ status: "active", stageState: state, startedAtMs }).where(eq(caseAttempts.id, attempt.id));
      if (assetIds.length) {
        await tx.insert(assetHandles).values(assetIds.map((a) => ({ handle: handles[a]!, userId: this.userId, sessionId: this.sessionId, caseAttemptId: attempt.id, caseVersionId: cv.versionId, assetId: a })));
      }
      await this.persistSession(tx);
      await this.event(tx, "case.started", { ordinal: idx, caseVersionId: cv.versionId });
      await this.event(tx, "stage.revealed", { stageId: state.currentStageId, assetIds, via: "case_start" });
    });
    this.attempts[idx] = { ...attempt, status: "active", stageState: state, startedAtMs };
    this.sendState();
    await this.sendViewerCommand({
      kind: "load_assets",
      newAssetIds: assetIds,
      presetId: stage.defaultViewportPresetId,
      awaitAck: true,
      onRendered: () => this.speakOpening(),
      onFailed: () => this.speakOpening(),
    });
  }

  private async speakOpening(): Promise<void> {
    if (!this.current) return;
    const { cv } = this.current;
    const q = openingQuestion(cv, this.current.state);
    const history = getStage(cv, this.current.state.currentStageId).candidateHistory.trim();
    const invitation = q?.text ?? neutralPhrase("n_opening_generic").text;
    if (q) {
      this.current.state = markQuestionDelivered(cv, this.current.state, q.id);
      await this.tx((tx) => this.persistStage(tx));
    }
    await this.speak({
      kind: "opening",
      refId: q?.id ?? "n_opening_generic",
      promptClass: q?.promptClass ?? "neutral",
      text: history ? `${history} ${invitation}` : invitation,
      targets: q?.targetElementIds ?? [],
      supplies: q?.suppliesElementIds ?? [],
    });
  }

  private async closeCase(reason: "examiner_completed" | "time_expired" | "candidate_requested" | "station_ended" | "technical_failure"): Promise<void> {
    const cur = this.current;
    if (!cur) return;
    this.clearTurnTimers();
    this.deferredTrigger = null;
    const endedAtMs = this.sessionMs();
    await this.tx(async (tx) => {
      await tx.update(caseAttempts).set({ status: "closed", endedAtMs, closeReason: reason, stageState: cur.state }).where(eq(caseAttempts.id, cur.attemptId));
      await this.event(tx, "case.closed", { reason, ordinal: cur.idx });
      await enqueue(tx, { kind: "assess_case_attempt", payload: { caseAttemptId: cur.attemptId }, dedupeKey: `assess:${cur.attemptId}:v1`, maxAttempts: 6 });
    });
    this.attempts[cur.idx] = { ...this.attempts[cur.idx]!, status: "closed", endedAtMs, closeReason: reason };
    this.current = null;
  }

  private async nextCaseOrEnd(): Promise<void> {
    const nextIdx = this.attempts.findIndex((a) => a.status === "pending");
    if (nextIdx >= 0 && remainingMs(this.clock, this.now()) > 30_000) return this.startCase(nextIdx);
    return this.endStation(nextIdx >= 0 ? "time_expired" : "all_cases_complete");
  }

  async endStation(reason: EndStationReason): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    if (this.speaking) {
      // Ended mid-utterance (for example, the candidate ended the station): record what was
      // played so far as interrupted, so no utterance is left "playing". Nothing follows it.
      const sp = this.speaking;
      sp.after = null;
      this.deferredTrigger = null;
      this.send({ type: "examiner_cancel", seq: this.nextSeq(), utteranceId: sp.id, reason: "station_ended" });
      await this.finishUtterance("interrupted", sp.playedChars, "station_ended");
    }
    if (this.current) {
      const map = { time_expired: "time_expired", candidate_ended: "candidate_requested", technical_invalidation: "technical_failure", all_cases_complete: "station_ended", user_aborted: "candidate_requested" } as const;
      await this.closeCase(map[reason]);
    }
    this.clock = stopClock(this.clock, this.now());
    this.status = "finalizing";
    this.outcome = outcomeForEndReason(reason);
    const platformFailure = reason === "technical_invalidation" && this.lastPauseReason === "technical_platform";
    await this.tx(async (tx) => {
      await tx.execute(sql`SELECT id FROM station_sessions WHERE id = ${this.sessionId} FOR UPDATE`);
      if (this.mode !== "owner_preview") {
        const r = await reconcileSession(tx, this.userId, this.sessionId, consumedMinutes(this.clock, this.now()), { platformFailure });
        if (r.released > 0) await this.event(tx, "usage.consumed", { consumedMinutes: r.consumed, releasedMinutes: r.released, adjustedMinutes: r.adjusted }, null);
      }
      // Pending cases that never started are closed without assessment.
      await tx.update(caseAttempts).set({ status: "closed", closeReason: "station_ended" }).where(and(eq(caseAttempts.sessionId, this.sessionId), eq(caseAttempts.status, "pending")));
      await this.persistSession(tx, { endedAt: new Date() });
      await this.event(tx, "session.ended", { reason, outcome: this.outcome, activeMs: elapsedActiveMs(this.clock, this.now()) }, null);
      await enqueue(tx, { kind: "build_session_debrief", payload: { sessionId: this.sessionId }, dedupeKey: `debrief:${this.sessionId}:v1`, maxAttempts: 30, runAt: new Date(Date.now() + 3000) });
      if (reason === "technical_invalidation") {
        await tx
          .insert(ownerReviewItems)
          .values({
            kind: "technical_failure_adjustment",
            priority: platformFailure ? "digest" : "normal",
            title: platformFailure ? "Session invalidated by platform failure (minutes credited automatically)" : "Session invalidated after connection loss",
            detail: platformFailure ? "Usage was restored automatically." : "The learner's connection was lost beyond the allowed pause. Review whether to credit minutes.",
            refs: { sessionId: this.sessionId, userId: this.userId },
            dedupeKey: `invalidated:${this.sessionId}`,
          })
          .onConflictDoNothing();
      }
    });
    this.send({ type: "station_ended", seq: this.nextSeq(), outcome: this.outcome! });
    this.sendState();
    this.cleanup();
  }

  private cleanup(): void {
    this.clearTurnTimers();
    for (const t of [this.graceTimer, this.maxPauseTimer]) if (t) clearTimeout(t);
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
    for (const p of this.pendingViewer.values()) clearTimeout(p.timer);
    this.pendingViewer.clear();
    if (this.speaking?.safety) clearTimeout(this.speaking.safety);
    this.asr?.close();
    this.asr = null;
    setTimeout(() => this.onClosed?.(), 30_000).unref();
  }

  // ------------------------------------------------------------------ clock, pauses

  private startTick(): void {
    if (this.tick) return;
    this.tick = setInterval(() => void this.enqueueWork(() => this.onTick()), 1000);
    this.tick.unref();
  }

  private async onTick(): Promise<void> {
    if (this.ended || this.status !== "active") return;
    const now = this.now();
    const el = elapsedActiveMs(this.clock, now);
    for (const w of dueWarnings(this.clock.durationMs, this.profile.station.timeWarningsAtSecondsRemaining, this.warningsElapsedMs, el)) {
      await this.tx((tx) => this.event(tx, "session.time_warning", { secondsRemaining: w }, null));
      this.notice("warning", "time_warning", w >= 60 ? `${Math.round(w / 60)} minute${w >= 120 ? "s" : ""} remaining` : `${w} seconds remaining`);
    }
    this.warningsElapsedMs = el;
    if (remainingMs(this.clock, now) <= 0 && this.profile.station.hardStop) return this.timeExpired();
    if (now - this.lastClockSentAt > 5000) this.sendClock();
    const cur = this.current;
    if (cur && !cur.timeCheckDone && !this.speaking && this.pendingViewer.size === 0) {
      const guidance = caseTimeGuidanceMs(this.profile, this.attempts.length);
      if (this.caseMs() >= guidance) {
        cur.timeCheckDone = true;
        await this.decide("time_check");
      }
    }
  }

  private sendClock(): void {
    this.lastClockSentAt = this.now();
    this.send({ type: "clock", remainingMs: remainingMs(this.clock, this.now()), running: isRunning(this.clock), serverNowMs: this.now() });
  }

  private async timeExpired(): Promise<void> {
    if (this.ended) return;
    this.clock = stopClock(this.clock, this.now());
    if (this.speaking) {
      this.send({ type: "examiner_cancel", seq: this.nextSeq(), utteranceId: this.speaking.id, reason: "time_expired" });
      await this.finishUtterance("interrupted", this.speaking.playedChars, "time_expired");
    }
    await this.speak({ kind: "closing", refId: "n_time_up_station", promptClass: "neutral", text: neutralPhrase("n_time_up_station").text, targets: [], supplies: [], after: () => this.endStation("time_expired"), maxWaitMs: 8000 });
  }

  private async technicalPause(reason: "technical_connection" | "technical_platform", effectiveAtWall: number): Promise<void> {
    if (this.status !== "active" || this.ended) return;
    this.clock = pauseClock(this.clock, this.now(), reason, effectiveAtWall);
    this.lastPauseReason = reason;
    this.status = "technically_interrupted";
    this.clearTurnTimers();
    await this.tx(async (tx) => {
      await this.persistSession(tx);
      await this.event(tx, "session.technical_pause", { reason }, null);
    });
    this.notice("warning", "technical_pause", reason === "technical_platform" ? "A technical problem paused the examination. Your time is protected." : "Connection lost. The examination is paused.");
    if (this.maxPauseTimer) clearTimeout(this.maxPauseTimer);
    this.maxPauseTimer = setTimeout(() => void this.enqueueWork(() => this.endStation("technical_invalidation")), this.profile.timing.maxTechnicalPauseSeconds * 1000);
    this.maxPauseTimer.unref();
  }

  private async resumeAfterInterruption(): Promise<void> {
    if (this.maxPauseTimer) clearTimeout(this.maxPauseTimer);
    this.maxPauseTimer = null;
    this.clock = startClock(this.clock, this.now());
    this.status = "active";
    await this.tx(async (tx) => {
      await this.persistSession(tx);
      await this.event(tx, "session.resumed", {}, null);
    });
    this.startTick();
    if (this.current) await this.speak({ kind: "technical", refId: "n_technical_resume", promptClass: "neutral", text: neutralPhrase("n_technical_resume").text, targets: [], supplies: [] });
  }

  /** Called on server start for sessions left active by a crashed process (platform failure). */
  async markInterruptedAfterRestart(lastEventWallMs: number): Promise<void> {
    if (this.status !== "active") return;
    await this.technicalPause("technical_platform", lastEventWallMs);
  }

  private async practicePause(pause: boolean, commandId: string): Promise<void> {
    if (this.mode !== "practice" || !this.profile.prompting.practice.allowPause) return this.fail(commandId, "not_allowed", "Pausing is only available in practice mode.");
    if (pause && !this.practicePaused) {
      this.clock = pauseClock(this.clock, this.now(), "practice_pause");
      this.practicePaused = true;
    } else if (!pause && this.practicePaused) {
      this.clock = startClock(this.clock, this.now());
      this.practicePaused = false;
    }
    await this.tx(async (tx) => {
      await this.persistSession(tx);
      await this.markCommand(tx, commandId);
    });
    this.send({ type: "command_result", commandId, ok: true, error: null });
    this.sendState();
  }

  // ------------------------------------------------------------------ candidate speech

  /** Latest consent of each kind must be granted under the current policy version. */
  private async hasConsent(kinds: ("microphone_processing" | "browser_speech_vendor")[]): Promise<boolean> {
    const rows = await this.deps.db.select().from(consents).where(eq(consents.userId, this.userId)).orderBy(desc(consents.createdAt));
    return kinds.every((k) => {
      const latest = rows.find((r) => r.kind === k);
      return !!latest && latest.granted && latest.policyVersion === POLICY_VERSION;
    });
  }

  private async onCandidateTranscript(m: Extract<ClientMessage, { type: "candidate_transcript" }>): Promise<void> {
    const allowed =
      (m.source === "client_asr" && this.deps.speech.asr === "browser") ||
      (m.source === "typed" && (this.inputMode === "typed_practice" || this.mode === "owner_preview")) ||
      (m.source === "dev_injected" && this.deps.config.ALLOW_DEV_INJECTION && this.deps.config.NODE_ENV !== "production");
    if (!allowed) return this.fail(m.commandId, "source_not_allowed", "This input source is not enabled for this session.");
    // Browser speech recognition may send audio to the browser vendor: explicit consent required.
    if (m.source === "client_asr" && !(await this.hasConsent(["microphone_processing", "browser_speech_vendor"]))) {
      return this.fail(m.commandId, "consent_required", "Consent to microphone processing and browser speech recognition is required. Update it in Account or the station setup.");
    }
    if (this.status !== "active" || !this.current || this.practicePaused) return this.fail(m.commandId, "not_active", "The examination is not active.");
    const durationMs = Math.max(0, Math.min(120_000, m.clientEndMs - m.clientStartMs));
    await this.recordCandidateSegment({
      text: m.text,
      source: m.source,
      durationMs,
      words: null,
      confidence: m.confidence,
      provider: { name: m.provider.name, model: m.provider.model, requestId: null },
      commandId: m.commandId,
    });
    this.send({ type: "command_result", commandId: m.commandId, ok: true, error: null });
  }

  private async recordCandidateSegment(s: {
    text: string;
    source: "server_asr" | "client_asr" | "typed" | "dev_injected";
    durationMs: number;
    startMs?: number;
    words: { text: string; startMs: number; endMs: number; confidence: number | null }[] | null;
    confidence: number | null;
    provider: { name: string; model: string | null; requestId: string | null };
    commandId?: string;
  }): Promise<void> {
    const cur = this.current;
    if (!cur) return;
    const endMs = this.sessionMs();
    const startMs = Math.max(cur.startedAtMs, s.startMs ?? endMs - s.durationMs);
    const [seg] = await this.tx(async (tx) => {
      const rows = await tx
        .insert(transcriptSegments)
        .values({ sessionId: this.sessionId, caseAttemptId: cur.attemptId, source: s.source, text: s.text, startMs, endMs: Math.max(startMs, endMs), words: s.words, confidence: s.confidence, provider: s.provider })
        .returning({ id: transcriptSegments.id });
      await this.event(tx, "transcript.segment_finalized", { segmentId: rows[0]!.id, source: s.source, chars: s.text.length, vocabularyVersion: s.source === "server_asr" ? NEURO_VOCABULARY_VERSION : null });
      if (s.commandId) await this.markCommand(tx, s.commandId);
      return rows;
    });
    cur.conversation.push({ speaker: "candidate", text: s.text, atMs: endMs - cur.startedAtMs });
    cur.candidateSpoke = true;
    cur.lastCandidateConfidence = s.confidence;
    this.send({ type: "transcript_echo", seq: this.nextSeq(), segmentId: seg!.id, text: s.text, interim: false });
    this.scheduleTurnEnd();
  }

  private onSpeechActivity(started: boolean): void {
    this.candidateSpeaking = started;
    if (started) {
      this.clearTurnTimers();
      if (this.speaking && this.profile.turnTaking.allowBargeIn) {
        // Barge-in: stop examiner audio; the client reports the played portion.
        this.send({ type: "examiner_cancel", seq: this.nextSeq(), utteranceId: this.speaking.id, reason: "barge_in" });
      }
    } else this.scheduleTurnEnd();
  }

  private clearTurnTimers(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.turnTimer = null;
    this.silenceTimer = null;
  }

  private scheduleTurnEnd(): void {
    this.clearTurnTimers();
    if (this.candidateSpeaking || this.ended) return;
    this.turnTimer = setTimeout(() => void this.enqueueWork(() => this.decide("candidate_turn_ended")), this.profile.turnTaking.endOfTurnSilenceMs);
    this.turnTimer.unref();
  }

  private scheduleSilence(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.ended) return;
    this.silenceTimer = setTimeout(() => void this.enqueueWork(() => this.decide("extended_silence")), this.profile.turnTaking.extendedSilenceMs);
    this.silenceTimer.unref();
  }

  private async openServerAsr(sampleRate: 16000 | 24000 | 48000): Promise<void> {
    if (this.deps.speech.asr !== "server_stream" || !this.deps.asr || this.asr) return;
    const switches = await getSwitches(this.deps.db);
    if (switches.serverAsrDisabled) {
      this.notice("error", "asr_disabled", "Speech recognition is temporarily disabled.");
      return;
    }
    this.asrBaseSessionMs = this.sessionMs();
    try {
      this.asr = await this.deps.asr.open(
        { sampleRate, vocabulary: NEURO_VOCABULARY, vocabularyVersion: NEURO_VOCABULARY_VERSION },
        {
          onSpeechStarted: () => void this.enqueueWork(async () => this.onSpeechActivity(true)),
          onInterim: (text) => {
            this.candidateSpeaking = true;
            this.send({ type: "transcript_echo", seq: this.nextSeq(), segmentId: "interim", text, interim: true });
          },
          onFinal: (seg) =>
            void this.enqueueWork(() =>
              this.recordCandidateSegment({
                text: seg.text,
                source: "server_asr",
                durationMs: seg.endMs - seg.startMs,
                startMs: this.asrBaseSessionMs + seg.startMs,
                words: seg.words?.map((w) => ({ ...w, startMs: this.asrBaseSessionMs + w.startMs, endMs: this.asrBaseSessionMs + w.endMs })) ?? null,
                confidence: seg.confidence,
                provider: { name: this.deps.asr!.name, model: this.deps.asr!.model, requestId: seg.requestId },
              }),
            ),
          onUtteranceEnd: () => void this.enqueueWork(async () => this.onSpeechActivity(false)),
          onError: (err) =>
            void this.enqueueWork(async () => {
              this.technicalNotes.push(`Speech recognition error: ${err.message.slice(0, 120)}`);
              this.asr = null;
              await this.technicalPause("technical_platform", this.now());
            }),
        },
      );
    } catch (e) {
      this.technicalNotes.push("Speech recognition could not connect.");
      await this.technicalPause("technical_platform", this.now());
      this.notice("error", "asr_unavailable", e instanceof Error ? "Speech recognition is unavailable." : "Speech recognition is unavailable.");
    }
  }

  // ------------------------------------------------------------------ examiner speech

  private async speak(u: {
    kind: UtteranceKind;
    refId: string | null;
    promptClass: PromptClass;
    text: string;
    targets: string[];
    supplies: string[];
    after?: () => Promise<void>;
    maxWaitMs?: number;
  }): Promise<void> {
    const id = randomUUID();
    const ttsMode = this.deps.speech.tts;
    const plannedAtMs = this.sessionMs();
    await this.tx(async (tx) => {
      await tx.insert(examinerUtterances).values({
        id,
        sessionId: this.sessionId,
        caseAttemptId: this.current?.attemptId ?? null,
        kind: u.kind,
        refId: u.refId,
        promptClass: u.promptClass,
        text: u.text,
        targetElementIds: u.targets,
        suppliesElementIds: u.supplies,
        plannedAtMs,
        deliveryStatus: "planned",
        ttsProvider: ttsMode === "server_stream" ? (this.deps.tts?.name ?? "server") : ttsMode,
      });
      await this.event(tx, "examiner.utterance_planned", { utteranceId: id, kind: u.kind, refId: u.refId, promptClass: u.promptClass });
      if (u.promptClass !== "neutral" || u.targets.length || u.supplies.length) {
        await this.event(tx, "prompt.recorded", { utteranceId: id, refId: u.refId, promptClass: u.promptClass, targetElementIds: u.targets, suppliesElementIds: u.supplies });
      }
    });
    const expectedMs = Math.max(4000, u.text.length * 90);
    const sp: Speaking = { id, kind: u.kind, text: u.text, playedChars: 0, started: false, alignment: null, after: u.after ?? null, safety: null };
    this.speaking = sp;
    sp.safety = setTimeout(() => {
      void this.enqueueWork(async () => {
        if (this.speaking?.id === id) {
          this.technicalNotes.push("An examiner prompt did not report playback; it was treated as not fully heard.");
          await this.finishUtterance(sp.started ? "interrupted" : "failed", sp.playedChars, "playback_timeout");
        }
      });
    }, u.maxWaitMs ?? expectedMs + 15_000);
    sp.safety.unref();
    this.send({ type: "examiner_utterance", seq: this.nextSeq(), utteranceId: id, kind: u.kind, text: u.text, tts: { mode: ttsMode, voice: null } });
    if (ttsMode === "none") {
      await this.onTtsPlayback(id, "started", 0, null);
      await this.onTtsPlayback(id, "completed", u.text.length, null);
      return;
    }
    if (ttsMode === "server_stream" && this.deps.tts) {
      const switches = await getSwitches(this.deps.db);
      if (switches.serverTtsDisabled) {
        this.notice("warning", "tts_disabled", "Examiner audio is temporarily disabled; the question is shown on screen.");
        return;
      }
      try {
        const r = await this.deps.tts.synthesize(u.text);
        sp.alignment = r.alignment;
        this.socket?.send(encodeBinaryFrame(BINARY_FRAME_TTS, { utteranceId: id, chunkIndex: 0, mime: r.mimeType, durationMs: r.durationMs, alignment: r.alignment }, r.audio));
      } catch {
        this.technicalNotes.push("Examiner audio synthesis failed; the prompt was shown as text.");
        this.notice("warning", "tts_failed", "Examiner audio failed; the question is shown on screen.");
      }
    }
  }

  private async onTtsPlayback(utteranceId: string, ev: "started" | "progress" | "completed" | "interrupted" | "failed", playedChars: number, error: string | null): Promise<void> {
    const sp = this.speaking;
    if (!sp || sp.id !== utteranceId) return; // stale report for an older utterance
    const chars = Math.max(0, Math.min(sp.text.length, playedChars));
    if (ev === "started" && !sp.started) {
      sp.started = true;
      await this.tx(async (tx) => {
        await tx.update(examinerUtterances).set({ deliveryStatus: "playing", playbackStartedAtMs: this.sessionMs() }).where(eq(examinerUtterances.id, sp.id));
        await this.event(tx, "examiner.audio_started", { utteranceId: sp.id });
      });
      return;
    }
    if (ev === "progress") {
      sp.playedChars = Math.max(sp.playedChars, chars);
      return;
    }
    if (ev === "completed") return this.finishUtterance("completed", sp.text.length, null);
    if (ev === "interrupted") return this.finishUtterance("interrupted", Math.max(sp.playedChars, chars), "barge_in");
    if (ev === "failed") return this.finishUtterance("failed", chars, error ?? "playback_failed");
  }

  private async finishUtterance(status: "completed" | "interrupted" | "failed", playedChars: number, reason: string | null): Promise<void> {
    const sp = this.speaking;
    if (!sp) return;
    this.speaking = null;
    if (sp.safety) clearTimeout(sp.safety);
    const method = status === "completed" ? "completed" : sp.alignment ? "provider_alignment" : this.deps.speech.tts === "browser" ? "browser_boundary" : "proportional_estimate";
    const played = status === "completed" ? sp.text.length : playedChars;
    const nowMs = this.sessionMs();
    await this.tx(async (tx) => {
      await tx
        .update(examinerUtterances)
        .set({ deliveryStatus: status, playedChars: played, playbackEndedAtMs: nowMs, playedPortionMethod: method, playbackStartedAtMs: sql`coalesce(${examinerUtterances.playbackStartedAtMs}, ${nowMs})` })
        .where(eq(examinerUtterances.id, sp.id));
      await this.event(tx, status === "completed" ? "examiner.audio_completed" : status === "interrupted" ? "examiner.audio_interrupted" : "examiner.audio_failed", { utteranceId: sp.id, playedChars: played, totalChars: sp.text.length, reason, method });
    });
    if (this.current && played > 0) {
      const heardText = sp.text.slice(0, played);
      this.current.conversation.push({ speaker: "examiner", text: heardText, atMs: this.caseMs() });
      this.current.heard.push({ utteranceId: sp.id, heardText, atMs: this.caseMs() });
    }
    if (sp.after) {
      await sp.after();
      return;
    }
    if (await this.runDeferredDecision()) return;
    if (status !== "interrupted") this.scheduleSilence();
  }

  private async runDeferredDecision(): Promise<boolean> {
    if (!this.deferredTrigger || this.speaking || this.pendingViewer.size > 0) return false;
    const t = this.deferredTrigger;
    this.deferredTrigger = null;
    await this.decide(t);
    return true;
  }

  // ------------------------------------------------------------------ viewer

  private async sendViewerCommand(c: {
    kind: ViewerCommand["kind"];
    newAssetIds: string[];
    presetId: string | null;
    awaitAck: boolean;
    singleAssetId?: string;
    onRendered?: () => Promise<void>;
    onFailed?: () => Promise<void>;
  }): Promise<void> {
    const cur = this.current;
    if (!cur) return;
    const cv = cur.cv;
    const preset = c.presetId ? cv.viewportPresets.find((p) => p.id === c.presetId) : undefined;
    let layout: ViewerCommand["layout"] = preset?.layout ?? cur.layout;
    let panes: ViewerPane[];
    if (c.singleAssetId) {
      layout = "single";
      panes = [{ paneId: "p0", handle: cur.handles[c.singleAssetId]!, frameIndex: null, zoom: "fit" }];
    } else if (preset) {
      panes = preset.panes.filter((p) => cur.handles[p.assetId]).map((p, i) => ({ paneId: `p${i}`, handle: cur.handles[p.assetId]!, frameIndex: p.frameIndex, zoom: p.zoom }));
    } else {
      const firstNew = c.newAssetIds[0];
      panes = firstNew ? [{ paneId: "p0", handle: cur.handles[firstNew]!, frameIndex: null, zoom: "fit" }] : cur.panes;
      if (firstNew) layout = "single";
    }
    const stageOrdinal = cur.state.revealedStageIds.length;
    const newAssets = c.newAssetIds.map((a) => projectCandidateAsset(cv.assets.find((x) => x.id === a)!, cur.handles[a]!, stageOrdinal));
    this.viewerSeq += 1;
    const command: ViewerCommand = {
      commandId: randomUUID(),
      seq: this.viewerSeq,
      caseAttemptId: cur.attemptId,
      kind: c.kind,
      layout,
      panes,
      newAssets,
      deferWhileInteracting: c.kind !== "load_assets" || cur.state.revealedStageIds.length > 1,
      awaitAck: c.awaitAck,
    };
    cur.layout = layout;
    cur.panes = panes;
    cur.lastCommandSeq = command.seq;
    await this.tx(async (tx) => {
      await tx.insert(viewerCommands).values({ id: command.commandId, sessionId: this.sessionId, caseAttemptId: cur.attemptId, seq: command.seq, kind: command.kind, payload: command as unknown as Record<string, unknown>, awaitAck: command.awaitAck });
      await this.persistSession(tx);
      await this.event(tx, "viewer.command_sent", { commandId: command.commandId, seq: command.seq, kind: command.kind, assetIds: c.newAssetIds });
    });
    if (c.awaitAck && c.newAssetIds.length) {
      const timer = setTimeout(() => {
        void this.enqueueWork(() =>
          this.onViewerAck({ commandId: command.commandId, status: "failed", panes: newAssets.map((a) => ({ handle: a.handle, status: "failed" as const, error: "acknowledgement timeout", renderMs: null })) }),
        );
      }, ACK_TIMEOUT_MS);
      timer.unref();
      this.pendingViewer.set(command.commandId, { assetIds: c.newAssetIds, onRendered: c.onRendered ?? (async () => undefined), onFailed: c.onFailed ?? (async () => undefined), timer });
    }
    this.send({ type: "viewer_command", seq: this.nextSeq(), command });
  }

  private async onViewerAck(ack: ViewerAck): Promise<void> {
    const cur = this.current;
    const pending = this.pendingViewer.get(ack.commandId);
    if (ack.status === "deferred") {
      if (pending) {
        clearTimeout(pending.timer);
        pending.timer = setTimeout(() => void this.enqueueWork(() => this.onViewerAck({ commandId: ack.commandId, status: "failed", panes: [] })), ACK_TIMEOUT_MS * 3);
        pending.timer.unref();
      }
      return;
    }
    if (!cur) return;
    const byHandle = new Map(Object.entries(cur.handles).map(([assetId, h]) => [h, assetId]));
    const results: { assetId: string; status: "rendered" | "failed"; error: string | null }[] = [];
    for (const p of ack.panes) {
      const assetId = byHandle.get(p.handle);
      if (assetId) results.push({ assetId, status: p.status, error: p.error });
    }
    if (pending && ack.status === "failed") {
      for (const a of pending.assetIds) if (!results.some((r) => r.assetId === a)) results.push({ assetId: a, status: "failed", error: "not displayed" });
    }
    const caseMs = this.caseMs();
    for (const r of results) cur.state = recordRender(cur.state, r.assetId, r.status, caseMs, r.error ?? undefined);
    await this.tx(async (tx) => {
      await tx.update(viewerCommands).set({ status: ack.status === "superseded" ? "superseded" : ack.status, ackedAt: new Date() }).where(eq(viewerCommands.id, ack.commandId));
      await this.persistStage(tx);
      for (const r of results) {
        await this.event(tx, r.status === "rendered" ? "viewer.rendered" : "viewer.render_failed", { commandId: ack.commandId, assetId: r.assetId, error: r.error });
      }
      if (ack.status === "superseded") await this.event(tx, "viewer.superseded", { commandId: ack.commandId });
    });
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingViewer.delete(ack.commandId);
    const failed = pending.assetIds.filter((a) => !results.some((r) => r.assetId === a && r.status === "rendered"));
    if (failed.length > 0) {
      this.technicalNotes.push(`${failed.length} image(s) failed to display.`);
      await this.speak({
        kind: "technical",
        refId: "n_technical_image",
        promptClass: "neutral",
        text: neutralPhrase("n_technical_image").text,
        targets: [],
        supplies: [],
        after: async () => {
          await pending.onFailed();
          if (!this.speaking) await this.runDeferredDecision();
        },
      });
      return;
    }
    await pending.onRendered();
    if (!this.speaking) await this.runDeferredDecision();
  }

  private async onViewerView(samples: { handle: string; frameIndex: number; viewedMs: number }[]): Promise<void> {
    const cur = this.current;
    if (!cur || samples.length === 0) return;
    const byHandle = new Map(Object.entries(cur.handles).map(([assetId, h]) => [h, assetId]));
    const valid = samples.filter((s) => byHandle.has(s.handle)).map((s) => ({ assetId: byHandle.get(s.handle)!, frameIndex: s.frameIndex, viewedMs: s.viewedMs }));
    if (valid.length) await this.tx((tx) => this.event(tx, "viewer.viewed", { samples: valid }));
  }

  // ------------------------------------------------------------------ examiner policy

  private async decide(trigger: "candidate_turn_ended" | "extended_silence" | "time_check" | "images_rendered" | "case_started"): Promise<void> {
    const cur = this.current;
    if (this.ended || !cur || this.status !== "active" || this.practicePaused) return;
    if (this.speaking || this.pendingViewer.size > 0) {
      // Never drop a turn: decide once the examiner has finished speaking / images are shown.
      if (trigger === "candidate_turn_ended" || trigger === "time_check" || !this.deferredTrigger) this.deferredTrigger = trigger === "images_rendered" || trigger === "case_started" ? null : trigger;
      return;
    }
    if (trigger === "candidate_turn_ended" && !cur.candidateSpoke && !this.explicitEndTurn) return;
    const lastCandidate = [...cur.conversation].reverse().find((t) => t.speaker === "candidate");
    const input = {
      cv: cur.cv,
      state: cur.state,
      mode: this.mode,
      prompting: this.mode === "practice" ? this.profile.prompting.practice : this.profile.prompting.exam,
      trigger,
      timing: {
        stationElapsedMs: this.sessionMs(),
        stationRemainingMs: remainingMs(this.clock, this.now()),
        caseElapsedMs: this.caseMs(),
        caseTimeGuidanceMs: caseTimeGuidanceMs(this.profile, this.attempts.length),
        isLastCase: this.attempts.every((a, i) => i === cur.idx || a.status === "closed"),
      },
      conversation: cur.conversation,
      secondsSinceCandidateSpoke: lastCandidate ? Math.round((this.caseMs() - lastCandidate.atMs) / 1000) : null,
      hasCandidateSpokenInCase: cur.candidateSpoke,
      explicitEndTurn: this.explicitEndTurn,
      lastCandidateConfidence: cur.lastCandidateConfidence ?? null,
    } as const;
    const menu = buildExaminerMenu(input);
    const started = performance.now();
    let proposer: "llm" | "deterministic_fallback" = "deterministic_fallback";
    let proposal: ExaminerProposal | null = null;
    let rejection: string | null = null;
    let model: string | null = null;
    const switches = await getSwitches(this.deps.db);
    if (this.deps.llm && !switches.examinerLlmDisabled) {
      const r = await runPrompt(examinerPrompt, menu.context, {
        routing: { provider: this.deps.llm, model: this.deps.examinerModel, timeoutMs: this.deps.config.EXAMINER_LLM_TIMEOUT_MS },
        spend: this.spend,
        onTelemetry: (t) => this.deps.recordModelCall(t, { sessionId: this.sessionId, caseAttemptId: cur.attemptId, caseVersionId: cur.cv.versionId }),
      });
      model = r.provenance?.model ?? null;
      if (r.ok) {
        const p = ExaminerProposalSchema.safeParse({ ...r.data, note: r.data.note.slice(0, 200) });
        if (p.success) {
          proposal = p.data;
          proposer = "llm";
        } else rejection = "schema";
      } else rejection = r.reason;
    }
    let command: ExaminerCommand | null = null;
    if (proposal) {
      const v = validateProposal(menu, proposal);
      if (v.ok) command = v.command;
      else rejection = v.reason;
    }
    let fallbackNote: string | null = null;
    if (!command) {
      const fb = fallbackDecision(menu, input);
      const v = validateProposal(menu, fb.proposal);
      command = v.ok ? v.command : { kind: "wait" };
      fallbackNote = fb.note;
      if (proposer === "llm") proposer = "deterministic_fallback";
    }
    this.explicitEndTurn = false;
    await this.tx((tx) =>
      this.event(tx, "policy.decision", {
        trigger,
        proposer,
        proposed: proposal ? { action: proposal.action, ref: proposal.ref, reason: proposal.reason, note: proposal.note } : { fallback: fallbackNote },
        accepted: rejection === null,
        rejectionReason: rejection,
        executed: command as unknown as Record<string, unknown>,
        latencyMs: Math.round(performance.now() - started),
        model,
        promptVersion: proposer === "llm" || rejection ? examinerPrompt.version : null,
      }),
    );
    await this.execute(command, trigger);
  }

  private async execute(cmd: ExaminerCommand, trigger: string): Promise<void> {
    const cur = this.current;
    if (!cur) return;
    switch (cmd.kind) {
      case "wait":
        if (trigger === "candidate_turn_ended") this.scheduleSilence();
        return;
      case "deliver_question": {
        const q = getQuestion(cur.cv, cmd.questionId);
        cur.state = markQuestionDelivered(cur.cv, cur.state, q.id);
        await this.tx((tx) => this.persistStage(tx));
        return this.speak({ kind: "question", refId: q.id, promptClass: q.promptClass, text: q.text, targets: q.targetElementIds, supplies: q.suppliesElementIds });
      }
      case "deliver_fact_reply": {
        const found = findFactReply(cur.cv, cmd.replyId);
        if (!found) return;
        const reply = found.reply;
        cur.state = markFactReplyDelivered(cur.state, reply.id);
        await this.tx((tx) => this.persistStage(tx));
        if (reply.kind === "reveal" && reply.revealsStageId) {
          return this.revealStage(reply.revealsStageId, { kind: "fact_reply", replyId: reply.id }, { kind: "fact_reply", refId: reply.id, text: reply.replyText, promptClass: reply.promptClass, supplies: reply.suppliesElementIds });
        }
        return this.speak({ kind: "fact_reply", refId: reply.id, promptClass: reply.promptClass, text: reply.replyText, targets: [], supplies: reply.suppliesElementIds });
      }
      case "say_neutral": {
        const p = neutralPhrase(cmd.phraseId);
        return this.speak({ kind: p.id.startsWith("n_clarify") ? "clarification" : "neutral", refId: p.id, promptClass: p.promptClass, text: p.text, targets: [], supplies: [] });
      }
      case "request_stage_reveal": {
        const stage = getStage(cur.cv, cmd.stageId);
        return this.revealStage(cmd.stageId, { kind: "examiner" }, { kind: "reveal_announcement", refId: stage.revealAnnouncement ? `announce:${stage.id}` : "n_new_images", text: stage.revealAnnouncement ?? neutralPhrase("n_new_images").text, promptClass: "neutral", supplies: [] });
      }
      case "set_viewport":
        return this.sendViewerCommand({ kind: "set_layout", newAssetIds: [], presetId: cmd.presetId, awaitAck: false });
      case "select_series":
        return this.sendViewerCommand({ kind: "select_series", newAssetIds: [], presetId: null, awaitAck: false, singleAssetId: cmd.assetId });
      case "advance_case": {
        const isLast = this.attempts.every((a, i) => i === cur.idx || a.status === "closed");
        const phrase: NeutralPhraseId = isLast ? "n_case_concluded" : "n_next_case";
        return this.speak({
          kind: "closing",
          refId: phrase,
          promptClass: "neutral",
          text: neutralPhrase(phrase).text,
          targets: [],
          supplies: [],
          after: async () => {
            await this.closeCase("examiner_completed");
            await this.nextCaseOrEnd();
          },
        });
      }
    }
  }

  private async revealStage(
    stageId: string,
    via: { kind: "examiner" } | { kind: "fact_reply"; replyId: string },
    announce: { kind: UtteranceKind; refId: string; text: string; promptClass: PromptClass; supplies: string[] },
  ): Promise<void> {
    const cur = this.current;
    if (!cur) return;
    const check = checkReveal(cur.cv, cur.state, stageId, this.caseMs(), via);
    if (!check.ok) {
      // Server rejects regardless of what the model proposed.
      await this.speak({ kind: "neutral", refId: "n_unavailable_generic", promptClass: "neutral", text: neutralPhrase("n_unavailable_generic").text, targets: [], supplies: [] });
      return;
    }
    cur.state = applyReveal(cur.cv, cur.state, stageId);
    const stage = getStage(cur.cv, stageId);
    const newAssetIds = stage.assetIds.filter((a) => !cur.handles[a]);
    for (const a of newAssetIds) cur.handles[a] = `h_${randomBytes(16).toString("hex")}`;
    await this.tx(async (tx) => {
      await this.persistStage(tx);
      if (newAssetIds.length) {
        await tx.insert(assetHandles).values(newAssetIds.map((a) => ({ handle: cur.handles[a]!, userId: this.userId, sessionId: this.sessionId, caseAttemptId: cur.attemptId, caseVersionId: cur.cv.versionId, assetId: a })));
      }
      await this.event(tx, "stage.revealed", { stageId, assetIds: newAssetIds, via: via.kind, transitionId: check.transition.id });
    });
    this.sendState();
    const speakIt = () => this.speak({ kind: announce.kind, refId: announce.refId, promptClass: announce.promptClass, text: announce.text, targets: [], supplies: announce.supplies });
    if (newAssetIds.length === 0) return speakIt();
    await this.sendViewerCommand({ kind: "load_assets", newAssetIds, presetId: stage.defaultViewportPresetId, awaitAck: true, onRendered: speakIt, onFailed: async () => undefined });
  }

  // ------------------------------------------------------------------ practice hints

  private async giveHint(commandId: string): Promise<void> {
    const cur = this.current;
    if (this.mode !== "practice" || !this.profile.prompting.practice.allowRequestedHints || !cur) return this.fail(commandId, "not_allowed", "Hints are only available in practice mode.");
    if (this.speaking) return this.fail(commandId, "busy", "Please wait for the examiner to finish.");
    const assessable = new Set(cur.state.revealedStageIds.flatMap((s) => getStage(cur.cv, s).assessableRubricElementIds));
    const hint = cur.cv.practice.hints.find((h) => !cur.hintsGiven.has(h.id) && h.elementIds.some((e) => assessable.has(e)));
    await this.tx(async (tx) => {
      await this.markCommand(tx, commandId);
      await this.event(tx, "practice.hint_requested", { hintId: hint?.id ?? null });
    });
    this.send({ type: "command_result", commandId, ok: true, error: null });
    if (!hint) {
      this.notice("info", "no_hint", "No further hints are available for this stage.");
      return;
    }
    cur.hintsGiven.add(hint.id);
    await this.speak({ kind: "practice_hint", refId: hint.id, promptClass: hint.level === "nudge" ? "targeted_probe" : "examiner_supplied", text: hint.text, targets: hint.elementIds, supplies: hint.level === "targeted" ? hint.elementIds : [] });
  }

  // ------------------------------------------------------------------ state snapshot

  candidateState(): CandidateSessionState {
    const cur = this.current;
    const prompting = this.mode === "practice" ? this.profile.prompting.practice : this.profile.prompting.exam;
    return {
      sessionId: this.sessionId,
      mode: this.mode,
      status: this.status,
      outcome: this.outcome,
      profile: {
        versionId: this.profile.versionId,
        displayName: this.profile.displayName,
        board: this.profile.board,
        verificationStatus: this.profile.verification.status,
        stationDurationSeconds: this.profile.station.durationSeconds,
      },
      clock: { durationMs: this.clock.durationMs, remainingMs: remainingMs(this.clock, this.now()), running: isRunning(this.clock), serverNowMs: this.now() },
      caseIndex: cur?.idx ?? Math.max(0, this.attempts.filter((a) => a.status === "closed").length - 1),
      caseCount: this.attempts.length,
      currentCase: cur
        ? {
            caseAttemptId: cur.attemptId,
            neutralLabel: `Case ${cur.idx + 1} of ${this.attempts.length}`,
            history: cumulativeHistory(cur.cv, cur.state),
            revealedStageCount: cur.state.revealedStageIds.length,
            assets: projectCandidateAssets(cur.cv, cur.state, cur.handles),
            viewer: { permissions: viewerPermissionsFor(this.profile, cur.cv, cur.state), layout: cur.layout, panes: cur.panes, lastCommandSeq: cur.lastCommandSeq },
            deliveredPrompts: cur.heard,
          }
        : null,
      liveTranscriptDefault: prompting.showLiveTranscriptByDefault,
      inputMode: this.inputMode,
      speech: { asr: this.deps.speech.asr, tts: this.deps.speech.tts, endOfTurnSilenceMs: this.profile.turnTaking.endOfTurnSilenceMs, allowBargeIn: this.profile.turnTaking.allowBargeIn },
      practice: this.mode === "practice" ? { hintsAvailable: this.profile.prompting.practice.allowRequestedHints, paused: this.practicePaused } : null,
      containsDevelopmentFixtures: this.caseVersions.some((c) => c.isDevelopmentFixture),
      lastServerSeq: this.msgSeq,
    };
  }

  private sendState(): void {
    this.send({ type: "state", seq: this.nextSeq(), state: this.candidateState() });
  }

  /** Test/diagnostic hook: wait until queued work has been processed. */
  async drain(): Promise<void> {
    await this.chain;
  }

  /** Stops timers and provider streams without ending the session (process shutdown). */
  halt(): void {
    this.clearTurnTimers();
    for (const t of [this.graceTimer, this.maxPauseTimer]) if (t) clearTimeout(t);
    this.graceTimer = null;
    this.maxPauseTimer = null;
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
    for (const p of this.pendingViewer.values()) clearTimeout(p.timer);
    if (this.speaking?.safety) clearTimeout(this.speaking.safety);
    this.asr?.close();
    this.asr = null;
    try {
      this.socket?.close(1012, "service restart");
    } catch {
      /* ignore */
    }
    this.socket = null;
  }

  get isEnded(): boolean {
    return this.ended;
  }
  get currentStatus(): SessionStatus {
    return this.status;
  }
  async setReady(): Promise<void> {
    await this.enqueueWork(async () => {
      if (this.status === "preflight") this.status = "ready";
    });
  }
}

export function isUnique(e: unknown): boolean {
  return isUniqueViolation(e);
}
