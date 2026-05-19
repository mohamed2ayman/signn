import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import api from '@/services/api/axios';
import type { RootState } from '@/store';
import { useCookieConsent } from '@/contexts/CookieConsentContext';

const STORAGE_KEY = 'sign_cookie_consent';
const CONSENT_VERSION = '1.0';

export type ConsentStatus = 'accepted' | 'rejected' | 'custom';

export interface ConsentCategories {
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
}

export interface StoredConsent {
  status: ConsentStatus;
  timestamp: string;
  version: string;
  categories: ConsentCategories;
}

export function readConsent(): StoredConsent | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredConsent;
  } catch {
    return null;
  }
}

export function writeConsent(status: ConsentStatus, categories: ConsentCategories) {
  const payload: StoredConsent = {
    status,
    timestamp: new Date().toISOString(),
    version: CONSENT_VERSION,
    categories,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent('sign:cookie-consent-changed', { detail: payload }));
}

interface ToggleRowProps {
  label: string;
  description: string;
  enabled: boolean;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
  toggleLabel: string;
}

function ToggleRow({ label, description, enabled, disabled, onChange, toggleLabel }: ToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-100 py-4 last:border-b-0">
      <div className="flex-1">
        <div className="text-sm font-semibold text-gray-900">{label}</div>
        <p className="mt-1 text-xs text-gray-500">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={toggleLabel}
        disabled={disabled}
        onClick={() => onChange?.(!enabled)}
        className={[
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors',
          enabled ? 'bg-indigo-600' : 'bg-gray-300',
          disabled ? 'cursor-not-allowed opacity-60' : '',
        ].join(' ')}
      >
        <span
          className={[
            'inline-block h-5 w-5 transform rounded-full bg-white shadow transition',
            enabled ? 'translate-x-5' : 'translate-x-0.5',
          ].join(' ')}
        />
      </button>
    </div>
  );
}

export default function CookiePreferenceModal() {
  const { t } = useTranslation();
  const { isOpen, close } = useCookieConsent();
  const isAuthenticated = useSelector((state: RootState) => Boolean(state.auth?.token));

  const [functional, setFunctional] = useState(true);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const current = readConsent();
    if (current) {
      setFunctional(current.categories.functional);
      setAnalytics(current.categories.analytics);
      setMarketing(current.categories.marketing);
    }
  }, [isOpen]);

  const persist = async (status: ConsentStatus, categories: ConsentCategories) => {
    writeConsent(status, categories);
    if (isAuthenticated) {
      try {
        await api.patch('/me/cookie-consent', {
          functional: categories.functional,
          analytics: categories.analytics,
          marketing: categories.marketing,
        });
      } catch {
        toast.error(t('cookies.settings.syncFailedToast'));
      }
      try {
        await api.patch('/me/communication-preferences', {
          marketing_email_opt_in: categories.marketing,
        });
      } catch {
        // Already toasted above if the cookie-consent call failed; this is best-effort.
      }
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await persist('custom', { functional, analytics, marketing });
      toast.success(t('cookies.settings.savedToast'));
      close();
    } finally {
      setSaving(false);
    }
  };

  const handleAcceptAll = async () => {
    setSaving(true);
    try {
      setFunctional(true);
      setAnalytics(true);
      setMarketing(true);
      await persist('accepted', { functional: true, analytics: true, marketing: true });
      toast.success(t('cookies.settings.acceptedAllToast'));
      close();
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cookie-pref-title"
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 px-4"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 id="cookie-pref-title" className="text-lg font-bold text-[#0F1729]">
              {t('cookies.settings.title')}
            </h2>
            <p className="mt-1 text-xs text-gray-500">{t('cookies.settings.description')}</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={t('cookies.settings.closeLabel')}
            className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-2">
          <ToggleRow
            label={t('cookies.categories.necessary')}
            description={t('cookies.categories.necessaryDescription')}
            enabled
            disabled
            toggleLabel={t('cookies.settings.toggleLabel', { label: t('cookies.categories.necessary') })}
          />
          <ToggleRow
            label={t('cookies.categories.functional')}
            description={t('cookies.categories.functionalDescription')}
            enabled={functional}
            onChange={setFunctional}
            toggleLabel={t('cookies.settings.toggleLabel', { label: t('cookies.categories.functional') })}
          />
          <ToggleRow
            label={t('cookies.categories.analytics')}
            description={t('cookies.categories.analyticsDescription')}
            enabled={analytics}
            onChange={setAnalytics}
            toggleLabel={t('cookies.settings.toggleLabel', { label: t('cookies.categories.analytics') })}
          />
          <ToggleRow
            label={t('cookies.categories.marketing')}
            description={t('cookies.categories.marketingDescription')}
            enabled={marketing}
            onChange={setMarketing}
            toggleLabel={t('cookies.settings.toggleLabel', { label: t('cookies.categories.marketing') })}
          />
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-gray-100 px-6 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
          >
            {t('cookies.settings.save')}
          </button>
          <button
            type="button"
            onClick={handleAcceptAll}
            disabled={saving}
            className="rounded-lg bg-[#4F6EF7] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#3F58D3] disabled:opacity-60"
          >
            {t('cookies.settings.acceptAll')}
          </button>
        </div>
      </div>
    </div>
  );
}
