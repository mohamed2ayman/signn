import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatSession, ChatMessage, ChatMessageRole, Contract } from '../../database/entities';
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

    // Save user message
    const userMessage = this.messageRepo.create({
      session_id: sessionId,
      contract_id: session.contract_id,
      user_id: userId,
      org_id: orgId,
      role: ChatMessageRole.USER,
      content: message,
    });
    await this.messageRepo.save(userMessage);

    // Load full history for AI context
    const history = await this.messageRepo.find({
      where: { session_id: sessionId },
      order: { created_at: 'ASC' },
    });

    const historyForAi = history.map((msg) => ({
      role: msg.role === ChatMessageRole.USER ? 'user' : 'assistant',
      content: msg.content,
    }));

    // Call existing AI service
    let aiContent = '';
    let citations: Record<string, any>[] | null = null;

    // Phase E — ground the answer in the legal corpus when the session's
    // project has a supported jurisdiction. Silent fallback to plain chat
    // when there's no country / no laws / no relevant passages.
    const legalContext = await this.buildLegalContext(
      session.contract_id,
      message,
    );

    try {
      const aiResponse = await this.aiService.triggerChat({
        message,
        contract_id: session.contract_id || undefined,
        org_id: orgId,
        history: historyForAi,
        knowledge_context: legalContext || undefined,
      });

      // The AI service returns a job-based response; extract the reply
      // If the AI returns directly, use the response field
      if ((aiResponse as any).response) {
        aiContent = (aiResponse as any).response;
        citations = (aiResponse as any).citations || null;
      } else if ((aiResponse as any).job_id) {
        // Poll for the job result
        let attempts = 0;
        while (attempts < 30) {
          await new Promise((r) => setTimeout(r, 1000));
          const status = await this.aiService.getJobStatus(
            (aiResponse as any).job_id,
          );
          if (status.status === 'completed') {
            // The Celery task return is double-wrapped: get_job_status returns
            // { result: <task-return> } and the task returns { result: <agent> }.
            // Unwrap one extra level (matches the working legal-documents poller),
            // falling back to the single level for any task that doesn't wrap.
            const r = status.result?.result ?? status.result;
            aiContent = r?.response || r?.content || 'I processed your request.';
            citations = r?.citations || null;
            break;
          }
          if (status.status === 'failed') {
            aiContent = 'I encountered an error processing your request. Please try again.';
            break;
          }
          attempts++;
        }
        if (!aiContent) {
          aiContent = 'The response is still being generated. Please try again in a moment.';
        }
      }
    } catch (error) {
      this.logger.error(
        `[AI chat] Claude API call failed for session ${sessionId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      aiContent = 'I encountered an error processing your request. Please try again.';
    }

    // Save assistant message
    const assistantMessage = this.messageRepo.create({
      session_id: sessionId,
      contract_id: session.contract_id,
      user_id: userId,
      org_id: orgId,
      role: ChatMessageRole.ASSISTANT,
      content: aiContent,
      citations,
    });
    await this.messageRepo.save(assistantMessage);

    // Update session timestamp
    session.updated_at = new Date();
    await this.sessionRepo.save(session);

    return { userMessage, assistantMessage };
  }
}
