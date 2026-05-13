import * as sanitizeHtml from 'sanitize-html';

/**
 * Strips ALL HTML tags and attributes from a string value.
 * Used by @Transform decorators on DTO fields that should never contain HTML.
 *
 * Why: defense in depth for downstream consumers (AI prompts, PDF reports,
 * email templates) that don't have React's auto-escaping protection.
 *
 * Safe behaviors:
 * - undefined/null pass through unchanged (so @IsOptional fields work)
 * - Non-string values pass through unchanged (defensive)
 * - Plain text including Arabic, bullets (-), and Unicode is preserved
 * - Only HTML tag syntax and attributes are removed
 *
 * Import syntax: `import * as sanitizeHtml` (not default import) because
 * @types/sanitize-html uses `export =` and this project has no esModuleInterop.
 */
export function stripHtml(value: unknown): unknown {
  if (value == null || typeof value !== 'string') return value;
  return sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {},
  });
}
