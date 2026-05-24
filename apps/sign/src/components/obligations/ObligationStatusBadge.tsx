import { useTranslation } from 'react-i18next';
import type { ObligationStatus } from '@/services/api/complianceService';
import { STATUS_TO_TONE, TONE_STYLES, statusLabelKey } from './statusUtils';

/**
 * Coloured pill showing one of the six obligation statuses.
 * Caller passes the RAW status — derive "effective" before passing
 * if you want PENDING + past-due to show as OVERDUE.
 */
export default function ObligationStatusBadge({
  status,
  size = 'sm',
}: {
  status: ObligationStatus;
  size?: 'sm' | 'xs';
}) {
  const { t } = useTranslation();
  const tone = STATUS_TO_TONE[status];
  const styles = TONE_STYLES[tone];

  const pad = size === 'xs' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-xs';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${pad} ${styles.bg} ${styles.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
      {t(statusLabelKey(status))}
    </span>
  );
}
