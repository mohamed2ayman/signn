import LegalPageLayout from './LegalPageLayout';
import LegalContent from './LegalContent';
import {
  termsAndConditionsContentMeta,
  termsAndConditionsContentToc,
  termsAndConditionsContentSections,
} from './content/terms.content';

export default function TermsPage() {
  return (
    <LegalPageLayout
      title={termsAndConditionsContentMeta.title}
      effectiveDate={termsAndConditionsContentMeta.effectiveDate}
      lastUpdated={termsAndConditionsContentMeta.lastUpdated}
      sections={termsAndConditionsContentToc}
    >
      <LegalContent sections={termsAndConditionsContentSections} />
    </LegalPageLayout>
  );
}
