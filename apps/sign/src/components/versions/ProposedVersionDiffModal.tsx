import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProposedVersionDiffResult } from '@/types';
import { documentProcessingService } from '@/services/api/documentProcessingService';
import { DiffView } from './DiffView';

interface Props {
  contractId: string;
  docId: string;
  onClose: () => void;
}

/**
 * Guest version review (2b) — host-facing diff of a guest's PROPOSED version
 * (one upload's proposed clauses) against the contract's CURRENT live clauses.
 * Reuses the shared <DiffView>; A = current contract, B = guest's proposed.
 * Arabic clause content renders right-to-left (DiffView auto-detects).
 */
export function ProposedVersionDiffModal({ contractId, docId, onClose }: Props) {
  const { t } = useTranslation();
  const [data, setData] = useState<ProposedVersionDiffResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let m = true;
    setLoading(true);
    documentProcessingService
      .compareProposedVersion(contractId, docId)
      .then((d) => m && setData(d))
      .catch((e) => m && setError(e?.message || 'Failed to load diff'))
      .finally(() => m && setLoading(false));
    return () => {
      m = false;
    };
  }, [contractId, docId]);

  return (
    <DiffView
      title={t('proposedDiff.title')}
      subtitle={t('proposedDiff.subtitle')}
      colLabelA={t('proposedDiff.current')}
      colLabelB={t('proposedDiff.proposed')}
      rtlIndicator={t('proposedDiff.rtlIndicator')}
      data={data ? { summary: data.summary, changes: data.changes } : null}
      loading={loading}
      error={error}
      onClose={onClose}
    />
  );
}

export default ProposedVersionDiffModal;
