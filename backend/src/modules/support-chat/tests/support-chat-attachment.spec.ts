import { ForbiddenException } from '@nestjs/common';
import * as fs from 'fs';

// Isolate sendMessage from the real attachment validator (mime/size checks).
jest.mock('../chat-attachment.validator', () => ({
  validateChatAttachment: jest.fn(),
}));

import {
  serializeSupportChatMessage,
  serializeSupportChatMessages,
  CHAT_ATTACHMENT_URL_TTL_SECONDS,
} from '../support-chat-message.serializer';
import { SupportGateway } from '../support.gateway';
import { SupportChatMessageService } from '../support-chat-message.service';
import { SupportChatService } from '../support-chat.service';
import { LocalStorageAdapter } from '../../storage/adapters/local-storage.adapter';
import { SupportChatMessage } from '../../../database/entities';

const RAW_URL = 'http://localhost:3000/uploads/support-chat/raw.pdf';

function msgWithAttachment(): SupportChatMessage {
  return {
    id: 'm1',
    chat_id: 'c1',
    attachment_url: RAW_URL,
    attachment_name: 'raw.pdf',
    body: 'see file',
  } as SupportChatMessage;
}
function msgNoAttachment(): SupportChatMessage {
  return { id: 'm2', chat_id: 'c1', attachment_url: null, body: 'hi' } as SupportChatMessage;
}

const mockStorage = () => ({
  getDownloadUrl: jest.fn(async (url: string) => `presigned:${url}`),
  uploadFile: jest.fn(async () => ({
    file_url: RAW_URL,
    file_name: 'raw.pdf',
    mime_type: 'application/pdf',
    file_size: 1234,
  })),
});

// ─────────────────────────────────────────────────────────────────────────────

