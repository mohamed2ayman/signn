import { useEffect, useState } from 'react';
import { supportChatService } from '@/services/api/supportChatService';

type Status = 'ONLINE' | 'AWAY' | 'OFFLINE';

const COLORS: Record<Status, string> = {
  ONLINE: 'bg-green-500',
  AWAY: 'bg-yellow-500',
  OFFLINE: 'bg-gray-400',
};

export default function AvailabilityToggle() {
  const [status, setStatus] = useState<Status>('OFFLINE');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supportChatService.ops
      .getAvailability()
      .then((r) => {
        if (!cancelled) setStatus(r.status);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const change = async (next: Status) => {
    setSaving(true);
    try {
      await supportChatService.ops.setAvailability(next);
      setStatus(next);
    } finally {
      setSaving(false);
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={saving}
        className="flex items-center gap-2 rounded border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
      >
        <span className={`h-2.5 w-2.5 rounded-full ${COLORS[status]}`} />
        <span className="font-medium">{status}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 min-w-[140px] rounded border border-gray-200 bg-white py-1 shadow-md">
          {(['ONLINE', 'AWAY', 'OFFLINE'] as Status[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => change(s)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              <span className={`h-2.5 w-2.5 rounded-full ${COLORS[s]}`} />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
