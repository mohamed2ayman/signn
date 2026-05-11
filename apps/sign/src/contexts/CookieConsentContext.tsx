import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';

interface CookieConsentContextValue {
  openPreferences: () => void;
  isOpen: boolean;
  close: () => void;
}

const CookieConsentContext = createContext<CookieConsentContextValue>({
  openPreferences: () => {},
  isOpen: false,
  close: () => {},
});

export function CookieConsentProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const openPreferences = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const value = useMemo(() => ({ openPreferences, isOpen, close }), [openPreferences, isOpen, close]);
  return (
    <CookieConsentContext.Provider value={value}>{children}</CookieConsentContext.Provider>
  );
}

export function useCookieConsent() {
  return useContext(CookieConsentContext);
}
