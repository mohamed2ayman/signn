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
