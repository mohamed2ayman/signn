import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import type { Contract } from '@/types';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import GuestLayout from '@/components/guest/GuestLayout';
import GuestErrorScreen, {
  type GuestErrorKind,
} from '@/components/guest/GuestErrorScreen';
import GuestContractView from '@/components/guest/GuestContractView';
import GuestComments from '@/components/guest/GuestComments';
import EstablishIdentityModal from '@/components/guest/EstablishIdentityModal';
import {
  exchangeInvitation,
  type GuestComment,
  type GuestIdentity,
} from '@/services/api/guestService';
import { getViewerContract } from '@/services/api/viewerService';

type Phase = 'loading' | 'ready' | 'error';

function errorKindFromStatus(status?: number): GuestErrorKind {
  if (status === 429) return 'throttled';
  if (status === 404) return 'not-found';
  if (status === 400 || status === 401) return 'invalid';
  return 'unknown';
}

/**
 * Public Guest Portal viewer. Entered with an invitation token (path param or
 * `?token=`). Orchestrates: exchange → viewer read → (optional) progressive
 * identity → guest comments. No auth required to arrive; the guest JWT obtained
 * at identity time is held in page state only and never written to the app
 * store.
 */
// Guest UI locales the viewer can switch into from an invitation's
// `invited_language`. Must mirror the locales registered in `@/i18n`.
const SUPPORTED_GUEST_LANGS = ['en', 'ar', 'fr'];

