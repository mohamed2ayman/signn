import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PortfolioPeriod } from '@/services/api/portfolioService';
import ExportPdfModal from './ExportPdfModal';

/**
 * Phase 7.17 Prompt 2c Bucket 4 — Export-PDF trigger + modal owner.
 *
 * Owns the modal-open state so the page-level component (PortfolioPage)
 * doesn't have to. Pure wrapper — the button is a single line of JSX,
 * the actual confirmation flow lives in ExportPdfModal.
 *
 * Period + projectId come from the page's current filter state — the
 * exported snapshot mirrors what the user is currently viewing.
 */
export interface ExportPdfButtonProps {
  period: PortfolioPeriod;
  projectId?: string;
  userEmail: string;
  /** Disable when there is no data to export yet (loading / error states). */
  disabled?: boolean;
}

export default function ExportPdfButton({
  period,
  projectId,
  userEmail,
  disabled,
}: ExportPdfButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {/* Small download/share icon — pure decoration, no semantic meaning. */}
        <svg
          aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"
          />
        </svg>
        {t('portfolio.export.button')}
      </button>
      <ExportPdfModal
        isOpen={open}
        onClose={() => setOpen(false)}
        period={period}
        projectId={projectId}
        userEmail={userEmail}
      />
    </>
  );
}