describe('support-chat attachment presigning', () => {
  describe('serializeSupportChatMessage (the shared serializer)', () => {
    it('presigns the attachment_url from the raw value, leaving the original intact', async () => {
      const storage = mockStorage() as any;
      const original = msgWithAttachment();

      const out = await serializeSupportChatMessage(original, storage);

      expect(out.attachment_url).toBe(`presigned:${RAW_URL}`);
      expect(storage.getDownloadUrl).toHaveBeenCalledWith(
        RAW_URL,
        CHAT_ATTACHMENT_URL_TTL_SECONDS,
      );
      // A copy — the persisted entity's canonical URL is untouched.
      expect(original.attachment_url).toBe(RAW_URL);
    });

    it('returns a message with NO attachment untouched, minting nothing', async () => {
      const storage = mockStorage() as any;
      const original = msgNoAttachment();

      const out = await serializeSupportChatMessage(original, storage);

      expect(out.attachment_url).toBeNull();
      expect(storage.getDownloadUrl).not.toHaveBeenCalled();
    });

    it('serializeSupportChatMessages maps a list and mints only for those with attachments', async () => {
      const storage = mockStorage() as any;
      const out = await serializeSupportChatMessages(
        [msgWithAttachment(), msgNoAttachment()],
        storage,
      );
      expect(out[0].attachment_url).toBe(`presigned:${RAW_URL}`);
      expect(out[1].attachment_url).toBeNull();
      expect(storage.getDownloadUrl).toHaveBeenCalledTimes(1);
    });
  });

  describe('LocalStorageAdapter.getDownloadUrl (local dev unbroken)', () => {
    it('returns the input URL unchanged', async () => {
      const existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      const adapter = new LocalStorageAdapter('/tmp/uploads', 'http://localhost:3000');
      await expect(adapter.getDownloadUrl(RAW_URL)).resolves.toBe(RAW_URL);
      existsSpy.mockRestore();
    });
  });

  describe('SupportGateway.emitMessage (WebSocket path — the presign chokepoint)', () => {
    function makeGateway() {
      const storage = mockStorage() as any;
      const gateway = new SupportGateway({ get: jest.fn() } as any, storage);
      const emit = jest.fn();
      (gateway as any).server = { to: jest.fn(() => ({ emit })) };
      return { gateway, storage, emit };
    }

    it('presigns the attachment before broadcasting', async () => {
      const { gateway, storage, emit } = makeGateway();
      await gateway.emitMessage('c1', msgWithAttachment());
      expect(storage.getDownloadUrl).toHaveBeenCalledWith(
        RAW_URL,
        CHAT_ATTACHMENT_URL_TTL_SECONDS,
      );
      expect(emit).toHaveBeenCalledWith(
        'support:message',
        expect.objectContaining({ attachment_url: `presigned:${RAW_URL}` }),
      );
    });

    it('broadcasts a no-attachment message as-is, minting nothing', async () => {
      const { gateway, storage, emit } = makeGateway();
      await gateway.emitMessage('c1', msgNoAttachment());
      expect(storage.getDownloadUrl).not.toHaveBeenCalled();
      expect(emit).toHaveBeenCalledWith(
        'support:message',
        expect.objectContaining({ attachment_url: null }),
      );
    });

    it('falls back to the RAW message if presigning throws (never loses the broadcast)', async () => {
      const { gateway, storage, emit } = makeGateway();
      storage.getDownloadUrl.mockRejectedValueOnce(new Error('s3 down'));
      const raw = msgWithAttachment();
      await gateway.emitMessage('c1', raw);
      expect(emit).toHaveBeenCalledWith('support:message', raw);
    });
  });

  describe('SupportChatMessageService.sendMessage (HTTP send path)', () => {
    function build(chatOrThrow: { chat?: any; throws?: boolean }) {
      const storage = mockStorage() as any;
      const gateway = { emitMessage: jest.fn() } as any;
      const chatService = {
        getChatById: jest.fn(async () => {
          if (chatOrThrow.throws) throw new ForbiddenException('no access');
          return chatOrThrow.chat;
        }),
      } as any;
      const messageRepo = {
        create: jest.fn((x) => x),
        save: jest.fn(async (m) => ({ ...m, id: 'saved-1' })),
      } as any;
      const svc = new SupportChatMessageService(
        {} as any,
        messageRepo,
        storage,
        gateway,
        chatService,
      );
      return { svc, storage, gateway };
    }

    it('NEVER mints for an unauthorized actor (getChatById throws before any presign)', async () => {
      const { svc, storage } = build({ throws: true });
      await expect(
        svc.sendMessage('c1', { id: 'attacker', role: 'USER' } as any, 'hi', undefined),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(storage.getDownloadUrl).not.toHaveBeenCalled();
      expect(storage.uploadFile).not.toHaveBeenCalled();
    });

    it('authorized send: returns a presigned attachment_url and emits the raw message', async () => {
      const { svc, storage, gateway } = build({ chat: { status: 'ACTIVE' } });
      const file = {
        buffer: Buffer.from('x'),
        originalname: 'raw.pdf',
        mimetype: 'application/pdf',
        size: 1234,
      } as any;

      const out = await svc.sendMessage(
        'c1',
        { id: 'owner', role: 'USER' } as any,
        undefined,
        file,
      );

      // HTTP response is presigned…
      expect(out.attachment_url).toBe(`presigned:${RAW_URL}`);
      // …and the socket emit received the RAW saved message (the gateway presigns it).
      expect(gateway.emitMessage).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ attachment_url: RAW_URL }),
      );
    });
  });

  describe('SupportChatService.getChatWithMessages (HTTP transcript path)', () => {
    function build(chat: any) {
      const storage = mockStorage() as any;
      const chatRepo = { findOne: jest.fn(async () => chat) } as any;
      const messageRepo = {
        find: jest.fn(async () => [msgWithAttachment(), msgNoAttachment()]),
      } as any;
      const svc = new SupportChatService(
        chatRepo,
        messageRepo,
        {} as any, // userRepo
        {} as any, // auditRepo
        { emitMessage: jest.fn() } as any, // gateway
        storage,
      );
      return { svc, storage, messageRepo };
    }

    it('NEVER mints when the actor cannot access the chat (assertCanAccessChat throws)', async () => {
      const { svc, storage, messageRepo } = build({
        id: 'c1',
        user_id: 'someone-else',
        organization_id: 'org-x',
      });
      await expect(
        svc.getChatWithMessages('c1', {
          id: 'attacker',
          email: 'a@x.com',
          role: 'USER',
          organization_id: 'org-y',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(messageRepo.find).not.toHaveBeenCalled();
      expect(storage.getDownloadUrl).not.toHaveBeenCalled();
    });

    it('authorized transcript: presigns each message that has an attachment', async () => {
      const { svc, storage } = build({
        id: 'c1',
        user_id: 'owner',
        organization_id: 'org-1',
      });
      const out = await svc.getChatWithMessages('c1', {
        id: 'owner',
        email: 'owner@x.com',
        role: 'USER',
        organization_id: 'org-1',
      });
      expect(out.messages[0].attachment_url).toBe(`presigned:${RAW_URL}`);
      expect(out.messages[1].attachment_url).toBeNull();
      expect(storage.getDownloadUrl).toHaveBeenCalledTimes(1);
    });
  });
});
