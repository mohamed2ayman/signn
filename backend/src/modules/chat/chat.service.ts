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

/** Number of legal-corpus passages to retrieve per chat question (Phase E). */
const LEGAL_TOP_K = 5;

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
    @InjectRepository(ChatSession)
    private readonly sessionRepo: Repository<ChatSession>,
    @InjectRepository(ChatMessage)
    private readonly messageRepo: Repository<ChatMessage>,
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
    private readonly aiService: AiService,
    private readonly legalDocumentsService: LegalDocumentsService,
  ) {}

  /**
   * Phase E — derive the legal jurisdiction for a chat session from its
   * contract's project country, then retrieve relevant legal-corpus passages
   * and format them as a <legal_context> block for the chat prompt.
   *
   * Returns null (silent fallback) when: the session has no contract, the
   * project has no country, the country isn't in the supported allowlist, or
   * retrieval returns zero chunks. Never throws — chat must proceed regardless.
   */
  private async buildLegalContext(
    contractId: string | null,
    message: string,
  ): Promise<string | null> {
    if (!contractId) return null;
    try {
      const contract = await this.contractRepo.findOne({
        where: { id: contractId },
        relations: ['project'],
      });
      // Project.country is a free-text display name ("Egypt") or ISO code;
      // map it to a supported corpus jurisdiction (EG/AE/SA/QA/UK) or bail.
      const jurisdiction = resolveJurisdiction(contract?.project?.country);
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

      const passages = chunks
        .map((c, i) => {
          const ref = c.article_reference?.trim() || '(preamble)';
          return `[Passage ${i + 1} — ${c.document_title}, ${ref}]\n${c.chunk_text}`;
        })
        .join('\n\n');

      return (
        `<legal_context jurisdiction="${jurisdiction}">\n` +
        `The following passages are from ${jurisdiction} law and may be relevant to ` +
        `the user's question. Cite the specific article number (e.g., "Article 217 ` +
        `of the Egyptian Civil Code") when using these passages.\n\n` +
        `${passages}\n` +
        `</legal_context>`
      );
    } catch (err) {
      // Retrieval is best-effort grounding — never let it break chat.
      this.logger.warn(
        `[buildLegalContext] legal retrieval failed for contract ${contractId}: ${(err as Error).message}`,
      );
      return null;
    }
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
    return this.sessionRepo.save(session);
  }

  async getSessionMessages(
    sessionId: string,
    userId: string,
  ): Promise<ChatMessage[]> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, user_id: userId },
    });
    if (!session) throw new NotFoundException('Session not found');

    return this.messageRepo.find({
      where: { session_id: sessionId },
      order: { created_at: 'ASC' },
    });
  }

  async findSessionByContract(
    userId: string,
    contractId: string,
  ): Promise<ChatSession | null> {
    return this.sessionRepo.findOne({
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
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, user_id: userId },
    });
    if (!session) throw new NotFoundException('Session not found');

    // 1. Persist the user message (terminal).
    const userMessage = await this.messageRepo.save(
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
    const history = await this.messageRepo.find({
      where: { session_id: sessionId },
      order: { created_at: 'ASC' },
    });
    const historyForAi = history
      .filter((m) => m.content)
      .map((m) => ({
        role: m.role === ChatMessageRole.USER ? 'user' : 'assistant',
        content: m.content as string,
      }));

    // Phase E — legal-corpus grounding (silent fallback on no-country/no-chunks).
    const legalContext = await this.buildLegalContext(
      session.contract_id,
      message,
    );

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
    const assistantMessage = await this.messageRepo.save(
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
    await this.sessionRepo.save(session);

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
    const msg = await this.messageRepo.findOne({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('Message not found');

    // Ownership: the caller must own the session this message belongs to.
    const session = await this.sessionRepo.findOne({
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
      return this.messageRepo.save(msg);
    }

    if (job.status === 'failed') {
      msg.status = ChatMessageStatus.FAILED;
      msg.error_message =
        typeof job.error === 'string'
          ? job.error
          : 'The AI service failed to process this request.';
      return this.messageRepo.save(msg);
    }

    // Still running — mark PROCESSING (visibility), then staleness backstop.
    if (msg.status === ChatMessageStatus.PENDING) {
      msg.status = ChatMessageStatus.PROCESSING;
      await this.messageRepo.save(msg);
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
      return this.messageRepo.save(msg);
    }
    return msg;
  }
}
