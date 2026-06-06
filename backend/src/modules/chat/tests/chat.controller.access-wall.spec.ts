import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';

import { ChatController } from '../chat.controller';
import { ChatService } from '../chat.service';
import { ContractAccessService } from '../../contracts/services/contract-access.service';

/**
 * Tenant-isolation Tier 1 — controller-level access-wall spec for the
 * chat session-creation entry point. The bug class: a session created
 * with a cross-tenant `contract_id` becomes a poisoned session — every
 * subsequent `POST /chat/sessions/:id/messages` inherits that
 * contract_id and forwards it (with the caller's org_id) into the AI
 * backend. Closing the createSession path closes the inherited
 * sendMessage path too.
 */
describe('ChatController — cross-tenant access wall (Tier 1)', () => {
  let controller: ChatController;
  let chat: jest.Mocked<ChatService>;
  let contractAccess: jest.Mocked<ContractAccessService>;

  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
  const USER_IN_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  beforeEach(async () => {
    chat = {
      createSession: jest.fn(),
      findSessionByContract: jest.fn(),
      getSessionMessages: jest.fn(),
      sendMessage: jest.fn(),
    } as unknown as jest.Mocked<ChatService>;

    contractAccess = {
      findInOrg: jest.fn(),
    } as unknown as jest.Mocked<ContractAccessService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: chat },
        { provide: ContractAccessService, useValue: contractAccess },
      ],
    }).compile();

    controller = module.get(ChatController);
  });

  describe('POST /chat/sessions (createSession)', () => {
    it('cross-tenant with contract_id: 404 and createSession NEVER called', async () => {
      contractAccess.findInOrg.mockRejectedValue(
        new NotFoundException('Contract not found'),
      );

      await expect(
        controller.createSession(
          { contract_id: CONTRACT_IN_B },
          { id: USER_IN_A },
          ORG_A,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
      // CRITICAL: no ChatSession row is written carrying a cross-tenant
      // contract_id — the upstream gap that sendMessage inherits.
      expect(chat.createSession).not.toHaveBeenCalled();
    });

    it('no contract_id (unscoped session): wall is skipped, session created', async () => {
      chat.createSession.mockResolvedValue({ id: 'session-1' } as any);

      const result = await controller.createSession(
        {},
        { id: USER_IN_A },
        ORG_A,
      );

      expect(contractAccess.findInOrg).not.toHaveBeenCalled();
      expect(chat.createSession).toHaveBeenCalledWith(
        USER_IN_A,
        ORG_A,
        undefined,
      );
      expect(result).toEqual({ id: 'session-1' });
    });

    it('in-org contract_id: wall passes, session created', async () => {
      contractAccess.findInOrg.mockResolvedValue({} as any);
      chat.createSession.mockResolvedValue({ id: 'session-1' } as any);

      await controller.createSession(
        { contract_id: 'contract-in-a' },
        { id: USER_IN_A },
        ORG_A,
      );

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        'contract-in-a',
        ORG_A,
      );
      expect(chat.createSession).toHaveBeenCalledWith(
        USER_IN_A,
        ORG_A,
        'contract-in-a',
      );
    });

    it('no-org caller with contract_id: 404 and findInOrg NEVER called', async () => {
      await expect(
        controller.createSession(
          { contract_id: CONTRACT_IN_B },
          { id: USER_IN_A },
          '' as any,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).not.toHaveBeenCalled();
      expect(chat.createSession).not.toHaveBeenCalled();
    });
  });
});
