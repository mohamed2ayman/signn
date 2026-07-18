import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import ModalShell from '@/components/obligations/ModalShell';
import { projectService } from '@/services/api/projectService';
import {
  importSharedContract,
  type ImportedContractResult,
} from '@/services/api/guestService';

type Phase = 'confirm' | 'importing' | 'success' | 'error';
type ErrorKind = 'revoked' | 'planLimit' | 'generic';

/**
 * "Import to my workspace" (#8d) — the confirm → importing → success/failure
 * modal, on the app's shared ModalShell (the guest identity-modal precedent).
 *
 * Semantics the confirm state must make unmistakable (the design's three
 * points): (1) a COPY is created in the importer's org — the original stays
 * with the sharing org, unmodified and un-notified; (2) the importer runs
 * their OWN analysis on the copy; (3) the copy does NOT stay in sync.
 *
 * Failure branches:
 *   - revoked (404): the binding disappeared between page-open and click —
 *     the design's "no longer shared with you" state, exit back to the list.
 *   - planLimit: keyed on a `PLAN_LIMIT_CONTRACTS` error code. DORMANT in v1 —
 *     no per-org contract-count limit exists in the backend (only the dead
 *     org-blind SubscriptionGuard), so this branch is currently UNREACHABLE;
 *     it exists so the UI is ready the day a real quota model ships.
 *   - generic: stays open for a deliberate retry.
 *
 * Re-entry safety (lesson #238): a synchronous in-flight ref guards the
 * confirm action — acquired BEFORE the request (two same-tick clicks produce
 * ONE POST), released in finally (a deliberate retry after failure genuinely
 * re-POSTs). Close is inert while importing (the InvitePartyDialog precedent).
 */
