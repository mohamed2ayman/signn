import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import axios from 'axios';
import { postGuestComment, type GuestComment } from '@/services/api/guestService';

const MAX_LEN = 10000;

/**
 * Guest comments section — visible ONLY after identity is established.
 *
 * The backend exposes no GET for guest comments, so this lists what the guest
 * posts during the session (seeded with any comment created at identity time).
 * Posting uses the explicit Bearer guest JWT via the isolated client.
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
  const [comments, setComments] = useState<GuestComment[]>(initialComments);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const text = content.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      const created = await postGuestComment(contractId, guestJwt, { content: text });
      setComments((prev) => [created, ...prev]);
      setContent('');
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

        {/* List */}
        {comments.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-400">
            {t('guest.comments.empty')}
          </p>
        ) : (
          <ul className="space-y-3">
            {comments.map((c) => (
              <li key={c.id} className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-700" dir="auto">
                    {guestName}
                  </span>
                  <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    {t('guest.comments.badge')}
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
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
