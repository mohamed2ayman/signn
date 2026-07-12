import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ChatSession,
  ChatMessage,
  ChatMessageRole,
  ChatMessageStatus,
  Contract,
} from '../../database/entities';
import { AiService } from '../ai/ai.service';
import { LegalDocumentsService } from '../legal-documents/legal-documents.service';
import { ALLOWED_JURISDICTIONS } from '../legal-documents/dto/create-legal-document.dto';
// Option B — chokepoint. sendMessage loads the session's parent Contract ONCE
// through the ROOT data-layer gate: scopedFindByIdWithClauses (silent-null,
// org-walled) hydrates `project` (for jurisdiction) AND the live clause set
// (is_proposed=false + is_active, order_index-sorted). Both grounding blocks —
// legal-corpus (buildLegalContext) and contract (buildContractContext) — derive
// from that single load. (Phase 7.27 extended the earlier project-only
// scopedFindByIdWithRelations load the compliance finale handed forward.)
import { ContractScopedRepository } from '../scoped-repository/contract-scoped.repository';

/** Number of legal-corpus passages to retrieve per chat question (Phase E). */
const LEGAL_TOP_K = 5;
// 60,000-char budget for the assembled <legal_context> block — mirrors
// buildContractContext's cap. Latent-tail insurance only: the Phase 1 token-cost
// measurement showed a real top-5 block is ~3.5k–15k chars (article-sized
// chunks), so this NEVER fires on the current corpus; it caps a future
// large-chunk tail (chunks near the ~6k-token ingestion cap → top-5 ~30k tokens).
const LEGAL_CONTEXT_MAX_CHARS = 60_000;

/**
 * Phase E — map a project's `country` to a supported legal-corpus jurisdiction
 * ISO-2 code. Projects store country as a free-text display name ("Egypt") OR
 * an ISO code; the legal corpus keys on ISO-2 (EG/AE/SA/QA/UK). Anything not in
 * this map resolves to null → silent fallback (e.g. "Algeria" has no corpus).
 * Keep keys lowercased for case-insensitive lookup.
 */
const COUNTRY_TO_JURISDICTION: Record<string, string> = {
  eg: 'EG', egypt: 'EG',
  ae: 'AE', uae: 'AE', 'united arab emirates': 'AE',
  sa: 'SA', 'saudi arabia': 'SA', ksa: 'SA',
  qa: 'QA', qatar: 'QA',
  uk: 'UK', 'united kingdom': 'UK', 'great britain': 'UK', gb: 'UK',
};

