import LegalPageLayout from './LegalPageLayout';
import LegalContent from './LegalContent';
import {
  privacyPolicyContentMeta,
  privacyPolicyContentToc,
  privacyPolicyContentSections,
} from './content/privacy.content';

export default function PrivacyPage() {
  return (
    <LegalPageLayout
      title={privacyPolicyContentMeta.title}
      effectiveDate={privacyPolicyContentMeta.effectiveDate}
      lastUpdated={privacyPolicyContentMeta.lastUpdated}
      sections={privacyPolicyContentToc}
    >
      <LegalContent sections={privacyPolicyContentSections} />
    </LegalPageLayout>
  );
}
