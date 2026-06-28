import { useEffect, useState } from 'react';
import { VersionComparisonResult } from '@/types';
import { contractService } from '@/services/api/contractService';
import { DiffView } from './DiffView';

interface Props {
  contractId: string;
  versionAId: string;
  versionBId: string;
  onClose: () => void;
}

/**
 * Version-vs-version comparison modal. 2b refactor: the presentation now lives
 * in the shared <DiffView>; this component only fetches compareVersions and maps
 * the version labels. Behaviour for the existing version-compare is unchanged
 * (Latin → LTR, byte-identical). DiffView adds auto-RTL for Arabic content.
 */
export function DiffViewerModal({ contractId, versionAId, versionBId, onClose }: Props) {
  const [data, setData] = useState<VersionComparisonResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let m = true;
    setLoading(true);
    contractService
      .compareVersions(contractId, versionAId, versionBId)
      .then((d) => m && setData(d))
      .catch((e) => m && setError(e?.message || 'Failed to load diff'))
      .finally(() => m && setLoading(false));
    return () => {
      m = false;
    };
  }, [contractId, versionAId, versionBId]);

  const subtitle = data
    ? `${data.versionA.version_label || `V${data.versionA.version_number}`} ↔ ${
        data.versionB.version_label || `V${data.versionB.version_number}`
      }`
    : undefined;

  return (
    <DiffView
      title="Version Comparison"
      subtitle={subtitle}
      colLabelA="Previous"
      colLabelB="Current"
      data={data ? { summary: data.summary, changes: data.changes } : null}
      loading={loading}
      error={error}
      onClose={onClose}
    />
  );
}

export default DiffViewerModal;
