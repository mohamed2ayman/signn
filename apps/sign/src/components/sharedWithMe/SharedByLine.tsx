import { useTranslation } from 'react-i18next';

/**
 * The shared-by provenance line on a "Shared with me" row.
 *
 * The API sends two UN-COMPOSED nullable atoms (`shared_by_org` +
 * `shared_by_user`) and the frontend composes the line (lesson #260). The
 * four cases render exactly:
 *   both        → "{org} · shared by {person}"
 *   org only    → "{org}"
 *   person only → "Shared by {person}"
 *   neither     → "Shared with you"   (the row never collapses to blank)
 *
 * The server already normalizes whitespace to null and never emits ""/UUIDs;
 * the local `label()` guard re-applies the same rule as defense so a blank
 * atom can never render as an empty or garbage fragment.
 */
function label(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

export default function SharedByLine({
  org,
  user,
}: {
  org: string | null | undefined;
  user: string | null | undefined;
}) {
  const { t } = useTranslation();
  const orgName = label(org);
  const userName = label(user);

  // Both names are user-typed free text and may be Arabic inside an English
  // UI (or Latin inside Arabic) — each name span isolates its own direction.
  const nameStyle = { unicodeBidi: 'plaintext' } as const;

  return (
    <p className="mt-0.5 text-xs text-gray-500">
      {orgName && userName ? (
        <>
          <span dir="auto" className="font-medium text-gray-600" style={nameStyle}>
            {orgName}
          </span>
          {' · '}
          {t('sharedWithMe.sharedBy')}{' '}
          <span dir="auto" style={nameStyle}>
            {userName}
          </span>
        </>
      ) : orgName ? (
        <span dir="auto" className="font-medium text-gray-600" style={nameStyle}>
          {orgName}
        </span>
      ) : userName ? (
        <>
          {t('sharedWithMe.sharedByPerson')}{' '}
          <span dir="auto" style={nameStyle}>
            {userName}
          </span>
        </>
      ) : (
        t('sharedWithMe.sharedWithYou')
      )}
    </p>
  );
}
