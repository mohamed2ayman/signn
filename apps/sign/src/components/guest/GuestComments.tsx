import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import axios from 'axios';
import {
  getGuestComments,
  postGuestComment,
  type GuestComment,
  type GuestVisibleComment,
} from '@/services/api/guestService';

const MAX_LEN = 10000;

type ListState = 'loading' | 'ready' | 'error';

/**
 * Guest comments section — visible ONLY after identity is established (the GET
 * and POST both need the guest JWT).
 *
 * On mount it loads the persisted, guest-VISIBLE conversation on the bound
 * contract: the guest's own comments AND SIGN-team replies explicitly marked
 * guest-visible. Internal SIGN-team notes are filtered out server-side and
 * never reach here. Each comment is tagged guest-vs-team so the recipient can
 * tell who they're hearing from. Newly-posted comments append to the list.
 */
export default function GuestComments({
  contractId,
  guestJwt,
  guestName,
  initialComments = [],
  onSessionExpired,
}: {
  contractId: string;
  guestJwt: string;
  guestName: string;
  initialComments?: GuestComment[];
  onSessionExpired?: () => void;
}) {
  const { t } = useTranslation();

  // Optimistic seed from any resume-intent comment, mapped to the visible
  // shape. The on-mount fetch is the source of truth and replaces it.
  const [comments, setComments] = useState<GuestVisibleComment[]>(() =>
    initialComments.map((c) => ({
      id: c.id,
      contract_id: c.contract_id,
      contract_clause_id: c.contract_clause_id ?? null,
      content: c.content,
      created_at: c.created_at,
      author_name: guestName,
      author_role: 'GUEST' as const,
    })),
  );
  const [listState, setListState] = useState<ListState>('loading');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setListState('loading');
    try {
      const data = await getGuestComments(contractId, guestJwt);
      setComments(data);
      setListState('ready');
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      setListState('error');
      // Guest JWT (15-min access) lapsed — let the page drop back to read-only.
      if (status === 401) onSessionExpired?.();
    }
  }, [contractId, guestJwt, onSessionExpired]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    const text = content.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      const created = await postGuestComment(contractId, guestJwt, { content: text });
      // The poster is always the guest → map the raw POST response to the
      // visible shape locally and append (conversation order, newest at bottom).
      setComments((prev) => [
        ...prev,
        {
          id: created.id,
          contract_id: created.contract_id,
          contract_clause_id: created.contract_clause_id ?? null,
          content: created.content,
          created_at: created.created_at,
          author_name: guestName,
          author_role: 'GUEST',
        },
      ]);
      setContent('');
      // A successful post means the list is live even if the initial GET failed.
      setListState('ready');
      toast.success(t('guest.comments.success'));
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status === 401) {
        toast.error(t('guest.comments.errors.sessionExpired'));
        onSessionExpired?.();
      } else if (status === 429) {
        toast.error(t('guest.comments.errors.throttled'));
      } else {
        toast.error(t('guest.comments.errors.generic'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-5 py-3">
        <h3 className="text-sm font-semibold text-gray-700">
          {t('guest.comments.heading')}
          {comments.length > 0 && (
            <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-500">
              {comments.length}
            </span>
          )}
        </h3>
      </div>

      <div className="space-y-4 p-5">
        {/* Composer */}
        <div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value.slice(0, MAX_LEN))}
            rows={3}
            placeholder={t('guest.comments.placeholder')}
            className="w-full resize-y rounded-lg border border-gray-300 p-3 text-sm focus:border-primary focus:outline-none"
            dir="auto"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-gray-400">
              {content.length}/{MAX_LEN}
            </span>
            <button
              type="button"
              onClick={submit}
              disabled={submitting || !content.trim()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
            >
              {submitting ? t('guest.comments.posting') : t('guest.comments.post')}
            </button>
          </div>
        </div>

        {/* Conversation */}
        {listState === 'loading' ? (
          <p className="py-4 text-center text-sm text-gray-400">
            {t('guest.comments.loading')}
          </p>
        ) : listState === 'error' && comments.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-500">
            {t('guest.comments.loadError')}{' '}
            <button
              type="button"
              onClick={load}
              className="font-medium text-primary underline hover:text-primary-700"
            >
              {t('guest.comments.retry')}
            </button>
          </p>
        ) : comments.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-400">
            {t('guest.comments.empty')}
          </p>
        ) : (
          <ul className="space-y-3">
            {comments.map((c) => {
              const isTeam = c.author_role === 'TEAM';
              return (
                <li
                  key={c.id}
                  className={`rounded-lg border border-gray-100 p-3 ${
                    isTeam
                      ? 'border-l-4 border-l-navy-400 bg-navy-50/40'
                      : 'border-l-4 border-l-primary bg-gray-50/60'
                  }`}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-gray-700" dir="auto">
                      {c.author_name}
                    </span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        isTeam
                          ? 'bg-navy-100 text-navy-700'
                          : 'bg-primary/10 text-primary'
                      }`}
                    >
                      {isTeam ? t('guest.comments.teamBadge') : t('guest.comments.badge')}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {new Date(c.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p
                    className="text-sm text-gray-700"
                    dir="auto"
                    style={{ unicodeBidi: 'plaintext', overflowWrap: 'anywhere' }}
                  >
                    {c.content}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
