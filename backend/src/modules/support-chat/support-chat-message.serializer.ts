import { StorageService } from '../storage/storage.service';
import { SupportChatMessage } from '../../database/entities';

/**
 * Presigned-URL TTL for support-chat attachments.
 *
 * A support agent commonly keeps a transcript open for a whole working day, so
 * the default 1h presign would return access-denied on an old attachment click.
 * 24h covers a full shift while still bounding the exposure window if a signed
 * URL leaks. ONE constant used for every attachment mint (HTTP transcript, HTTP
 * send response, and the WebSocket broadcast) so the paths never diverge.
 */
export const CHAT_ATTACHMENT_URL_TTL_SECONDS = 24 * 60 * 60; // 24h

/**
 * Map a support-chat message to its client-facing DTO, replacing the stored
 * (canonical) `attachment_url` with a presigned download URL so the link works
 * against a private S3 bucket. In local dev `getDownloadUrl` returns the URL
 * unchanged. A message with no attachment is returned untouched (no mint).
 *
 * 🔒 SECURITY: a presigned URL is a working, auth-bypassing link. This MUST be
 * called ONLY AFTER the caller has passed the chat's permission check
 * (`assertCanAccessChat` for the HTTP transcript; the sender's `getChatById`
 * gate for the send + socket emit). Never before the guard, never in a shared
 * pre-auth helper.
 *
 * Returns a shallow copy — the persisted entity's canonical URL is left intact.
 */
export async function serializeSupportChatMessage(
  message: SupportChatMessage,
  storage: StorageService,
): Promise<SupportChatMessage> {
  if (!message || !message.attachment_url) return message;
  const download_url = await storage.getDownloadUrl(
    message.attachment_url,
    CHAT_ATTACHMENT_URL_TTL_SECONDS,
  );
  return { ...message, attachment_url: download_url };
}

export async function serializeSupportChatMessages(
  messages: SupportChatMessage[],
  storage: StorageService,
): Promise<SupportChatMessage[]> {
  return Promise.all(
    (messages ?? []).map((m) => serializeSupportChatMessage(m, storage)),
  );
}
