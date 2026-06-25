import * as path from 'path';
import { BadRequestException } from '@nestjs/common';

export const ALLOWED_CONTRACT_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);
export const ALLOWED_CONTRACT_EXTENSIONS = new Set(['.pdf', '.docx', '.doc']);

export const ALLOWED_DOCX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);
export const ALLOWED_DOCX_EXTENSIONS = new Set(['.docx', '.doc']);

export const ALLOWED_PDF_MIMES = new Set(['application/pdf']);
export const ALLOWED_PDF_EXTENSIONS = new Set(['.pdf']);

export function validateFileType(
  file: { mimetype: string; originalname: string },
  allowedMimes: Set<string>,
  allowedExtensions: Set<string>,
  label: string,
): void {
  if (!allowedMimes.has(file.mimetype)) {
    throw new BadRequestException(
      `Invalid file type. Only ${label} files are accepted.`,
    );
  }
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowedExtensions.has(ext)) {
    throw new BadRequestException(
      `Invalid file extension. Only ${label} files are accepted.`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Magic-bytes (content-signature) validation — Feature #4.
//
// `validateFileType` above trusts the CLIENT-declared MIME header and the
// filename extension; both are trivially spoofable (an executable renamed
// `.pdf` with `Content-Type: application/pdf` passes it). For the
// untrusted guest upload surface we ALSO sniff the real leading bytes of
// the buffer so a disguised payload is rejected before it is ever stored or
// handed to the AI pipeline.
//
// Accepted document signatures (matches the contract allowlist PDF/DOCX/DOC):
//   PDF  → 25 50 44 46            ("%PDF")
//   DOCX → 50 4B 03 04            ("PK\x03\x04" — OOXML is a ZIP container)
//   DOC  → D0 CF 11 E0 A1 B1 1A E1 (legacy OLE2 compound file)
// ─────────────────────────────────────────────────────────────────────────
const SIG_PDF = Buffer.from([0x25, 0x50, 0x44, 0x46]);
const SIG_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const SIG_OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/**
 * Assert the file's actual leading bytes match an accepted document type.
 *
 * Content-type-agnostic by design: `validateFileType` has already constrained
 * the declared MIME + extension, so this layer only needs to confirm the
 * CONTENT is genuinely one of the allowed document formats — not which one.
 * Throws `BadRequestException` on an empty/too-short buffer or any signature
 * mismatch.
 */
export function assertAllowedDocumentSignature(
  file: { buffer?: Buffer },
  label: string,
): void {
  const buf = file.buffer;
  if (!buf || buf.length < 4) {
    throw new BadRequestException(
      `Invalid or empty file. Only ${label} files are accepted.`,
    );
  }
  const head4 = buf.subarray(0, 4);
  const matches =
    head4.equals(SIG_PDF) ||
    head4.equals(SIG_ZIP) ||
    (buf.length >= 8 && buf.subarray(0, 8).equals(SIG_OLE2));
  if (!matches) {
    throw new BadRequestException(
      `File content does not match an accepted document type. Only ${label} files are accepted.`,
    );
  }
}
