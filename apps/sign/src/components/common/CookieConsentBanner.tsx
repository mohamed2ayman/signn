import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cookie } from 'lucide-react';
import CookiePreferenceModal, {
  CONSENT_VERSION,
  readConsent,
  writeConsent,
} from './CookiePreferenceModal';
import { useCookieConsent } from '@/contexts/CookieConsentContext';

export default function CookieConsentBanner() {
  const { openPreferences, syncConsentToServer } = useCookieConsent();
  const [needsChoice, setNeedsChoice] = useState(false);

  useEffect(() => {
    setNeedsChoice(readConsent() === null);
    const onChange = () => setNeedsChoice(readConsent() === null);
    window.addEventListener('sign:cookie-consent-changed', onChange);
    return () => window.removeEventListener('sign:cookie-consent-changed', onChange);
  }, []);

  const handleAcceptAll = () => {
    writeConsent('accepted', { functional: true, analytics: true, marketing: true });
    syncConsentToServer(CONSENT_VERSION);
    setNeedsChoice(false);
  };

  const handleRejectAll = () => {
    writeConsent('rejected', { functional: false, analytics: false, marketing: false });
    syncConsentToServer(CONSENT_VERSION);
    setNeedsChoice(false);
  };

  return (
    <>
      <CookiePreferenceModal />

      {needsChoice && (
        <div
          role="region"
          aria-label="Cookie consent"
          className="fixed inset-x-0 bottom-0 z-[9999] flex flex-col items-center gap-3 bg-[#0F1729] px-4 py-3 text-white shadow-2xl sm:flex-row sm:justify-between sm:px-6"
          style={{ maxHeight: '80px' }}
        >
          <p className="text-xs leading-snug text-gray-200 sm:max-w-3xl">
            We use cookies to operate the SIGN platform, remember preferences, and improve our
            service. See our{' '}
            <Link to="/legal/cookies" className="font-medium text-[#9FB4FF] underline">
              Cookie Policy
            </Link>{' '}
            and{' '}
            <Link to="/legal/privacy" className="font-medium text-[#9FB4FF] underline">
              Privacy Policy
            </Link>
            .
          </p>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openPreferences}
              className="rounded-md border border-gray-500 px-3 py-1.5 text-xs font-medium text-gray-100 transition hover:bg-white/10"
            >
              Manage Preferences
            </button>
            <button
              type="button"
              onClick={handleRejectAll}
              className="rounded-md border border-gray-500 px-3 py-1.5 text-xs font-medium text-gray-100 transition hover:bg-white/10"
            >
              Reject All
            </button>
            <button
              type="button"
              onClick={handleAcceptAll}
              className="rounded-md bg-[#4F6EF7] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#3F58D3]"
            >
              Accept All
            </button>
          </div>
        </div>
      )}

      {!needsChoice && (
        <button
          type="button"
          onClick={openPreferences}
          aria-label="Open cookie preferences"
          className="fixed bottom-4 right-4 z-[9998] flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#0F1729] shadow-lg ring-1 ring-gray-200 transition hover:scale-105 hover:shadow-xl"
        >
          <Cookie size={18} />
        </button>
      )}
    </>
  );
}
