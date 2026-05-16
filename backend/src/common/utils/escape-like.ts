/**
 * Escapes PostgreSQL LIKE/ILIKE special characters in user-supplied search strings.
 *
 * Without escaping, a search for "100%" would match "1000", "100abc", etc.
 * because % is a wildcard. Similarly "_" matches any single character.
 *
 * Usage:
 *   .andWhere('col ILIKE :search', { search: `%${escapeLikeParam(userInput)}%` })
 *
 * Characters escaped (backslash first to avoid double-escaping):
 *   \  →  \\
 *   %  →  \%
 *   _  →  \_
 */
export function escapeLikeParam(value: string): string {
  if (!value) return value;
  return value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}
