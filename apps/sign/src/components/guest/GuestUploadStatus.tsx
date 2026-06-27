import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getGuestDocumentStatus,
  type GuestDocumentStatus,
} from '@/services/api/guestService';

const POLL_MS = 2000;
// Generous safety cap (10 min) — the SERVER driver now guarantees completion
// independent of the browser, so this poll is DISPLAY-ONLY. This cap only stops
// polling forever if something is truly broken; it is well above worst-case
// Arabic clause extraction (~4–6 min). (The old 120s cap is exactly what caused
// the stall: cap < AI duration on a poll-driven pipeline.) A refresh
// re-attaches and resumes regardless.
const POLL_MAX_MS = 600_000;
const TERMINAL = new Set([
  'CLAUSES_EXTRACTED',
  'FAILED',
  'HUMAN_REVIEW_RECOMMENDED',
]);

// Progress mirrors the managing ProcessingStatusCard stage weights so a guest
// sees the same sense of motion through the pipeline.
const PROGRESS: Record<string, number> = {
  UPLOADED: 10,
  EXTRACTING_TEXT: 35,
  TEXT_EXTRACTED: 55,
  EXTRACTING_CLAUSES: 80,
  CLAUSES_EXTRACTED: 100,
  HUMAN_REVIEW_RECOMMENDED: 50,
  FAILED: 0,
};

/**
 * Live status surface for a guest's OWN new-version upload (Slice 1).
 *
 * Polls `GET /guest/contracts/:id/documents/:docId/status` every 2s — the ONLY
 * thing that drives the extraction pipeline forward for a guest upload — and
 * stops on a terminal state. On success it tells the guest their version was
 * SUBMITTED FOR REVIEW (it deliberately does NOT surface the proposed clauses —
 * those are for the host to review, and the guest's contract view stays the
 * host's canonical clause set). On failure it offers a re-upload retry.
 */
export default function GuestUploadStatus({
  contractId,
  guestJwt,
  docId,
  fileName,
  onReupload,
  onTerminal,
}: {
  contractId: string;
  guestJwt: string;
  docId: string;
  fileName?: string | null;
  onReupload: () => void;
  /** Fired once when the doc reaches a terminal status — lets the parent clear
   *  the persisted in-flight docId so a future refresh doesn't resume a
   *  finished upload. */
  onTerminal?: () => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<GuestDocumentStatus | null>(null);
  const [pollError, setPollError] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Keep the latest onTerminal without re-running (restarting) the poll effect.
  const onTerminalRef = useRef(onTerminal);
  onTerminalRef.current = onTerminal;

  useEffect(() => {
    let cancelled = false;
    let consecutiveErrors = 0;
    const startedAt = Date.now();
    setStatus(null);
    setPollError(false);

    const stop = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const poll = async () => {
      try {
        const s = await getGuestDocumentStatus(contractId, guestJwt, docId);
        if (cancelled) return;
        consecutiveErrors = 0;
        setStatus(s);
        if (TERMINAL.has(s.processing_status)) {
          onTerminalRef.current?.();
          stop();
        }
      } catch {
        if (cancelled) return;
        // Tolerate transient blips; give up after several consecutive failures.
        consecutiveErrors += 1;
        if (consecutiveErrors >= 5) {
          setPollError(true);
          stop();
        }
      }
      if (!cancelled && Date.now() - startedAt > POLL_MAX_MS) stop();
    };

    poll();
    intervalRef.current = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [contractId, guestJwt, docId]);

  const ps = status?.processing_status ?? 'UPLOADED';
  const isDone = ps === 'CLAUSES_EXTRACTED';
  const isFailed = ps === 'FAILED' || pollError;
  const isReview = ps === 'HUMAN_REVIEW_RECOMMENDED';
  const pct = PROGRESS[ps] ?? 10;

  // ── Terminal SUCCESS — submitted for review (NOT "your clauses replace the
  //    contract"). ───────────────────────────────────────────────────────────
  if (isDone) {
    return (
      <div
        role="status"
        className="rounded-lg border border-emerald-200 bg-emerald-50 p-4"
      >
        <div className="flex items-start gap-2.5">
          <svg
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <p className="text-sm font-medium text-emerald-800" dir="auto">
              {t('guest.uploadStatus.submittedTitle')}
            </p>
            <p className="mt-1 text-xs text-emerald-700" dir="auto">
              {t('guest.uploadStatus.submittedHint')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Terminal FAILURE — offer a re-upload retry. ───────────────────────────
  if (isFailed) {
    return (
      <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-medium text-red-800" dir="auto">
          {t('guest.uploadStatus.failedTitle')}
        </p>
        <p className="mt-1 text-xs text-red-700" dir="auto">
          {status?.error_message || t('guest.uploadStatus.failedHint')}
        </p>
        <button
          type="button"
          onClick={onReupload}
          className="mt-2 text-xs font-medium text-red-700 underline hover:text-red-900"
        >
          {t('guest.uploadStatus.reupload')}
        </button>
      </div>
    );
  }

  // ── Parked: poor scan quality (HUMAN_REVIEW_RECOMMENDED). ──────────────────
  if (isReview) {
    return (
      <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-medium text-amber-800" dir="auto">
          {t('guest.uploadStatus.reviewTitle')}
        </p>
        <p className="mt-1 text-xs text-amber-700" dir="auto">
          {t('guest.uploadStatus.reviewHint')}
        </p>
        <button
          type="button"
          onClick={onReupload}
          className="mt-2 text-xs font-medium text-amber-700 underline hover:text-amber-900"
        >
          {t('guest.uploadStatus.reupload')}
        </button>
      </div>
    );
  }

  // ── In progress. ──────────────────────────────────────────────────────────
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-blue-200 bg-blue-50 p-4"
    >
      <div className="mb-2 flex items-center gap-2.5">
        <svg
          aria-hidden="true"
          className="h-4 w-4 animate-spin text-blue-600"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-sm font-medium text-blue-800" dir="auto">
          {t('guest.uploadStatus.processingTitle')}
        </p>
        <span className="ml-auto text-xs font-medium tabular-nums text-blue-700">
          {pct}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-200">
        <div
          className="h-full rounded-full bg-blue-600 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      {fileName && (
        <p
          className="mt-2 truncate text-xs text-blue-700/80"
          dir="auto"
          style={{ unicodeBidi: 'plaintext' }}
        >
          {fileName}
        </p>
      )}
      <p className="mt-1 text-xs text-blue-700/80" dir="auto">
        {t('guest.uploadStatus.processingHint')}
      </p>
    </div>
  );
}
