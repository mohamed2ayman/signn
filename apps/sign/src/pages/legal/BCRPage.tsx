import LegalPageLayout from './LegalPageLayout';
import LegalContent from './LegalContent';
import {
  bindingCorporateRulesPrivacyCodeContentMeta,
  bindingCorporateRulesPrivacyCodeContentToc,
  bindingCorporateRulesPrivacyCodeContentSections,
} from './content/bcr.content';

export default function BCRPage() {
  return (
    <LegalPageLayout
      title={bindingCorporateRulesPrivacyCodeContentMeta.title}
      effectiveDate={bindingCorporateRulesPrivacyCodeContentMeta.effectiveDate}
      lastUpdated={bindingCorporateRulesPrivacyCodeContentMeta.lastUpdated}
      sections={bindingCorporateRulesPrivacyCodeContentToc}
    >
      <LegalContent sections={bindingCorporateRulesPrivacyCodeContentSections} />
    </LegalPageLayout>
  );
}
