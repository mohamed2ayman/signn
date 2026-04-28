import { BadRequestException } from '@nestjs/common';
import type { UploadedFile } from '../storage/storage.service';

export const MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_CHAT_ATTACHMENT_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  // .docx
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // .xlsx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]);

/**
 * Reject anything outside the allow-list before it touches StorageService.
 * StorageService itself enforces no limits — these caps are intentionally
 * scoped to the chat-attachment endpoint only.
 */
export function validateChatAttachment(file: UploadedFile | undefined): void {
  if (!file) return;

  if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
    throw new BadRequestException(
      `Attachment too large (max 10 MB; got ${Math.round(file.size / 1024)} KB).`,
    );
  }
  if (!ALLOWED_CHAT_ATTACHMENT_MIMES.has(file.mimetype)) {
    throw new BadRequestException(
      `Attachment type not allowed: ${file.mimetype}. Allowed: images, PDF, DOCX, XLSX, plain text.`,
    );
  }
}
