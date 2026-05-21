import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';
import { useSelector } from 'react-redux';
import api from '@/services/api/axios';
import type { RootState } from '@/store';

interface CookieConsentContextValue {
  openPreferences: () => void;
  isOpen: boolean;
  close: () => void;
  /**
   * Fire-and-forget server-side persistence of the cookie consent timestamp +
   * version. Only runs for authenticated users; silently no-ops for guests
   * (their consent stays in localStorage until they sign in). Errors are
   * swallowed — UI must never block on this call.
   */
  syncConsentToServer: (version: string) => void;
}

const CookieConsentContext = createContext<CookieConsentContextValue>({
  openPreferences: () => {},
  isOpen: false,
  close: () => {},
  syncConsentToServer: () => {},
});

export function CookieConsentProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const isAuthenticated = useSelector((state: RootState) => Boolean(state.auth?.token));
  const openPreferences = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const syncConsentToServer = useCallback(
    (version: string) => {
      if (!isAuthenticated) return;
      const payload = {
        cookie_consent_given_at: new Date().toISOString(),
        cookie_consent_version: version,
      };
      api
        .patch('/me/communication-preferences', payload)
        .catch((err) => {
          // Fire-and-forget — never surface to the user.
          console.warn('[cookie-consent] failed to persist to server:', err);
        });
    },
    [isAuthenticated],
  );

  const value = useMemo(
    () => ({ openPreferences, isOpen, close, syncConsentToServer }),
    [openPreferences, isOpen, close, syncConsentToServer],
  );

  return (
    <CookieConsentContext.Provider value={value}>{children}</CookieConsentContext.Provider>
  );
}

export function useCookieConsent() {
  return useContext(CookieConsentContext);
}
