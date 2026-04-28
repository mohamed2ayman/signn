import { useEffect, useState } from 'react';
import {
  supportChatService,
  type SupportChatNote,
} from '@/services/api/supportChatService';
import { supportSocketService } from '@/services/supportSocketService';

interface Props {
  chatId: string;
}

/**
 * Internal-only notes panel — never visible to the user. Reads via REST,
 * also subscribes to `support:note_added` (emitted by the gateway only to
 * the ops queue room) so other ops members see new notes live.
 */
export default function OpsNotesTab({ chatId }: Props) {
  const [notes, setNotes] = useState<SupportChatNote[]>([]);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supportChatService.ops
      .listNotes(chatId)
      .then((rows) => !cancelled && setNotes(rows))
      .catch(() => {});

    const handler = (payload: any) => {
      if (payload?.chat_id !== chatId) return;
      setNotes((prev) =>
        prev.some((n) => n.id === payload.id) ? prev : [...prev, payload],
      );
    };
    supportSocketService.on('support:note_added', handler);

    return () => {
      cancelled = true;
      supportSocketService.off('support:note_added', handler);
    };
  }, [chatId]);

  const handleAdd = async () => {
    const text = draft.trim();
    if (!text) return;
    setSubmitting(true);
    try {
      const note = await supportChatService.ops.addNote(chatId, text);
      setNotes((prev) =>
        prev.some((n) => n.id === note.id) ? prev : [...prev, note],
      );
      setDraft('');
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Could not add note');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto bg-amber-50 p-3">
        {notes.length === 0 ? (
          <div className="text-center text-xs italic text-gray-500">
            No internal notes yet. Notes are visible to ops only — never sent
            to the user.
          </div>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li
                key={n.id}
                className="rounded border border-amber-200 bg-white px-3 py-2 text-sm"
              >
                <div className="whitespace-pre-wrap text-gray-800">{n.body}</div>
                <div className="mt-1 text-[10px] text-gray-500">
                  {n.ops?.first_name} {n.ops?.last_name} ·{' '}
                  {new Date(n.created_at).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="border-t border-gray-200 bg-white p-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Add an internal note (only visible to ops)…"
          className="w-full resize-none rounded border border-gray-300 p-2 text-sm focus:border-primary focus:outline-none"
        />
        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={handleAdd}
            disabled={submitting || !draft.trim()}
            className="rounded bg-amber-500 px-3 py-1 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
          >
            Add note
          </button>
        </div>
      </div>
    </div>
  );
}
