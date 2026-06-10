import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';

import { ChatService } from '../chat.service';
import {
  ChatSession,
  ChatMessage,
  ChatMessageStatus,
  Contract,
} from '../../../database/entities';
import { AiService } from '../../ai/ai.service';
import { LegalDocumentsService } from '../../legal-documents/legal-documents.service';

/**
 * Phase 7.27 — async chat. sendMessage returns immediately with a PENDING
 * assistant message; getMessageStatus advances it by polling ai-backend.
 */
describe('ChatService — async send + status advancer', () => {
  let service: ChatService;

  const USER = 'user-1';
  const ORG = 'org-1';
  const SID = 'sess-1';

  const sessionRepo = { findOne: jest.fn(), save: jest.fn() };
  const messageRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((x) => x),
    save: jest.fn(),
  };
  const contractRepo = { findOne: jest.fn() };
  const aiService = { triggerChat: jest.fn(), getJobStatus: jest.fn() };
  const legalService = { retrieveRelevantChunks: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    sessionRepo.findOne.mockResolvedValue({ id: SID, user_id: USER, contract_id: null });
    sessionRepo.save.mockResolvedValue({});
    messageRepo.find.mockResolvedValue([]);
    // save returns the row with a synthetic id
    let n = 0;
    messageRepo.save.mockImplementation(async (row: any) => ({ id: `m${++n}`, created_at: new Date(), ...row }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: getRepositoryToken(ChatSession), useValue: sessionRepo },
        { provide: getRepositoryToken(ChatMessage), useValue: messageRepo },
        { provide: getRepositoryToken(Contract), useValue: contractRepo },
        { provide: AiService, useValue: aiService },
        { provide: LegalDocumentsService, useValue: legalService },
      ],
    }).compile();
    service = module.get<ChatService>(ChatService);
  });

  it('sendMessage returns immediately: user COMPLETED + assistant PENDING w/ job_id, no getJobStatus', async () => {
    aiService.triggerChat.mockResolvedValue({ job_id: 'job-42', status: 'queued' });

    const res = await service.sendMessage(SID, USER, ORG, 'hello');

    // Two rows saved: user then assistant.
    expect(messageRepo.save).toHaveBeenCalledTimes(2);
    expect(res.userMessage.status).toBe(ChatMessageStatus.COMPLETED);
    expect(res.userMessage.role).toBe('USER');
    expect(res.assistantMessage.status).toBe(ChatMessageStatus.PENDING);
    expect(res.assistantMessage.job_id).toBe('job-42');
    expect(res.assistantMessage.content).toBeNull();
    // The synchronous poll loop is gone.
    expect(aiService.getJobStatus).not.toHaveBeenCalled();
  });

  it('sendMessage marks assistant FAILED when dispatch returns no job_id', async () => {
    aiService.triggerChat.mockResolvedValue({ status: 'queued' }); // no job_id

    const res = await service.sendMessage(SID, USER, ORG, 'hello');
    expect(res.assistantMessage.status).toBe(ChatMessageStatus.FAILED);
    expect(aiService.getJobStatus).not.toHaveBeenCalled();
  });

  it('getMessageStatus on PENDING polls ai-backend and persists the completed result', async () => {
    messageRepo.findOne.mockResolvedValue({
      id: 'a1', session_id: SID, status: ChatMessageStatus.PENDING,
      job_id: 'job-1', content: null, created_at: new Date(),
    });
    sessionRepo.findOne.mockResolvedValue({ id: SID, user_id: USER });
    // double-wrapped job result (matches get_job_status shape)
    aiService.getJobStatus.mockResolvedValue({
      status: 'completed',
      result: { result: { response: 'Per Article 217 ...', citations: [{ source: 'Art 217' }] } },
    });

    const out = await service.getMessageStatus('a1', USER);

    expect(aiService.getJobStatus).toHaveBeenCalledWith('job-1');
    expect(out.status).toBe(ChatMessageStatus.COMPLETED);
    expect(out.content).toContain('Article 217');
    expect(out.citations).toEqual([{ source: 'Art 217' }]);
    expect(messageRepo.save).toHaveBeenCalled();
  });

  it('getMessageStatus on a failed job persists FAILED + error', async () => {
    messageRepo.findOne.mockResolvedValue({
      id: 'a1', session_id: SID, status: ChatMessageStatus.PROCESSING,
      job_id: 'job-1', created_at: new Date(),
    });
    sessionRepo.findOne.mockResolvedValue({ id: SID, user_id: USER });
    aiService.getJobStatus.mockResolvedValue({ status: 'failed', error: 'boom' });

    const out = await service.getMessageStatus('a1', USER);
    expect(out.status).toBe(ChatMessageStatus.FAILED);
    expect(out.error_message).toBe('boom');
  });

  it('getMessageStatus on a COMPLETED message returns content without calling ai-backend', async () => {
    messageRepo.findOne.mockResolvedValue({
      id: 'a1', session_id: SID, status: ChatMessageStatus.COMPLETED,
      content: 'done', created_at: new Date(),
    });
    sessionRepo.findOne.mockResolvedValue({ id: SID, user_id: USER });

    const out = await service.getMessageStatus('a1', USER);
    expect(out.content).toBe('done');
    expect(aiService.getJobStatus).not.toHaveBeenCalled();
  });

  it('getMessageStatus enforces session ownership (404 when caller does not own it)', async () => {
    messageRepo.findOne.mockResolvedValue({ id: 'a1', session_id: SID, status: ChatMessageStatus.PENDING });
    sessionRepo.findOne.mockResolvedValue(null); // not owned by caller

    await expect(service.getMessageStatus('a1', 'other-user')).rejects.toThrow(NotFoundException);
    expect(aiService.getJobStatus).not.toHaveBeenCalled();
  });
});
