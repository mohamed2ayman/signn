import { Link } from 'react-router-dom';
import { useCookieConsent } from '@/contexts/CookieConsentContext';

export default function AppFooter() {
  const { openPreferences } = useCookieConsent();
  return (
    <footer
      role="contentinfo"
      className="flex w-full items-center justify-center gap-4 border-t border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-400"
    >
      <span>© 2025 SIGN Technologies LLC</span>
      <span aria-hidden>|</span>
      <Link to="/legal" className="hover:text-gray-600 hover:underline">
        Legal
      </Link>
      <span aria-hidden>|</span>
      <Link to="/legal/privacy" className="hover:text-gray-600 hover:underline">
        Privacy
      </Link>
      <span aria-hidden>|</span>
      <Link to="/legal/terms" className="hover:text-gray-600 hover:underline">
        Terms
      </Link>
      <span aria-hidden>|</span>
      <button
        type="button"
        onClick={openPreferences}
        className="text-gray-400 hover:text-gray-600 hover:underline"
      >
        Cookie Settings
      </button>
    </footer>
  );
}
