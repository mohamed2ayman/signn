import LegalPageLayout from './LegalPageLayout';
import LegalContent from './LegalContent';
import {
  ipCopyrightPolicyContentMeta,
  ipCopyrightPolicyContentToc,
  ipCopyrightPolicyContentSections,
} from './content/ip.content';

export default function IPCopyrightPage() {
  return (
    <LegalPageLayout
      title={ipCopyrightPolicyContentMeta.title}
      effectiveDate={ipCopyrightPolicyContentMeta.effectiveDate}
      lastUpdated={ipCopyrightPolicyContentMeta.lastUpdated}
      sections={ipCopyrightPolicyContentToc}
    >
      <LegalContent sections={ipCopyrightPolicyContentSections} />
    </LegalPageLayout>
  );
}
