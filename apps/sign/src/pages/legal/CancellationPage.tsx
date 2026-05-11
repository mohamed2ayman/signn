import LegalPageLayout from './LegalPageLayout';
import LegalContent from './LegalContent';
import {
  cancellationDowngradePolicyContentMeta,
  cancellationDowngradePolicyContentToc,
  cancellationDowngradePolicyContentSections,
} from './content/cancellation.content';

export default function CancellationPage() {
  return (
    <LegalPageLayout
      title={cancellationDowngradePolicyContentMeta.title}
      effectiveDate={cancellationDowngradePolicyContentMeta.effectiveDate}
      lastUpdated={cancellationDowngradePolicyContentMeta.lastUpdated}
      sections={cancellationDowngradePolicyContentToc}
    >
      <LegalContent sections={cancellationDowngradePolicyContentSections} />
    </LegalPageLayout>
  );
}
