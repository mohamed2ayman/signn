import LegalPageLayout from './LegalPageLayout';
import LegalContent from './LegalContent';
import {
  acceptableUsePolicyContentMeta,
  acceptableUsePolicyContentToc,
  acceptableUsePolicyContentSections,
} from './content/acceptable-use.content';

export default function AcceptableUsePage() {
  return (
    <LegalPageLayout
      title={acceptableUsePolicyContentMeta.title}
      effectiveDate={acceptableUsePolicyContentMeta.effectiveDate}
      lastUpdated={acceptableUsePolicyContentMeta.lastUpdated}
      sections={acceptableUsePolicyContentToc}
    >
      <LegalContent sections={acceptableUsePolicyContentSections} />
    </LegalPageLayout>
  );
}