export default function GuestViewerPage() {
  const { t, i18n } = useTranslation();
  const params = useParams<{ token?: string }>();
  const [searchParams] = useSearchParams();
  const invitationToken = params.token || searchParams.get('token') || '';

  const [phase, setPhase] = useState<Phase>('loading');
  const [errorKind, setErrorKind] = useState<GuestErrorKind>('unknown');
  const [contract, setContract] = useState<Contract | null>(null);
  const [invitedEmail] = useState<string | null>(null);

  // Progressive identity — held in page state ONLY, never the Redux store.
  const [identityOpen, setIdentityOpen] = useState(false);
  // Set when establish-identity reports a TERMINAL token failure (invitation
  // already used to set up access / expired / revoked). The exchange that let
  // the guest VIEW carries no "identity established" signal, so this is only
  // knowable at establish time — once known, we replace the "Set a password"
  // CTA with a friendly note so the doomed form can't be re-opened.
  const [identityUnusable, setIdentityUnusable] = useState(false);
  const [guestJwt, setGuestJwt] = useState<string | null>(null);
  const [guestUser, setGuestUser] = useState<GuestIdentity['user'] | null>(null);
  const [seedComments, setSeedComments] = useState<GuestComment[]>([]);

  const didInit = useRef(false);

  const initSession = useCallback(async () => {
    setPhase('loading');
    if (!invitationToken) {
      setErrorKind('no-token');
      setPhase('error');
      return;
    }
    try {
      const cred = await exchangeInvitation(invitationToken);
      // Honor the guest's invited language: switch the whole viewer (chrome +
      // direction) to it. `i18n.changeLanguage` fires the global
      // `languageChanged` listener in `@/i18n`, which sets `dir="rtl"` on
      // <html> for Arabic — so an Arabic-invited guest sees Arabic RTL chrome,
      // not just RTL clause content. Falls back to English when the invited
      // language is absent or unsupported.
      const invitedLang =
        cred.invited_language && SUPPORTED_GUEST_LANGS.includes(cred.invited_language)
          ? cred.invited_language
          : 'en';
      if (i18n.language !== invitedLang) {
        void i18n.changeLanguage(invitedLang);
      }
      try {
        const data = await getViewerContract(cred.contract_id, cred.viewer_token);
        setContract(data);
        setPhase('ready');
      } catch (readErr) {
        const status = axios.isAxiosError(readErr)
          ? readErr.response?.status
          : undefined;
        // Viewer credential expired between exchange and read (15-min TTL) —
        // offer a clean reload (the invitation token is still good for ~30d).
        setErrorKind(status === 401 ? 'expired' : errorKindFromStatus(status));
        setPhase('error');
      }
    } catch (exErr) {
      const status = axios.isAxiosError(exErr) ? exErr.response?.status : undefined;
      setErrorKind(errorKindFromStatus(status));
      setPhase('error');
    }
  }, [invitationToken, i18n]);

  useEffect(() => {
    // Guard against React.StrictMode's double-invoke in dev (avoids a duplicate
    // exchange round-trip). Exchange is idempotent within TTL regardless.
    if (didInit.current) return;
    didInit.current = true;
    void initSession();
  }, [initSession]);

  const handleEstablished = (identity: GuestIdentity) => {
    setGuestJwt(identity.access_token);
    setGuestUser(identity.user);
    setIdentityOpen(false);
    // If the backend wrote a comment as part of resume-intent, seed it so the
    // guest sees it immediately. (No intent is sent in this first pass, so this
    // is normally empty — kept so the resume contract is honored if used.)
    if (identity.resume?.created_comment_id && contract) {
      setSeedComments([
        {
          id: identity.resume.created_comment_id,
          contract_id: contract.id,
          user_id: identity.user.id,
          content: t('guest.comments.seedContent'),
          created_at: new Date().toISOString(),
        },
      ]);
    }
  };

  const handleGuestSessionExpired = () => {
    // Guest JWT (15-min access) lapsed — drop back to read-only so the UI is
    // honest rather than silently failing further posts.
    setGuestJwt(null);
    setGuestUser(null);
  };

  const guestName = guestUser
    ? `${guestUser.first_name ?? t('guest.comments.defaultName')} ${guestUser.last_name ?? ''}`.trim()
    : t('guest.comments.defaultName');

  return (
    <GuestLayout contractName={phase === 'ready' ? contract?.name : undefined}>
      {phase === 'loading' && (
        <div className="flex min-h-[55vh] flex-col items-center justify-center gap-3">
          <LoadingSpinner size="lg" />
          <p className="text-sm text-gray-400">{t('guest.loading')}</p>
        </div>
      )}

      {phase === 'error' && (
        <GuestErrorScreen kind={errorKind} onRetry={initSession} />
      )}

      {phase === 'ready' && contract && (
        <>
          <GuestContractView contract={contract} guestJwt={guestJwt} />

          <section className="mt-8">
            {!guestUser ? (
              identityUnusable ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-center sm:p-6">
                  <h3 className="text-base font-semibold text-gray-900" dir="auto">
                    {t('guest.identity.blocked.title')}
                  </h3>
                  <p
                    className="mx-auto mt-1 max-w-md text-sm text-gray-500"
                    dir="auto"
                  >
                    {t('guest.identity.blocked.body')}
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-5 text-center sm:p-6">
                  <h3 className="text-base font-semibold text-gray-900">
                    {t('guest.commentCta.title')}
                  </h3>
                  <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
                    {t('guest.commentCta.body')}
                  </p>
                  <button
                    type="button"
                    onClick={() => setIdentityOpen(true)}
                    className="mt-4 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600"
                  >
                    {t('guest.commentCta.button')}
                  </button>
                </div>
              )
            ) : (
              <GuestComments
                contractId={contract.id}
                guestJwt={guestJwt as string}
                guestName={guestName}
                initialComments={seedComments}
                onSessionExpired={handleGuestSessionExpired}
              />
            )}
          </section>

          <EstablishIdentityModal
            isOpen={identityOpen}
            onClose={() => setIdentityOpen(false)}
            token={invitationToken}
            invitedEmail={invitedEmail}
            onEstablished={handleEstablished}
            onUnusable={() => setIdentityUnusable(true)}
          />
        </>
      )}
    </GuestLayout>
  );
}
