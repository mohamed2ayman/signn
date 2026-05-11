import LegalPageLayout from './LegalPageLayout';
import LegalContent from './LegalContent';
import { useCookieConsent } from '@/contexts/CookieConsentContext';
import { Cookie } from 'lucide-react';
import {
  cookiePolicyContentMeta,
  cookiePolicyContentToc,
  cookiePolicyContentSections,
} from './content/cookies.content';

export default function CookiePolicyPage() {
  const { openPreferences } = useCookieConsent();
  return (
    <LegalPageLayout
      title={cookiePolicyContentMeta.title}
      effectiveDate={cookiePolicyContentMeta.effectiveDate}
      lastUpdated={cookiePolicyContentMeta.lastUpdated}
      sections={cookiePolicyContentToc}
    >
      <div className="mb-6 flex items-center justify-between rounded-lg border border-indigo-100 bg-indigo-50 p-4">
        <div>
          <h3 className="text-sm font-semibold text-[#0F1729]">Manage your cookie preferences</h3>
          <p className="mt-0.5 text-xs text-gray-600">
            Change which cookie categories SIGN may use on your device.
          </p>
        </div>
        <button
          type="button"
          onClick={openPreferences}
          className="inline-flex items-center gap-2 rounded-md bg-[#4F6EF7] px-3 py-2 text-sm font-medium text-white transition hover:bg-[#3F58D3]"
        >
          <Cookie size={14} /> Manage Cookie Preferences
        </button>
      </div>
      <LegalContent sections={cookiePolicyContentSections} />
    </LegalPageLayout>
  );
}
