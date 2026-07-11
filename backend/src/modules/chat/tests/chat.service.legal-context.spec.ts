import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ChatService } from '../chat.service';
import { ChatSession, ChatMessage } from '../../../database/entities';
import { AiService } from '../../ai/ai.service';
import { LegalDocumentsService } from '../../legal-documents/legal-documents.service';
// Option B chokepoint — sendMessage loads the parent Contract through the
// scoped ROOT gate (scopedFindByIdWithClauses: project + live clause set),
// feeding both legal grounding and contract grounding from one walled load.
import { ContractScopedRepository } from '../../scoped-repository/contract-scoped.repository';

/**
 * Phase E — legal-corpus grounding in chat. Verifies the jurisdiction gate
 * and the silent-fallback behavior in ChatService.sendMessage:
 *  - valid jurisdiction (country name normalized to ISO) + chunks → triggerChat
 *    receives a formatted <legal_context> block as knowledge_context
 *  - valid jurisdiction + zero chunks → triggerChat WITHOUT knowledge_context
 *  - no country → retrieveRelevantChunks never called
 *  - country not in the allowlist → retrieveRelevantChunks never called
 *
 * LegalDocumentsService.retrieveRelevantChunks is mocked — no real embeddings.
 */
describe('ChatService — legal-context grounding (Phase E)', () => {
  let service: ChatService;

  const SESSION_ID = 'sess-0001';
  const CONTRACT_ID = 'contract-0001';
  const USER_ID = 'user-0001';
  const ORG_ID = 'org-0001';

  const sessionRepo = { findOne: jest.fn(), save: jest.fn(), create: jest.fn() };
  const messageRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn(), create: jest.fn() };
  // Option B chokepoint — the scoped ROOT gate replaces the bare Contract repo.
  const contractScoped = { scopedFindByIdWithClauses: jest.fn() };
  // triggerChat resolves with a direct {response} so sendMessage takes the
  // synchronous branch (no polling delay in the unit test).
  const aiService = {
    triggerChat: jest.fn().mockResolvedValue({ response: 'ok', citations: null }),
    getJobStatus: jest.fn(),
  };
  const legalService = { retrieveRelevantChunks: jest.fn() };

  const MOCK_CHUNKS = [
    {
      chunk_id: 'c1',
      chunk_text: 'مادة 217- (1) يجوز الاتفاق على أن يتحمل المدين تبعة الحادث المفاجئ والقوة القاهرة.',
      article_reference: 'مادة 217',
      legal_document_id: 'doc1',
      document_title: 'Egyptian Civil Code',
      law_number: '131',
      law_year: 1948,
      jurisdiction: 'EG',
      distance: 0.48,
    },
  ];

  function setSessionWithCountry(country: string | null) {
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
    contractScoped.scopedFindByIdWithClauses.mockResolvedValue({
      id: CONTRACT_ID,
      project: country === undefined ? undefined : { country },
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
  });

  it('injects a <legal_context> block when jurisdiction resolves and chunks return', async () => {
    setSessionWithCountry('Egypt'); // display name → normalized to EG
    legalService.retrieveRelevantChunks.mockResolvedValue(MOCK_CHUNKS);

    await service.sendMessage(SESSION_ID, USER_ID, ORG_ID, 'force majeure?');

    // Option B chokepoint: the parent-Contract load routes through the scoped
    // ROOT gate, keyed on the CALLER's org (ORG_ID) — not a bare repo. The
    // single walled load feeds both legal and contract grounding.
    expect(contractScoped.scopedFindByIdWithClauses).toHaveBeenCalledWith(
      CONTRACT_ID,
      ORG_ID,
    );
    expect(legalService.retrieveRelevantChunks).toHaveBeenCalledWith(
      'force majeure?',
      'EG',
      5,
    );
    const arg = aiService.triggerChat.mock.calls[0][0];
    expect(arg.knowledge_context).toContain('<legal_context jurisdiction="EG">');
    expect(arg.knowledge_context).toContain('مادة 217');
  });

  it('silent fallback — valid jurisdiction but zero chunks → no knowledge_context', async () => {
    setSessionWithCountry('EG'); // ISO form also accepted
    legalService.retrieveRelevantChunks.mockResolvedValue([]);

    await service.sendMessage(SESSION_ID, USER_ID, ORG_ID, 'hello');

    expect(legalService.retrieveRelevantChunks).toHaveBeenCalled();
    const arg = aiService.triggerChat.mock.calls[0][0];
    expect(arg.knowledge_context).toBeUndefined();
  });

  it('no country → retrieval never called, no knowledge_context', async () => {
    setSessionWithCountry(null);

    await service.sendMessage(SESSION_ID, USER_ID, ORG_ID, 'hello');

    expect(legalService.retrieveRelevantChunks).not.toHaveBeenCalled();
    expect(aiService.triggerChat.mock.calls[0][0].knowledge_context).toBeUndefined();
  });

  it('country not in allowlist (France) → retrieval never called', async () => {
    setSessionWithCountry('France');

    await service.sendMessage(SESSION_ID, USER_ID, ORG_ID, 'hello');

    expect(legalService.retrieveRelevantChunks).not.toHaveBeenCalled();
    expect(aiService.triggerChat.mock.calls[0][0].knowledge_context).toBeUndefined();
  });
});
