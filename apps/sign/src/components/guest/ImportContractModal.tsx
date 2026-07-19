import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
 * modal, built to the approved design export (SIGN_Shared_Contracts.html):
 *
 *   CONFIRM — identity-echo card (contract name + "from {org}"), the three
 *   semantics as icon-disc rows (copy/primary · shield-check/green ·
 *   link/amber), then the destination-project picker. Footer: Cancel +
 *   Import contract.
 *   IMPORTING — 44px primary spinner + "Importing contract…" + the
 *   copying-into-{project} subline. Close inert.
 *   SUCCESS — 58px emerald check disc + "Imported to your workspace" +
 *   subline; Stay here (outline) + Open my copy (filled) → the new
 *   contract's managing detail page.
 *   FAILURE — one unified layout (58px danger alert disc + "Import failed" +
 *   a cause-specific body): revoked (404 — the binding disappeared) exits
 *   back to Shared with me; plan-limit (`PLAN_LIMIT_CONTRACTS` — DORMANT in
 *   v1, no backend quota emits it) offers View plans; generic retries.
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
    ) : undefined;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={handleClose}
      title={t('sharedWithMe.import.title')}
      size="md"
      footer={footer}
    >
      {phase === 'confirm' && (
        <div className="space-y-4">
          {/* Identity echo — the contract being imported + who shared it
              (the design's gray card, NOT a shell subtitle). */}
          <div className="rounded-xl border border-gray-200 bg-gray-50/60 px-3.5 py-3">
            <p
              className="text-sm font-bold text-gray-900"
              dir="auto"
              style={{ unicodeBidi: 'plaintext' }}
            >
              {contractName}
            </p>
            <p className="mt-0.5 text-[12.5px] text-gray-500" dir="auto">
              {t('sharedWithMe.import.from', { org })}
            </p>
          </div>

          {/* The three semantics — icon-disc rows (the heart of the modal). */}
          <ul className="space-y-3.5">
            <li className="flex items-start gap-3">
              {/* Copy icon — primary tint */}
              <span
                aria-hidden="true"
                className="inline-flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary"
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M6.5 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v.5" />
                </svg>
              </span>
              <div className="min-w-0">
                <p className="text-[13.5px] font-bold text-gray-900">
                  {t('sharedWithMe.import.point1.title')}
                </p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-gray-500" dir="auto">
                  {t('sharedWithMe.import.point1.body', { org })}
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              {/* Shield-check icon — green tint */}
              <span
                aria-hidden="true"
                className="inline-flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[10px] bg-emerald-50 text-emerald-600"
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3l7 2.5v5.5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V5.5z" />
                  <path d="m9.5 12 1.8 1.8L15 10" />
                </svg>
              </span>
              <div className="min-w-0">
                <p className="text-[13.5px] font-bold text-gray-900">
                  {t('sharedWithMe.import.point2.title')}
                </p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-gray-500">
                  {t('sharedWithMe.import.point2.body')}
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              {/* Link icon — amber tint */}
              <span
                aria-hidden="true"
                className="inline-flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[10px] bg-amber-50 text-amber-600"
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10 14a4 4 0 0 0 5.7.3l2-2A4 4 0 0 0 12 6.6l-1 1" />
                  <path d="M14 10a4 4 0 0 0-5.7-.3l-2 2A4 4 0 0 0 12 17.4l1-1" />
                </svg>
              </span>
              <div className="min-w-0">
                <p className="text-[13.5px] font-bold text-gray-900">
                  {t('sharedWithMe.import.point3.title')}
                </p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-gray-500">
                  {t('sharedWithMe.import.point3.body')}
                </p>
              </div>
            </li>
          </ul>

          {/* Destination-project picker — the caller's OWN projects. */}
          <div>
            <label
              htmlFor="import-destination-project"
              className="mb-1.5 block text-xs font-bold text-gray-500"
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
                className="h-[42px] w-full rounded-[10px] border border-gray-200 bg-gray-50/60 px-3.5 text-sm font-semibold text-gray-900 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
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
          className="flex flex-col items-center gap-4 py-8 text-center"
          data-testid="import-importing"
        >
          <div className="h-11 w-11 animate-spin rounded-full border-2 border-gray-200 border-t-primary" />
          <p className="text-base font-bold text-gray-900">
            {t('sharedWithMe.import.importing')}
          </p>
          <p className="max-w-[340px] text-[13px] leading-relaxed text-gray-500" dir="auto">
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
          {/* 58px emerald check disc — the design's success vocabulary. */}
          <div className="flex h-[58px] w-[58px] items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <svg
              width="30"
              height="30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m5 13 4 4 10-11" />
            </svg>
          </div>
          <p className="text-[17px] font-extrabold text-gray-900">
            {t('sharedWithMe.import.successTitle')}
          </p>
          <p className="max-w-[360px] text-[13.5px] leading-relaxed text-gray-500" dir="auto">
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
              className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-600"
            >
              {t('sharedWithMe.import.open')}
            </button>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div
          className="flex flex-col items-center gap-3 py-6 text-center"
          data-testid="import-error"
        >
          {/* 58px danger alert disc — ONE unified failure layout; the body
              carries the cause. */}
          <div className="flex h-[58px] w-[58px] items-center justify-center rounded-full bg-red-50 text-red-500">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.9}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7.5v5.5" />
              <path d="M12 16.2h.01" />
            </svg>
          </div>
          <p className="text-[17px] font-extrabold text-gray-900">
            {t('sharedWithMe.import.failTitle')}
          </p>
          <p className="max-w-[360px] text-[13.5px] leading-relaxed text-gray-500">
            {errorKind === 'revoked'
              ? `${t('sharedWithMe.revoked.title')} ${t('sharedWithMe.revoked.body')}`
              : errorKind === 'planLimit'
                ? t('sharedWithMe.import.planLimitBody')
                : t('sharedWithMe.import.failBody')}
          </p>
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row">
            {errorKind === 'revoked' ? (
              <>
                <button
                  type="button"
                  onClick={() => setPhase('confirm')}
                  data-testid="import-retry"
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
                >
                  {t('sharedWithMe.import.retry')}
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/app/shared-with-me')}
                  data-testid="import-back-to-shared"
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-600"
                >
                  {t('sharedWithMe.banner.back')}
                </button>
              </>
            ) : errorKind === 'planLimit' ? (
              <>
                <button
                  type="button"
                  onClick={() => setPhase('confirm')}
                  data-testid="import-retry"
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
                >
                  {t('sharedWithMe.import.retry')}
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/app/settings/subscription')}
                  data-testid="import-view-plans"
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-600"
                >
                  {t('sharedWithMe.import.viewPlans')}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setPhase('confirm')}
                data-testid="import-retry"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-600"
              >
                {t('sharedWithMe.import.retry')}
              </button>
            )}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
