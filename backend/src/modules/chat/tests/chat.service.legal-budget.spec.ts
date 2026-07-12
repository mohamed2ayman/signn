import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ChatService } from '../chat.service';
import { ChatSession, ChatMessage } from '../../../database/entities';
import { AiService } from '../../ai/ai.service';
import { LegalDocumentsService } from '../../legal-documents/legal-documents.service';
import { ContractScopedRepository } from '../../scoped-repository/contract-scoped.repository';

/**
 * Phase 2 (post-31474c9) — the 60,000-char budget on the assembled
 * <legal_context> block (latent-tail insurance mirroring buildContractContext).
 * Verified via ChatService.sendMessage → the knowledge_context handed to
 * triggerChat:
 *   - an OVERSIZED top-5 block is trimmed by WHOLE passages (never mid-passage),
 *     with a graceful omission note;
 *   - a NORMAL article-sized block passes untouched (no note, all passages).
 *
 * LegalDocumentsService.retrieveRelevantChunks is mocked — no real embeddings.
 */
describe('ChatService — legal-context 60k-char budget', () => {
  let service: ChatService;

  const SESSION_ID = 'sess-b';
  const CONTRACT_ID = 'contract-b';
  const USER_ID = 'user-b';
  const ORG_ID = 'org-b';
  const MAX_CHARS = 60_000;

  const sessionRepo = { findOne: jest.fn(), save: jest.fn(), create: jest.fn() };
  const messageRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn(), create: jest.fn() };
  const contractScoped = { scopedFindByIdWithClauses: jest.fn() };
  const aiService = {
    triggerChat: jest.fn().mockResolvedValue({ response: 'ok', citations: null }),
    getJobStatus: jest.fn(),
  };
  const legalService = { retrieveRelevantChunks: jest.fn() };

  function chunk(i: number, text: string) {
    return {
      chunk_id: `c${i}`,
      chunk_text: text,
      article_reference: `مادة ${i}`,
      legal_document_id: 'doc1',
      document_title: 'Egyptian Civil Code',
      law_number: '131',
      law_year: 1948,
      jurisdiction: 'EG',
      distance: 0.1 * i,
    };
  }

  function primeSession() {
    sessionRepo.findOne.mockResolvedValue({
      id: SESSION_ID,
      user_id: USER_ID,
      contract_id: CONTRACT_ID,
      updated_at: new Date(),
    });
    messageRepo.create.mockImplementation((x) => x);
    messageRepo.save.mockImplementation(async (x) => x);
    messageRepo.find.mockResolvedValue([]);
    sessionRepo.save.mockResolvedValue({});
    // Egypt → EG (allowed); no clauses so contract_context is null and only the
    // legal block is under test.
    contractScoped.scopedFindByIdWithClauses.mockResolvedValue({
      id: CONTRACT_ID,
      project: { country: 'Egypt' },
      contract_clauses: [],
    });
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    aiService.triggerChat.mockResolvedValue({ response: 'ok', citations: null });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: getRepositoryToken(ChatSession), useValue: sessionRepo },
        { provide: getRepositoryToken(ChatMessage), useValue: messageRepo },
        { provide: ContractScopedRepository, useValue: contractScoped },
        { provide: AiService, useValue: aiService },
        { provide: LegalDocumentsService, useValue: legalService },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    primeSession();
  });

  it('trims an oversized top-5 block by WHOLE passages (never mid-passage) + adds an omission note', async () => {
    // Five ~20k-char passages ≈ 100k chars >> the 60k budget → some MUST drop.
    const big = (i: number) => `P${i}_START` + 'x'.repeat(20_000) + `P${i}_END`;
    legalService.retrieveRelevantChunks.mockResolvedValue(
      [1, 2, 3, 4, 5].map((i) => chunk(i, big(i))),
    );

    await service.sendMessage(SESSION_ID, USER_ID, ORG_ID, 'q');
    const kc: string = aiService.triggerChat.mock.calls[0][0].knowledge_context;

    // Budget respected (only a tiny overage from the omission note itself).
    expect(kc.length).toBeLessThanOrEqual(MAX_CHARS + 300);
    // Kept passages appear IN FULL — BOTH their START and END markers — which
    // proves no mid-passage truncation happened.
    expect(kc).toContain('P1_START');
    expect(kc).toContain('P1_END');
    expect(kc).toContain('P2_START');
    expect(kc).toContain('P2_END');
    // At least one trailing passage was dropped WHOLE (its markers absent entirely).
    expect(kc).not.toContain('P5_START');
    expect(kc).not.toContain('P5_END');
    // Graceful omission note present.
    expect(kc).toMatch(/passage\(s\) omitted for length/);
    // Still a well-formed <legal_context> block.
    expect(kc.startsWith('<legal_context jurisdiction="EG">')).toBe(true);
    expect(kc.endsWith('</legal_context>')).toBe(true);
  });

  it('leaves a normal article-sized block untouched (no note, all passages present)', async () => {
    legalService.retrieveRelevantChunks.mockResolvedValue(
      [1, 2, 3].map((i) => chunk(i, `NORMAL_${i} short article text`)),
    );

    await service.sendMessage(SESSION_ID, USER_ID, ORG_ID, 'q');
    const kc: string = aiService.triggerChat.mock.calls[0][0].knowledge_context;

    // Every passage present, nothing trimmed, no note — behavior-preserving.
    expect(kc).toContain('NORMAL_1');
    expect(kc).toContain('NORMAL_2');
    expect(kc).toContain('NORMAL_3');
    expect(kc).not.toMatch(/omitted for length/);
    expect(kc.length).toBeLessThan(MAX_CHARS);
  });
});
