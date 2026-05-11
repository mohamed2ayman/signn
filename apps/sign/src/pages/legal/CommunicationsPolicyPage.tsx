import LegalPageLayout from './LegalPageLayout';
import LegalContent from './LegalContent';
import {
  communicationPreferencesPolicyContentMeta,
  communicationPreferencesPolicyContentToc,
  communicationPreferencesPolicyContentSections,
} from './content/communications.content';

export default function CommunicationsPolicyPage() {
  return (
    <LegalPageLayout
      title={communicationPreferencesPolicyContentMeta.title}
      effectiveDate={communicationPreferencesPolicyContentMeta.effectiveDate}
      lastUpdated={communicationPreferencesPolicyContentMeta.lastUpdated}
      sections={communicationPreferencesPolicyContentToc}
    >
      <LegalContent sections={communicationPreferencesPolicyContentSections} />
    </LegalPageLayout>
  );
}
