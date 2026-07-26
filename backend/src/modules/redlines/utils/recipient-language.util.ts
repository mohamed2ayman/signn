/**
 * 7.19 Slice 4 — recipient email/notification language.
 *
 * ⚠️ READ THIS BEFORE TRUSTING `users.preferred_language`.
 *
 * The column exists (`varchar(10) NOT NULL DEFAULT 'en'`, InitialSchema) and is
 * eager-selected on every User load, but until Slice 4 it had **zero read
 * paths** — nothing in the platform varied on it. It is also *stale by
 * construction*: the TopBar `LanguageToggle` (the switcher users actually use)
 * writes `localStorage` ONLY and never calls the API, while a separate
 * ProfilePage dropdown writes the column but does not change the UI. So an
 * Arabic-reading user very often still has `preferred_language = 'en'`.
 *
 * Consequence, stated honestly: this resolver is CORRECT but its input is
 * frequently uninformative, so most recipients get English — exactly what every
 * other email in the platform sends today. Users who set Profile → Preferred
 * Language, and guest-origin accounts (seeded from `invited_language` at guest
 * identity creation), do get their language. Making the column truthful is a
 * one-line frontend follow-up (fire a best-effort profile PATCH from
 * LanguageToggle) — deliberately OUT of this backend-only slice's scope.
 *
 * Neither write path validates the value (`@IsString()` / `@Length(2,5)`, never
 * `@IsIn`), so the column can legitimately hold arbitrary junk. This resolver
 * therefore ALLOWLISTS and never trusts the stored value — the `?? 'en'`
 * fallback is load-bearing, not defensive decoration.
 *
 * The platform ships THREE UI locales (en/ar/fr) but redline email copy exists
 * in two. `fr` deliberately resolves to `en` rather than falling through
 * unhandled; adding French copy is a copy task, not a code change.
 */

/** The languages redline notification copy is authored in. */
export type RedlineEmailLang = 'en' | 'ar';

/**
 * Map a stored `preferred_language` to a language we actually have copy for.
 * Pure + total: every input (null, undefined, '', 'fr', 'ar-EG', junk) returns
 * a valid lang. Region subtags are honoured (`ar-EG` → `ar`).
 */
export function resolveRecipientLang(
  preferred?: string | null,
): RedlineEmailLang {
  if (typeof preferred !== 'string') {
    return 'en';
  }
  const base = preferred.trim().toLowerCase().split(/[-_]/)[0];
  return base === 'ar' ? 'ar' : 'en';
}

/** True when copy should render right-to-left. */
export function isRtlLang(lang: RedlineEmailLang): boolean {
  return lang === 'ar';
}
