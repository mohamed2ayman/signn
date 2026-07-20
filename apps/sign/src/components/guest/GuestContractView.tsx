import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Contract } from '@/types';
import GuestClauseCard from './GuestClauseCard';
import GuestUploadStatus from './GuestUploadStatus';
import AcceptExecuteModal from './AcceptExecuteModal';
import {
  downloadGuestContractPdf,
  uploadGuestContractVersion,
} from '@/services/api/guestService';
import {
  getGuestSignSlip,
  GuestSignSlip,
} from '@/services/api/guestSignService';

const UPLOAD_ACCEPT = '.pdf,.docx,.doc';
const UPLOAD_MAX_MB = 50;
const UPLOAD_EXTS = ['.pdf', '.docx', '.doc'];

// Refresh-resume: the in-flight upload's docId is persisted per-contract so a
// refresh / tab-close re-attaches the live status view (the SERVER driver
// guarantees completion regardless of the browser; this just keeps the guest's
// progress visible across reloads). Cleared once the doc reaches terminal.
type InflightDoc = { id: string; name: string | null };
const inflightKey = (contractId: string) => `guest-upload-inflight:${contractId}`;

function readInflight(contractId: string): InflightDoc | null {
  try {
    const raw = localStorage.getItem(inflightKey(contractId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.id === 'string'
      ? { id: parsed.id, name: typeof parsed.name === 'string' ? parsed.name : null }
      : null;
  } catch {
    return null;
  }
}

function writeInflight(contractId: string, doc: InflightDoc): void {
  try {
    localStorage.setItem(inflightKey(contractId), JSON.stringify(doc));
  } catch {
    // localStorage unavailable (private mode / quota) — non-fatal; in-session
    // component state still drives the status view for this session.
  }
}

function clearInflight(contractId: string): void {
  try {
    localStorage.removeItem(inflightKey(contractId));
  } catch {
    // ignore
  }
}

/**
 * Read-only contract header + clause list for the Guest Portal viewer.
 *
 * `guestJwt` is present ONLY once the guest has established a durable identity
 * (Path B). The watermarked-download affordance is gated on it: a passwordless
 * viewer (Path A) has no `guestJwt` and sees no Download button — consistent
 * with the backend route, which requires account_type=GUEST.
 */
export default function GuestContractView({
  contract,
  guestJwt,
  onAskAi,
  onImport,
  enableSignSlip,
  onExecuted,
}: {
  contract: Contract;
  guestJwt?: string | null;
  /** Opens the Guest AI Assistant drawer (Feature #6). Path-B gated like
   *  Upload/Download — rendered only inside the `{guestJwt && …}` row. */
  onAskAi?: () => void;
  /** Opens the "Import to my workspace" modal (#8d). SHARED-VIEWER-ONLY:
   *  supplied exclusively by SharedContractViewerPage (a bound MANAGING
   *  arrival with a workspace to import into). Deliberately NOT gated on
   *  `guestJwt` — an established token-guest also has one, but has no org
   *  to import to; the token-entered GuestViewerPage never passes this prop,
   *  so pure guests never see the button. When present, Import takes the
   *  filled-primary lead slot and Ask AI demotes to the outline style
   *  (one filled button per row — the design rule). */
  onImport?: () => void;
  /** Guest Signing v1 — enables the "Accept & Execute" affordance.
   *  SHARED-VIEWER-ONLY in v1 (Model A, the locked scope decision): supplied
   *  exclusively by SharedContractViewerPage; the token-entered
   *  GuestViewerPage never passes it, so pure org-less guests see no sign
   *  affordance (#8c will flip that — a one-line change here). The affordance
   *  renders ONLY when the slip API confirms an ACTIVE slip; the backend
   *  RE-CHECKS binding + slip on every call — this gate is UX, never the
   *  authority. */
  enableSignSlip?: boolean;
  /** Fired after a successful Accept & Execute so the parent can refetch the
   *  contract (its signature status just changed). */
  onExecuted?: () => void;
}) {
  const { t } = useTranslation();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // The guest's just-uploaded new version (drives the live status surface).
  const [uploadedDoc, setUploadedDoc] = useState<InflightDoc | null>(null);
  // Guest Signing v1 — the slip render gate (shared-viewer path only).
  const [signSlip, setSignSlip] = useState<GuestSignSlip | null>(null);
  const [signModalOpen, setSignModalOpen] = useState(false);
  const clauses = [...(contract.contract_clauses ?? [])].sort(
    (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0),
  );

  // Refresh-resume: on mount, re-attach the live status view to any in-flight
  // upload persisted for this contract (only for an established guest).
  useEffect(() => {
    if (!guestJwt) return;
    const persisted = readInflight(contract.id);
    if (persisted) setUploadedDoc(persisted);
  }, [contract.id, guestJwt]);

  // Guest Signing v1 — fetch the slip status on mount (shared-viewer path
  // only). A uniform 404 (no binding / no slip / voided — indistinguishable
  // by design) resolves to null → no affordance. Any other failure ALSO
  // resolves to null: the sign affordance simply doesn't render; the backend
  // re-checks binding + slip on the actual accept call regardless.
  useEffect(() => {
    if (!enableSignSlip || !guestJwt) return;
    let cancelled = false;
    getGuestSignSlip(contract.id, guestJwt)
      .then((slip) => {
        if (!cancelled) setSignSlip(slip);
      })
      .catch(() => {
        if (!cancelled) setSignSlip(null);
      });
    return () => {
      cancelled = true;
    };
  }, [contract.id, guestJwt, enableSignSlip]);

  const handleDownload = async () => {
    if (!guestJwt || downloading) return;
    setDownloading(true);
    setDownloadError(false);
    try {
      await downloadGuestContractPdf(contract.id, guestJwt);
    } catch {
      // No-leak error — never surface status/identity, mirror the viewer's
      // generic error handling.
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  };

  const handleUploadClick = () => {
    if (!guestJwt || uploading) return;
    setUploadError(null);
    setUploadedDoc(null);
    clearInflight(contract.id);
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    // Reset so re-picking the same file later still fires onChange.
    e.target.value = '';
    if (!file || !guestJwt) return;

    // Client-side guard (the server is authoritative — ext+MIME+magic-bytes).
    const lower = file.name.toLowerCase();
    if (!UPLOAD_EXTS.some((x) => lower.endsWith(x))) {
      setUploadError(t('guest.upload.errorType'));
      return;
    }
    if (file.size > UPLOAD_MAX_MB * 1024 * 1024) {
      setUploadError(t('guest.upload.errorSize', { size: UPLOAD_MAX_MB }));
      return;
    }

    setUploading(true);
    setUploadError(null);
    setUploadedDoc(null);
    try {
      const res = await uploadGuestContractVersion(contract.id, guestJwt, file);
      const doc: InflightDoc = {
        id: res.id,
        name: res.original_name ?? res.file_name,
      };
      setUploadedDoc(doc);
      // Persist so a refresh / tab-close re-attaches the live status view.
      writeInflight(contract.id, doc);
    } catch (err: any) {
      const status = err?.response?.status;
      const code = err?.response?.data?.error;
      if (status === 429 && code === 'GUEST_UPLOAD_DAILY_LIMIT') {
        setUploadError(t('guest.upload.errorDailyLimit'));
      } else if (status === 429) {
        setUploadError(t('guest.upload.errorRateLimited'));
      } else {
        // No-leak generic error — never surface status/identity.
        setUploadError(t('guest.upload.error'));
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      {/* Contract header */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
            {contract.contract_type}
          </span>
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
            {String(contract.status).replace(/_/g, ' ')}
          </span>
        </div>
        <h1
          className="mt-3 text-xl font-semibold text-gray-900 sm:text-2xl"
          dir="auto"
          style={{ unicodeBidi: 'plaintext', overflowWrap: 'anywhere' }}
        >
          {contract.name}
        </h1>
        {(contract.party_first_name || contract.party_second_name) && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {contract.party_first_name && (
              <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-gray-400">
                  {t('guest.contractView.firstParty')}
                </div>
                <div
                  className="text-sm text-gray-700"
                  dir="auto"
                  style={{ unicodeBidi: 'plaintext' }}
                >
                  {contract.party_first_name}
                </div>
              </div>
            )}
            {contract.party_second_name && (
              <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-gray-400">
                  {t('guest.contractView.secondParty')}
                </div>
                <div
                  className="text-sm text-gray-700"
                  dir="auto"
                  style={{ unicodeBidi: 'plaintext' }}
                >
                  {contract.party_second_name}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Guest Signing v1 — Accept & Execute. Renders ONLY when the slip API
          confirmed an ACTIVE slip for this guest+contract (default-deny: a
          bare binding never implies signing; the backend re-checks binding +
          slip on the accept call — do NOT copy the host mark-signed button's
          no-gate pattern). ACCEPTED is the crash-resume state: the accept
          call is idempotent and finalizes it. */}
      {enableSignSlip &&
        guestJwt &&
        (signSlip?.status === 'PENDING' || signSlip?.status === 'ACCEPTED') && (
          <div className="mt-6 rounded-xl border border-primary/25 bg-primary/[0.04] p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-gray-900">
                  {t('guest.sign.panel.title')}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">
                  {t('guest.sign.panel.body')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSignModalOpen(true)}
                data-testid="guest-accept-execute"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600"
              >
                <svg
                  aria-hidden="true"
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m5 13 4 4L19 7" />
                </svg>
                {t('guest.sign.panel.button')}
              </button>
            </div>
          </div>
        )}
      {enableSignSlip && guestJwt && signSlip?.status === 'EXECUTED' && (
        <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50/60 p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
              </svg>
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-emerald-800">
                {t('guest.sign.executedPanel.title')}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-emerald-700">
                {t('guest.sign.executedPanel.body')}
              </p>
              {signSlip.accepted_content_hash && (
                <p className="mt-2 text-[11px] text-emerald-700/80">
                  {t('guest.sign.executedPanel.hashLabel')}
                  <span
                    className="mt-0.5 block break-all font-mono text-[10px] text-emerald-700/60"
                    dir="ltr"
                  >
                    {signSlip.accepted_content_hash}
                  </span>
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Clauses */}
      <div className="relative mt-6">
        {/* Subtle read-only watermark behind the clause list */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 flex items-start justify-center overflow-hidden"
        >
          <span className="mt-24 select-none text-5xl font-bold uppercase tracking-widest text-gray-900/[0.03] sm:text-7xl">
            {t('guest.contractView.watermark')}
          </span>
        </div>

        <div className="relative z-10">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-700">
              {t('guest.contractView.clauses')}
              <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-500">
                {clauses.length}
              </span>
            </h2>
            {guestJwt && (
              <div className="flex flex-col items-end gap-1.5">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {/* Import to my workspace (#8d) — shared-viewer-only (see
                      the onImport prop note). First in the row: for a managing
                      reviewer, taking the contract home is the marquee action. */}
                  {onImport && (
                    <button
                      type="button"
                      onClick={onImport}
                      data-testid="guest-import"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-600"
                    >
                      {/* The design's arrow-into-tray glyph (verbatim paths). */}
                      <svg
                        aria-hidden="true"
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.85}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 3v10" />
                        <path d="m8 9 4 4 4-4" />
                        <path d="M4 14v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
                      </svg>
                      {t('sharedWithMe.import.button')}
                    </button>
                  )}
                  {/* Ask AI — the assistant trigger (Feature #6). Filled
                      primary = the lead affordance of the row per the design —
                      EXCEPT when Import is present (managing viewers), where
                      Ask AI demotes to the outline style so the row keeps one
                      filled button. */}
                  {onAskAi && (
                    <button
                      type="button"
                      onClick={onAskAi}
                      data-testid="guest-ask-ai"
                      className={
                        onImport
                          ? 'inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/[0.04] px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/[0.1]'
                          : 'inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-600'
                      }
                    >
                      <svg
                        aria-hidden="true"
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M8 10h8m-8 4h5m-9 6l3.2-3.2A8 8 0 1120 12a8 8 0 01-12.8 4.8L4 20z"
                        />
                      </svg>
                      {t('guest.assistant.trigger')}
                    </button>
                  )}
                  {/* Upload new version (Path-B gated) */}
                  <button
                    type="button"
                    onClick={handleUploadClick}
                    disabled={uploading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/[0.04] px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/[0.1] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <svg
                      aria-hidden="true"
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 21V9m0 0l-4 4m4-4l4 4M4 7V5a2 2 0 012-2h12a2 2 0 012 2v2"
                      />
                    </svg>
                    {uploading
                      ? t('guest.upload.uploading')
                      : t('guest.upload.button')}
                  </button>
                  {/* Watermarked download (Feature #3) */}
                  <button
                    type="button"
                    onClick={handleDownload}
                    disabled={downloading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-white px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <svg
                      aria-hidden="true"
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"
                      />
                    </svg>
                    {downloading
                      ? t('guest.contractView.downloading')
                      : t('guest.contractView.download')}
                  </button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={UPLOAD_ACCEPT}
                  className="hidden"
                  onChange={handleFileSelected}
                />
                {uploadError && (
                  <span
                    className="text-[11px] text-red-500"
                    dir="auto"
                    role="alert"
                  >
                    {uploadError}
                  </span>
                )}
                {downloadError && (
                  <span className="text-[11px] text-red-500" dir="auto">
                    {t('guest.contractView.downloadError')}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Live status of the just-uploaded new version (Slice 1). It is the
              ONLY thing that drives the extraction forward for a guest upload.
              On success it says "submitted for review" — the proposed clauses
              are for the HOST to review and never replace the contract the guest
              is viewing (the clause list below stays the host's canonical set). */}
          {guestJwt && uploadedDoc && (
            <div className="mb-4">
              <GuestUploadStatus
                contractId={contract.id}
                guestJwt={guestJwt}
                docId={uploadedDoc.id}
                fileName={uploadedDoc.name}
                onReupload={() => {
                  clearInflight(contract.id);
                  setUploadedDoc(null);
                  handleUploadClick();
                }}
                onTerminal={() => clearInflight(contract.id)}
              />
            </div>
          )}

          {clauses.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-sm text-gray-400">
              {t('guest.contractView.noClauses')}
            </div>
          ) : (
            <div className="space-y-3">
              {clauses.map((cc) =>
                cc.clause ? (
                  // The data attribute is the citation-chip scroll anchor
                  // (Feature #6): the chat panel resolves `§section` taps via
                  // [data-guest-clause-section] + pulses .guest-clause-highlight.
                  <div
                    key={cc.id}
                    data-guest-clause-section={cc.section_number ?? ''}
                    className="scroll-mt-24 rounded-lg"
                  >
                    <GuestClauseCard
                      clause={cc.clause}
                      sectionNumber={cc.section_number}
                    />
                  </div>
                ) : null,
              )}
            </div>
          )}
        </div>
      </div>

      {/* Accept & Execute confirmation (Guest Signing v1). */}
      {signModalOpen && guestJwt && (
        <AcceptExecuteModal
          contractId={contract.id}
          contractName={contract.name}
          guestJwt={guestJwt}
          onClose={() => setSignModalOpen(false)}
          onExecuted={(result) => {
            // Flip the panel to the executed receipt; the parent refetches the
            // contract (its signature status just changed).
            setSignSlip({
              slip_id: result.slip_id,
              status: result.status,
              granted_at: result.granted_at,
              accepted_at: result.accepted_at,
              accepted_content_hash: result.accepted_content_hash,
            });
            onExecuted?.();
          }}
        />
      )}
    </div>
  );
}
