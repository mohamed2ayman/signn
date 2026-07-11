import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ChatService } from '../chat.service';
import { ChatSession, ChatMessage } from '../../../database/entities';
import { AiService } from '../../ai/ai.service';
import { LegalDocumentsService } from '../../legal-documents/legal-documents.service';
import { ContractScopedRepository } from '../../scoped-repository/contract-scoped.repository';

/**
 * Phase 7.27 — contract-context grounding in chat. Verifies that
 * ChatService.sendMessage assembles the contract's active clauses into a
 * `contract_context` block and passes it to triggerChat:
 *  - contract with active clauses → contract_context present (metadata + clauses)
 *  - contract with no clauses     → contract_context undefined
 *  - session with no contract_id  → contract_context undefined + no chokepoint load
 *
 * The scoped chokepoint (scopedFindByIdWithClauses) and the legal retrieval are
 * both mocked — this is a pure assembler/dispatch wiring test.
 */
describe('ChatService — contract-context grounding (Phase 7.27)', () => {
  let service: ChatService;

  const SESSION_ID = 'sess-ctx';
  const CONTRACT_ID = 'contract-ctx';
  const USER_ID = 'user-ctx';
  const ORG_ID = 'org-ctx';

  const sessionRepo = { findOne: jest.fn(), save: jest.fn(), create: jest.fn() };
  const messageRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn(), create: jest.fn() };
  const contractScoped = { scopedFindByIdWithClauses: jest.fn() };
  const aiService = {
    triggerChat: jest.fn().mockResolvedValue({ job_id: 'job-ctx', status: 'queued' }),
    getJobStatus: jest.fn(),
  };
  // No jurisdiction on the mock contracts below → legal path is a silent no-op;
  // mocked anyway so an accidental call can't hit real embeddings.
  const legalService = { retrieveRelevantChunks: jest.fn().mockResolvedValue([]) };

  const CLAUSE_A = {
    section_number: '1',
    order_index: 0,
    clause: {
      is_active: true,
      clause_type: 'PAYMENT',
      title: 'Payment Terms',
      content: 'The Employer shall pay within 30 days of certification.',
    },
  };
  const CLAUSE_B = {
    section_number: '2',
    order_index: 1,
    clause: {
      is_active: true,
      clause_type: 'TERMINATION',
      title: 'Termination for Convenience',
      content: 'Either party may terminate on 60 days written notice.',
    },
  };

  function primeRepos(contractIdOnSession: string | null) {
    sessionRepo.findOne.mockResolvedValue({
      id: SESSION_ID,
      user_id: USER_ID,
      contract_id: contractIdOnSession,
      updated_at: new Date(),
    });
    messageRepo.create.mockImplementation((x) => x);
    messageRepo.save.mockImplementation(async (x) => ({ id: 'm1', created_at: new Date(), ...x }));
    messageRepo.find.mockResolvedValue([]);
    sessionRepo.save.mockResolvedValue({});
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    aiService.triggerChat.mockResolvedValue({ job_id: 'job-ctx', status: 'queued' });
    legalService.retrieveRelevantChunks.mockResolvedValue([]);

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

  it('passes contract_context to triggerChat when the contract has active clauses', async () => {
    primeRepos(CONTRACT_ID);
    contractScoped.scopedFindByIdWithClauses.mockResolvedValue({
      id: CONTRACT_ID,
      name: 'Depot Construction Agreement',
      contract_type: 'FIDIC',
      status: 'ACTIVE',
      project: undefined, // no jurisdiction → legal path skipped, focus on clauses
      contract_clauses: [CLAUSE_A, CLAUSE_B],
    });

    await service.sendMessage(SESSION_ID, USER_ID, ORG_ID, 'what are the payment terms?');

    expect(contractScoped.scopedFindByIdWithClauses).toHaveBeenCalledWith(CONTRACT_ID, ORG_ID);
    const arg = aiService.triggerChat.mock.calls[0][0];
    expect(arg.contract_context).toEqual(expect.stringContaining('### Contract metadata'));
    // Both clause titles present in the assembled block.
    expect(arg.contract_context).toContain('Payment Terms');
    expect(arg.contract_context).toContain('Termination for Convenience');
  });

  it('does NOT pass contract_context when the contract has no clauses', async () => {
    primeRepos(CONTRACT_ID);
    contractScoped.scopedFindByIdWithClauses.mockResolvedValue({
      id: CONTRACT_ID,
      name: 'Empty Contract',
      project: undefined,
      contract_clauses: [],
    });

    await service.sendMessage(SESSION_ID, USER_ID, ORG_ID, 'anything?');

    const arg = aiService.triggerChat.mock.calls[0][0];
    expect(arg.contract_context).toBeUndefined();
  });

  it('does NOT load or pass contract_context when the session has no contract_id', async () => {
    primeRepos(null);

    await service.sendMessage(SESSION_ID, USER_ID, ORG_ID, 'general question');

    expect(contractScoped.scopedFindByIdWithClauses).not.toHaveBeenCalled();
    const arg = aiService.triggerChat.mock.calls[0][0];
    expect(arg.contract_context).toBeUndefined();
  });
});