export default function ImportContractModal({
  isOpen,
  onClose,
  contractId,
  contractName,
  sharedByOrg,
  guestJwt,
}: {
  isOpen: boolean;
  onClose: () => void;
  contractId: string;
  contractName: string;
  /** The sharing org's display name (null → the i18n fallback). */
  sharedByOrg: string | null;
  /** The managing access token — explicit Bearer on the isolated guestHttp. */
  guestJwt: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>('confirm');
  const [errorKind, setErrorKind] = useState<ErrorKind>('generic');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [result, setResult] = useState<ImportedContractResult | null>(null);
  const importInFlight = useRef(false);

  // The destination picker — the caller's OWN projects (normal authed client;
  // shares the app-wide ['projects'] cache).
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectService.getAll(),
    enabled: isOpen,
  });
  const projects = projectsQuery.data ?? [];

  // Default the picker to the first project once loaded (nothing selected yet).
  useEffect(() => {
    if (isOpen && !selectedProjectId && projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    }
  }, [isOpen, selectedProjectId, projects]);

  // Fresh state on every open.
  useEffect(() => {
    if (isOpen) {
      setPhase('confirm');
      setErrorKind('generic');
      setResult(null);
    }
  }, [isOpen]);

  const org = sharedByOrg ?? t('sharedWithMe.banner.orgFallback');
  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  // Close is INERT while the import is in flight — a half-dismissed modal
  // over a running write is how double-imports happen.
  const handleClose = () => {
    if (phase === 'importing') return;
    onClose();
  };

  const confirmImport = async () => {
    // Synchronous re-entry guard — BEFORE any await (lesson #238).
    if (importInFlight.current || !selectedProjectId) return;
    importInFlight.current = true;
    setPhase('importing');
    try {
      const res = await importSharedContract(
        contractId,
        guestJwt,
        selectedProjectId,
      );
      setResult(res);
      setPhase('success');
    } catch (err: any) {
      const status = err?.response?.status;
      const code = err?.response?.data?.code ?? err?.response?.data?.error;
      if (status === 404) {
        // The binding was revoked between opening the viewer and clicking
        // Import (or the contract is gone) — nothing was copied.
        setErrorKind('revoked');
      } else if (code === 'PLAN_LIMIT_CONTRACTS') {
        // Dormant v1 branch — see the header comment.
        setErrorKind('planLimit');
      } else {
        setErrorKind('generic');
      }
      setPhase('error');
    } finally {
      importInFlight.current = false;
    }
  };

  const footer =
    phase === 'confirm' ? (
      <>
        <button
          type="button"
          onClick={handleClose}
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
        >
          {t('sharedWithMe.import.cancel')}
        </button>
        <button
          type="button"
          onClick={confirmImport}
          disabled={!selectedProjectId || projects.length === 0}
          data-testid="import-confirm"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('sharedWithMe.import.confirm')}
        </button>
      </>
    ) : phase === 'error' && errorKind === 'generic' ? (
      <>
        <button
          type="button"
          onClick={handleClose}
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
        >
          {t('sharedWithMe.import.cancel')}
        </button>
        <button
          type="button"
          onClick={() => setPhase('confirm')}
          data-testid="import-retry"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-600"
        >
          {t('sharedWithMe.import.retry')}
        </button>
      </>
    ) : undefined;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={handleClose}
      title={t('sharedWithMe.import.title')}
      subtitle={t('sharedWithMe.import.from', { name: contractName, org })}
      size="md"
      footer={footer}
    >
      {phase === 'confirm' && (
        <div className="space-y-4">
          {/* The three semantics — the heart of the modal (design §8.2). */}
          <ul className="space-y-3">
            <li className="flex gap-3">
              <span aria-hidden="true" className="mt-0.5 text-base">
                📄
              </span>
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {t('sharedWithMe.import.point1.title')}
                </p>
                <p className="text-sm text-gray-600" dir="auto">
                  {t('sharedWithMe.import.point1.body', { org })}
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span aria-hidden="true" className="mt-0.5 text-base">
                🛡️
              </span>
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {t('sharedWithMe.import.point2.title')}
                </p>
                <p className="text-sm text-gray-600">
                  {t('sharedWithMe.import.point2.body')}
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span aria-hidden="true" className="mt-0.5 text-base">
                🔗
              </span>
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {t('sharedWithMe.import.point3.title')}
                </p>
                <p className="text-sm text-gray-600" dir="auto">
                  {t('sharedWithMe.import.point3.body', { org })}
                </p>
              </div>
            </li>
          </ul>

          {/* Destination-project picker — the caller's OWN projects. */}
          <div>
            <label
              htmlFor="import-destination-project"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              {t('sharedWithMe.import.project')}
            </label>
            {projectsQuery.isLoading ? (
              <div className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-400">
                {t('sharedWithMe.import.loadingProjects')}
              </div>
            ) : projects.length === 0 ? (
              <p
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
                data-testid="import-no-projects"
              >
                {t('sharedWithMe.import.noProjects')}
              </p>
            ) : (
              <select
                id="import-destination-project"
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                data-testid="import-project-select"
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}

      {phase === 'importing' && (
        <div
          className="flex flex-col items-center gap-3 py-8 text-center"
          data-testid="import-importing"
        >
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm font-medium text-gray-900">
            {t('sharedWithMe.import.importing')}
          </p>
          <p className="text-sm text-gray-500" dir="auto">
            {t('sharedWithMe.import.importingBody', {
              project: selectedProject?.name ?? '',
            })}
          </p>
        </div>
      )}

      {phase === 'success' && result && (
        <div
          className="flex flex-col items-center gap-3 py-6 text-center"
          data-testid="import-success"
        >
          {/* Emerald check disc — the GuestUploadStatus success vocabulary. */}
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
            <svg
              className="h-6 w-6 text-emerald-600"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <p className="text-base font-semibold text-gray-900">
            {t('sharedWithMe.import.successTitle')}
          </p>
          <p className="text-sm text-gray-600" dir="auto">
            {t('sharedWithMe.import.successBody', {
              name: contractName,
              project: selectedProject?.name ?? '',
            })}
          </p>
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
            >
              {t('sharedWithMe.import.stay')}
            </button>
            <button
              type="button"
              onClick={() => navigate(`/app/contracts/${result.id}`)}
              data-testid="import-open-copy"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-600"
            >
              {t('sharedWithMe.import.open')}
            </button>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="py-2" data-testid="import-error">
          {errorKind === 'revoked' ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
              <p className="text-sm font-semibold text-red-800">
                {t('sharedWithMe.revoked.title')}
              </p>
              <p className="mt-1 text-sm text-red-700">
                {t('sharedWithMe.revoked.body')}
              </p>
              <Link
                to="/app/shared-with-me"
                className="mt-3 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600"
              >
                {t('sharedWithMe.banner.back')}
              </Link>
            </div>
          ) : errorKind === 'planLimit' ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
              <p className="text-sm font-semibold text-amber-800">
                {t('sharedWithMe.import.planLimitTitle')}
              </p>
              <p className="mt-1 text-sm text-amber-700">
                {t('sharedWithMe.import.planLimitBody')}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
              <p className="text-sm font-semibold text-red-800">
                {t('sharedWithMe.import.failTitle')}
              </p>
              <p className="mt-1 text-sm text-red-700">
                {t('sharedWithMe.import.failBody')}
              </p>
            </div>
          )}
        </div>
      )}
    </ModalShell>
  );
}
