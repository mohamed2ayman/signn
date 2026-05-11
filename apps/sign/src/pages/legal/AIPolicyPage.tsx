import LegalPageLayout from './LegalPageLayout';
import LegalContent from './LegalContent';
import {
  aiInnovationUsagePolicyContentMeta,
  aiInnovationUsagePolicyContentToc,
  aiInnovationUsagePolicyContentSections,
} from './content/ai-policy.content';

export default function AIPolicyPage() {
  return (
    <LegalPageLayout
      title={aiInnovationUsagePolicyContentMeta.title}
      effectiveDate={aiInnovationUsagePolicyContentMeta.effectiveDate}
      lastUpdated={aiInnovationUsagePolicyContentMeta.lastUpdated}
      sections={aiInnovationUsagePolicyContentToc}
    >
      <LegalContent sections={aiInnovationUsagePolicyContentSections} />
    </LegalPageLayout>
  );
}
