/**
 * Escapes HTML special characters in strings that will be
 * interpolated into email HTML templates.
 *
 * Use this on ALL user-supplied strings before inserting them
 * into email template literals. Prevents HTML injection attacks
 * where a malicious display name or organization name contains
 * HTML tags or event handlers.
 *
 * Example attack prevented:
 *   User sets name to: <img src=x onerror="steal(document.cookie)">
 *   Without escaping: email renders and executes the onerror handler
 *   With escaping:    email displays literal text, no execution
 *
 * This is OUTPUT escaping (for email rendering), not INPUT
 * sanitization. Both are needed for defense in depth:
 * - sanitize.ts (Phase 3.2): strips HTML from DB-stored content
 * - escape-html-email.ts (Phase 3.5): escapes output in emails
 *
 * Escape order matters — & must always be first. If < were escaped
 * before &, then &lt; would become &amp;lt; (double-escape bug).
 */
export function escapeHtml(str: string | null | undefined): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')   // must be first
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
