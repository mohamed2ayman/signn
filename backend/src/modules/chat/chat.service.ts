import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatSession, ChatMessage, ChatMessageRole } from '../../database/entities';
import { AiService } from '../ai/ai.service';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatSession)
    private readonly sessionRepo: Repository<ChatSession>,
    @InjectRepository(ChatMessage)
    private readonly messageRepo: Repository<ChatMessage>,
    private readonly aiService: AiService,
  ) {}

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

    try {
      const aiResponse = await this.aiService.triggerChat({
        message,
        contract_id: session.contract_id || undefined,
        org_id: orgId,
        history: historyForAi,
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
            aiContent = status.result?.response || status.result?.content || 'I processed your request.';
            citations = status.result?.citations || null;
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
    } catch {
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