/** Resolve a project country (name or ISO) to a supported jurisdiction, or null. */
function resolveJurisdiction(country: string | null | undefined): string | null {
  const key = country?.trim().toLowerCase();
  if (!key) return null;
  return COUNTRY_TO_JURISDICTION[key] ?? null;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectRepository(ChatSession) // lint-exempt: chat scopes by user_id/session_id/org_id, NOT contract→org — this repo backs writes + user-scoped reads (no chokepoint candidate)
    private readonly sessionRepo: Repository<ChatSession>,
    @InjectRepository(ChatMessage) // lint-exempt: chat scopes by session_id/user_id, NOT contract→org — this repo backs writes + session-scoped reads (no chokepoint candidate)
    private readonly messageRepo: Repository<ChatMessage>,
    private readonly aiService: AiService,
    private readonly legalDocumentsService: LegalDocumentsService,
    // Option B chokepoint (compliance finale) — buildLegalContext's parent
    // Contract+project load routes through this ROOT gate (layer 2).
    private readonly contractScoped: ContractScopedRepository,
  ) {}

  /**
   * Phase E — derive the legal jurisdiction from a PRE-LOADED contract's project
   * country, then retrieve relevant legal-corpus passages and format them as a
   * <legal_context> block for the chat prompt.
   *
   * Takes the contract already loaded by sendMessage (via the org-walled
   * scopedFindByIdWithClauses chokepoint) rather than loading it itself — the
   * single load feeds both this legal grounding AND buildContractContext, so we
   * never double-hit the DB. Returns null (silent fallback) when: no contract,
   * the project has no country, the country isn't in the supported allowlist, or
   * retrieval returns zero chunks. Never throws — chat must proceed regardless.
   *
   * The org gate lives in the load (scopedFindByIdWithClauses walls by the
   * sendMessage JWT org; an out-of-org contract resolves to null → no context).
   */
  private async buildLegalContext(
    contract: Contract | null,
    message: string,
  ): Promise<string | null> {
    if (!contract) return null;
    try {
      // Project.country is a free-text display name ("Egypt") or ISO code;
      // map it to a supported corpus jurisdiction (EG/AE/SA/QA/UK) or bail.
      const jurisdiction = resolveJurisdiction(contract.project?.country);
      if (!jurisdiction) return null;
      if (!(ALLOWED_JURISDICTIONS as readonly string[]).includes(jurisdiction)) {
        return null;
      }

      const chunks = await this.legalDocumentsService.retrieveRelevantChunks(
        message,
        jurisdiction,
        LEGAL_TOP_K,
      );
      if (!chunks || chunks.length === 0) return null;

      // 60,000-char budget with graceful per-PASSAGE omission — mirrors
      // buildContractContext. Drop WHOLE trailing passages to fit; NEVER
      // truncate mid-passage. On the current corpus this never triggers (see
      // LEGAL_CONTEXT_MAX_CHARS); it only caps a future large-chunk tail.
      const header =
        `<legal_context jurisdiction="${jurisdiction}">\n` +
        `The following passages are from ${jurisdiction} law and may be relevant to ` +
        `the user's question. Cite the specific article number (e.g., "Article 217 ` +
        `of the Egyptian Civil Code") when using these passages.\n\n`;
      const footer = `\n</legal_context>`;

      const kept: string[] = [];
      const omitted: number[] = [];
      let used = header.length + footer.length;
      chunks.forEach((c, i) => {
        const ref = c.article_reference?.trim() || '(preamble)';
        const passage = `[Passage ${i + 1} — ${c.document_title}, ${ref}]\n${c.chunk_text}`;
        // +2 for the '\n\n' join that precedes this passage once ≥1 is kept.
        const cost = passage.length + (kept.length > 0 ? 2 : 0);
        if (used + cost > LEGAL_CONTEXT_MAX_CHARS) {
          omitted.push(i + 1);
          return;
        }
        kept.push(passage);
        used += cost;
      });

      // Budget too small for even one passage (degenerate — never with a 60k
      // budget on real data): treat as no grounding rather than an empty block.
      if (kept.length === 0) return null;

      let body = kept.join('\n\n');
      if (omitted.length > 0) {
        // Graceful omission note (mirrors buildContractContext) — the small
        // overage from the note itself is accepted, exactly as that path does.
        body +=
          `\n\n[Note: ${omitted.length} passage(s) omitted for length: ` +
          `${omitted.map((n) => `Passage ${n}`).join(', ')}. ` +
          `Tell the user to consult the full law text for the omitted passages.]`;
      }

      return `${header}${body}${footer}`;
    } catch (err) {
      // Retrieval is best-effort grounding — never let it break chat.
      this.logger.warn(
        `[buildLegalContext] legal retrieval failed for contract ${contract.id}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Phase 7.27 — assemble the contract's metadata + live clause set as a
   * plain-text block for the conversational agent's `### Contract Context`
   * section, so chat answers are grounded in the ACTUAL contract, not just the
   * legal corpus.
   *
   * Adapted from the guest-portal assembler
   * (guest-portal/services/guest-chat.service.ts:buildContractContext) but kept
   * HOST-OWNED to avoid a host→guest module dependency. This is the CLAUSES-ONLY
   * path: comments are intentionally NOT included (deferred — the guest path
   * needs the internal-note filter wall; host clause-grounding does not need it).
   *
   * The contract is pre-loaded by sendMessage via scopedFindByIdWithClauses
   * (org-walled; is_proposed=false + is_active clauses; order_index-sorted), so
   * this method only FORMATS — no DB access, no tenancy decision here. Returns
   * null when there are no renderable active clauses.
   *
   * `maxChars` (default 60_000, matching the guest budget) caps total size with
   * graceful per-clause omission: an over-budget clause is dropped and listed in
   * a closing note, never truncated mid-clause.
   */
  private buildContractContext(
    contract: Contract,
    maxChars = 60_000,
  ): string | null {
    const meta: string[] = ['### Contract metadata'];
    meta.push(`Name: ${contract.name ?? 'Untitled'}`);
    if (contract.contract_type) meta.push(`Type: ${contract.contract_type}`);
    if (contract.status) meta.push(`Status: ${contract.status}`);
    if (contract.party_first_name || contract.party_second_name) {
      meta.push(
        `Parties: ${contract.party_first_name ?? '—'} / ${contract.party_second_name ?? '—'}`,
      );
    }
    if (contract.start_date) meta.push(`Start date: ${contract.start_date}`);
    if (contract.end_date) meta.push(`End date: ${contract.end_date}`);

    // Deterministic section order (the load already sorts, but a copy-then-sort
    // keeps this helper correct even if handed an unsorted clause set).
    const junctions = [...(contract.contract_clauses ?? [])].sort(
      (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0),
    );

    const parts: string[] = [meta.join('\n'), '\n### Clauses'];
    let used = parts.join('\n').length;
    const omitted: string[] = [];
    let rendered = 0;

    for (const cc of junctions) {
      const clause = cc.clause;
      if (!clause) continue;
      if (clause.is_active === false) continue;
      const section = cc.section_number ?? String((cc.order_index ?? 0) + 1);
      const typeNote = clause.clause_type ? ` (type: ${clause.clause_type})` : '';
      const block = `\n[§${section}] ${clause.title ?? ''}${typeNote}\n${clause.content ?? ''}`;
      if (used + block.length > maxChars) {
        omitted.push(`§${section}`);
        continue;
      }
      parts.push(block);
      used += block.length;
      rendered += 1;
    }

    // No renderable clauses → no contract context (caller passes undefined).
    if (rendered === 0) return null;

    if (omitted.length > 0) {
      parts.push(
        `\n[Note: ${omitted.length} clause(s) omitted for length: ${omitted.join(', ')}. ` +
          `Tell the user to consult the contract viewer for their full text.]`,
      );
    }

    return parts.join('\n');
  }

  async createSession(
    userId: string,
    orgId: string,
    contractId?: string,
  ): Promise<ChatSession> {
    const session = this.sessionRepo.create({
      user_id: userId,
      org_id: orgId,
      contract_id: contractId || null,
    });
    return this.sessionRepo.save(session); // lint-exempt: write (session insert); the scoped chokepoint is read-only
  }

  async getSessionMessages(
    sessionId: string,
    userId: string,
  ): Promise<ChatMessage[]> {
    const session = await this.sessionRepo.findOne({ // lint-exempt: user-scoped read (ChatSession by id+user_id ownership); session may be unbound (contract_id null) — not a contract→org read
      where: { id: sessionId, user_id: userId },
    });
    if (!session) throw new NotFoundException('Session not found');

    return this.messageRepo.find({ // lint-exempt: session-scoped read (ChatMessage by session_id, owning session already verified) — not a contract→org read
      where: { session_id: sessionId },
      order: { created_at: 'ASC' },
    });
  }

  async findSessionByContract(
    userId: string,
    contractId: string,
  ): Promise<ChatSession | null> {
    return this.sessionRepo.findOne({ // lint-exempt: user-scoped read (ChatSession by user_id ownership); contract_id is a selector, NOT the tenancy gate; no request org in scope; a contract→org join would wrongly drop the user's own session if its contract changed org
      where: { user_id: userId, contract_id: contractId },
      order: { updated_at: 'DESC' },
    });
  }

  /**
   * ASYNC chat (Phase 7.27). Returns immediately (sub-second):
   *   1. Persist the USER message (COMPLETED — its text is final).
   *   2. Build legal grounding (silent fallback) + dispatch the AI job.
   *   3. Persist a PENDING ASSISTANT placeholder carrying the job_id.
   * The frontend then polls getMessageStatus(assistantMessage.id) which
   * advances the row when the AI job finishes. No synchronous poll loop here —
   * chat now survives any AI latency without holding the HTTP connection open.
   */
  async sendMessage(
    sessionId: string,
    userId: string,
    orgId: string,
    message: string,
  ): Promise<{ userMessage: ChatMessage; assistantMessage: ChatMessage }> {
    const session = await this.sessionRepo.findOne({ // lint-exempt: user-scoped read (ChatSession by id+user_id ownership); session may be unbound — not a contract→org read
      where: { id: sessionId, user_id: userId },
    });
    if (!session) throw new NotFoundException('Session not found');

    // 1. Persist the user message (terminal).
    const userMessage = await this.messageRepo.save( // lint-exempt: write (user message insert); the scoped chokepoint is read-only
      this.messageRepo.create({
        session_id: sessionId,
        contract_id: session.contract_id,
        user_id: userId,
        org_id: orgId,
        role: ChatMessageRole.USER,
        content: message,
        status: ChatMessageStatus.COMPLETED,
      }),
    );

    // History for AI context (only completed turns carry usable content).
    const history = await this.messageRepo.find({ // lint-exempt: session-scoped read (ChatMessage history by session_id) — not a contract→org read
      where: { session_id: sessionId },
      order: { created_at: 'ASC' },
    });
    const historyForAi = history
      .filter((m) => m.content)
      .map((m) => ({
        role: m.role === ChatMessageRole.USER ? 'user' : 'assistant',
        content: m.content as string,
      }));

    // Phase 7.27 — load the session's parent contract ONCE through the
    // Option-B chokepoint (org-walled; is_proposed=false + is_active clauses;
    // order_index-sorted), then derive BOTH grounding blocks from that single
    // load: legal-corpus context (from the project's jurisdiction) and contract
    // context (from the clause set). orgId (the caller's JWT org) is the
    // data-layer tenancy gate inside the chokepoint.
    const contract = session.contract_id
      ? await this.contractScoped.scopedFindByIdWithClauses(
          session.contract_id,
          orgId,
        )
      : null;

    const legalContext = await this.buildLegalContext(contract, message);
    const contractContext = contract
      ? this.buildContractContext(contract)
      : null;

    // Observability (defense-in-depth): if contract grounding ever silently
    // stops flowing again, these lines surface it during smoke testing.
    if (session.contract_id) {
      this.logger.debug(
        `Contract context built: ${contractContext ? contractContext.length : 0} chars, ` +
          `${contract?.contract_clauses?.length || 0} clauses considered`,
      );
    } else {
      this.logger.debug('Contract context skipped (no contract in session)');
    }

    // 2. Dispatch the AI job (do NOT await its result).
    let jobId: string | null = null;
    let assistantStatus: ChatMessageStatus = ChatMessageStatus.PENDING;
    let errorMessage: string | null = null;
    try {
      const aiResponse = await this.aiService.triggerChat({
        message,
        contract_id: session.contract_id || undefined,
        org_id: orgId,
        history: historyForAi,
        knowledge_context: legalContext || undefined,
        contract_context: contractContext || undefined,
      });
      jobId = (aiResponse as any).job_id || null;
      if (!jobId) {
        // No job id — the AI backend is misconfigured; fail fast and visibly.
        assistantStatus = ChatMessageStatus.FAILED;
        errorMessage = 'AI service did not return a job id.';
      }
    } catch (error) {
      this.logger.error(
        `[AI chat] dispatch failed for session ${sessionId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      assistantStatus = ChatMessageStatus.FAILED;
      errorMessage = 'Failed to reach the AI service. Please try again.';
    }

    // 3. Persist the assistant placeholder (PENDING + job_id, or FAILED).
    const assistantMessage = await this.messageRepo.save( // lint-exempt: write (assistant placeholder insert); the scoped chokepoint is read-only
      this.messageRepo.create({
        session_id: sessionId,
        contract_id: session.contract_id,
        user_id: userId,
        org_id: orgId,
        role: ChatMessageRole.ASSISTANT,
        content: null,
        citations: null,
        status: assistantStatus,
        job_id: jobId,
        error_message: errorMessage,
      }),
    );

    session.updated_at = new Date();
    await this.sessionRepo.save(session); // lint-exempt: write (session updated_at touch); the scoped chokepoint is read-only

    return { userMessage, assistantMessage };
  }

  /** Max time an assistant message may stay in-flight before it's failed. */
  private static readonly STALE_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Endpoint-triggered advancer (Phase 7.27). Returns the current state of an
   * assistant message, advancing it if its AI job has finished:
   *   - terminal (COMPLETED/FAILED) → return as-is (idempotent)
   *   - in-flight → poll ai-backend; persist result on completion/failure;
   *     fail it if it has been in-flight longer than STALE_MS (worker death
   *     backstop — the job never returns).
   * Caller must own the session.
   */
  async getMessageStatus(messageId: string, userId: string): Promise<ChatMessage> {
    const msg = await this.messageRepo.findOne({ where: { id: messageId } }); // lint-exempt: by-id read; ownership enforced by the session lookup below — not a contract→org read
    if (!msg) throw new NotFoundException('Message not found');

    // Ownership: the caller must own the session this message belongs to.
    const session = await this.sessionRepo.findOne({ // lint-exempt: user-scoped read (ChatSession by id+user_id ownership) — not a contract→org read
      where: { id: msg.session_id, user_id: userId },
    });
    if (!session) throw new NotFoundException('Message not found');

    // Already terminal — return as-is (idempotent, no ai-backend call).
    if (
      msg.status === ChatMessageStatus.COMPLETED ||
      msg.status === ChatMessageStatus.FAILED
    ) {
      return msg;
    }

    // No job to poll (shouldn't happen for a non-terminal row) — staleness only.
    if (!msg.job_id) {
      return this.failIfStale(msg);
    }

    let job: Record<string, any>;
    try {
      job = await this.aiService.getJobStatus(msg.job_id);
    } catch (err) {
      this.logger.warn(
        `[getMessageStatus] job poll failed for msg ${messageId}: ${(err as Error).message}`,
      );
      return this.failIfStale(msg); // transient — keep PENDING unless stale
    }

    if (job.status === 'completed') {
      // Double-wrapped: get_job_status { result: <task-return> } and the task
      // returns { result: <agent> }. Unwrap one extra level (matches the
      // legal-documents poller), single-level fallback otherwise.
      const r = job.result?.result ?? job.result;
      msg.content = r?.response || r?.content || 'I processed your request.';
      msg.citations = r?.citations || null;
      msg.status = ChatMessageStatus.COMPLETED;
      return this.messageRepo.save(msg); // lint-exempt: write (message status→COMPLETED); the scoped chokepoint is read-only
    }

    if (job.status === 'failed') {
      msg.status = ChatMessageStatus.FAILED;
      msg.error_message =
        typeof job.error === 'string'
          ? job.error
          : 'The AI service failed to process this request.';
      return this.messageRepo.save(msg); // lint-exempt: write (message status→FAILED); the scoped chokepoint is read-only
    }

    // Still running — mark PROCESSING (visibility), then staleness backstop.
    if (msg.status === ChatMessageStatus.PENDING) {
      msg.status = ChatMessageStatus.PROCESSING;
      await this.messageRepo.save(msg); // lint-exempt: write (message status→PROCESSING); the scoped chokepoint is read-only
    }
    return this.failIfStale(msg);
  }

  /** Fail an in-flight message that has exceeded STALE_MS (worker-death backstop). */
  private async failIfStale(msg: ChatMessage): Promise<ChatMessage> {
    const age = Date.now() - new Date(msg.created_at).getTime();
    if (age > ChatService.STALE_MS) {
      msg.status = ChatMessageStatus.FAILED;
      msg.error_message =
        'The response timed out. Please try sending your message again.';
      return this.messageRepo.save(msg); // lint-exempt: write (stale message→FAILED); the scoped chokepoint is read-only
    }
    return msg;
  }
}
