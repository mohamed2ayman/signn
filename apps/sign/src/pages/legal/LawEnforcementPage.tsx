import LegalPageLayout from './LegalPageLayout';
import LegalContent from './LegalContent';
import {
  lawEnforcementGuidelinesContentMeta,
  lawEnforcementGuidelinesContentToc,
  lawEnforcementGuidelinesContentSections,
} from './content/law-enforcement.content';

export default function LawEnforcementPage() {
  return (
    <LegalPageLayout
      title={lawEnforcementGuidelinesContentMeta.title}
      effectiveDate={lawEnforcementGuidelinesContentMeta.effectiveDate}
      lastUpdated={lawEnforcementGuidelinesContentMeta.lastUpdated}
      sections={lawEnforcementGuidelinesContentToc}
    >
      <LegalContent sections={lawEnforcementGuidelinesContentSections} />
    </LegalPageLayout>
  );
}
