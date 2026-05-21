import { useTranslation } from 'react-i18next';
import LegalPageLayout from './LegalPageLayout';
import LegalContent from './LegalContent';
import { getLegalContent, normalizeLegalLocale } from './content';

export default function AIPolicyPage() {
  const { i18n } = useTranslation();
  const { meta, toc, sections } = getLegalContent('ai-policy', normalizeLegalLocale(i18n.language));
  return (
    <LegalPageLayout
      title={meta.title}
      effectiveDate={meta.effectiveDate}
      lastUpdated={meta.lastUpdated}
      sections={toc}
    >
      <LegalContent sections={sections} />
    </LegalPageLayout>
  );
}
