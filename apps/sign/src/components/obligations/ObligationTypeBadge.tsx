import { useTranslation } from 'react-i18next';
import type { ObligationType } from '@/services/api/complianceService';
import { typeLabelKey } from './statusUtils';

/**
 * Subtle gray pill showing the obligation type
 * (Payment, Notice Period, Performance Bond, etc.).
 * Intentionally muted vs StatusBadge so status remains the
 * dominant visual signal on the card.
 */
export default function ObligationTypeBadge({
  type,
}: {
  type: ObligationType;
}) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
      {t(typeLabelKey(type))}
    </span>
  );
}
