import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import adminSecurityService, {
  type SecurityPolicy,
} from '@/services/api/adminSecurityService';
import LoadingSpinner from '@/components/common/LoadingSpinner';

/**
 * /admin/security — system-admin-only Security Settings page.
 *
 * Surfaces the singleton SecurityPolicy: session timeout, password
 * policy, lockout, MFA enforcement flags, and IP allow/blocklist.
 */
export default function AdminSecuritySettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-security-policy'],
    queryFn: adminSecurityService.getPolicy,
  });

  const [draft, setDraft] = useState<Partial<SecurityPolicy> | null>(null);
  const [allowText, setAllowText] = useState('');
  const [blockText, setBlockText] = useState('');
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (data && !draft) {
      setDraft({ ...data });
      setAllowText((data.ip_allowlist ?? []).join('\n'));
      setBlockText((data.ip_blocklist ?? []).join('\n'));
    }
  }, [data, draft]);

  const mutate = useMutation({
    mutationFn: (patch: Partial<SecurityPolicy>) =>
      adminSecurityService.updatePolicy(patch),
    onSuccess: (next) => {
      qc.setQueryData(['admin-security-policy'], next);
      setDraft({ ...next });
      setSavedAt(new Date());
    },
  });

  if (isLoading || !draft) return <LoadingSpinner />;

  const save = () => {
    const allowlist = allowText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const blocklist = blockText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    mutate.mutate({ ...draft, ip_allowlist: allowlist, ip_blocklist: blocklist });
  };

  const set = <K extends keyof SecurityPolicy>(key: K, value: SecurityPolicy[K]) => {
    setDraft((d) => ({ ...(d as SecurityPolicy), [key]: value }));
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Security Settings</h1>
        <p className="mt-1 text-sm text-gray-600">
          Platform-wide security controls. Changes are audited and apply to all organizations.
        </p>
      </header>

      <div className="space-y-6">
        {/* Sessions */}
        <Card title="Sessions">
          <Field label="Session timeout (minutes)" hint="How long a refresh token stays valid before forced re-auth">
            <input
              type="number"
              min={5}
              max={1440}
              value={draft.session_timeout_minutes ?? 240}
              onChange={(e) => set('session_timeout_minutes', Number(e.target.value))}
              className="w-32 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            />
          </Field>
        </Card>

        {/* Password */}
        <Card title="Password policy">
          <Field label="Minimum length">
            <input
              type="number"
              min={6}
              max={128}
              value={draft.password_min_length ?? 8}
              onChange={(e) => set('password_min_length', Number(e.target.value))}
              className="w-24 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            />
          </Field>
          <Toggle
            label="Require uppercase letter"
            checked={!!draft.password_require_upper}
            onChange={(v) => set('password_require_upper', v)}
          />
          <Toggle
            label="Require lowercase letter"
            checked={!!draft.password_require_lower}
            onChange={(v) => set('password_require_lower', v)}
          />
          <Toggle
            label="Require number"
            checked={!!draft.password_require_number}
            onChange={(v) => set('password_require_number', v)}
          />
          <Toggle
            label="Require symbol"
            checked={!!draft.password_require_symbol}
            onChange={(v) => set('password_require_symbol', v)}
          />
          <Field label="Expiry (days)" hint="0 disables forced rotation">
            <input
              type="number"
              min={0}
              max={3650}
              value={draft.password_expiry_days ?? 0}
              onChange={(e) => set('password_expiry_days', Number(e.target.value) || (null as unknown as number))}
              className="w-24 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            />
          </Field>
          <Field label="Reuse history" hint="Cannot match the last N passwords (0 disables)">
            <input
              type="number"
              min={0}
              max={20}
              value={draft.password_history_count ?? 0}
              onChange={(e) => set('password_history_count', Number(e.target.value))}
              className="w-24 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            />
          </Field>
        </Card>

        {/* Lockout */}
        <Card title="Account lockout">
          <Field label="Max failed attempts before lock">
            <input
              type="number"
              min={0}
              max={20}
              value={draft.lockout_max_attempts ?? 5}
              onChange={(e) => set('lockout_max_attempts', Number(e.target.value))}
              className="w-24 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            />
          </Field>
          <Field label="Lock duration (minutes)">
            <input
              type="number"
              min={1}
              max={1440}
              value={draft.lockout_duration_minutes ?? 30}
              onChange={(e) => set('lockout_duration_minutes', Number(e.target.value))}
              className="w-24 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            />
          </Field>
        </Card>

        {/* IP filter */}
        <Card title="IP filter">
          <Toggle
            label="IP filter enabled"
            checked={!!draft.ip_filter_enabled}
            onChange={(v) => set('ip_filter_enabled', v)}
          />
          <Field label="Allowlist (one CIDR per line — empty allows all)">
            <textarea
              rows={4}
              value={allowText}
              onChange={(e) => setAllowText(e.target.value)}
              placeholder="10.0.0.0/8&#10;192.168.1.5"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
            />
          </Field>
          <Field label="Blocklist (one CIDR per line)">
            <textarea
              rows={4}
              value={blockText}
              onChange={(e) => setBlockText(e.target.value)}
              placeholder="203.0.113.42&#10;198.51.100.0/24"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
            />
          </Field>
          <p className="text-xs text-gray-500">
            Loopback and private addresses are always allowed in non-production environments.
          </p>
        </Card>
      </div>

      <div className="mt-8 flex items-center justify-between">
        <span className="text-xs text-gray-500">
          {savedAt && `Saved ${savedAt.toLocaleTimeString()}`}
        </span>
        <button
          onClick={save}
          disabled={mutate.isPending}
          className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {mutate.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
      {mutate.isError && (
        <p className="mt-3 text-sm text-red-600">
          Failed to save: {(mutate.error as Error).message}
        </p>
      )}
    </div>
  );
}

// ─── Tiny presentational primitives (kept inline so the page stays one file)

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <span className="text-sm text-gray-700">{label}</span>
      <span
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-block h-5 w-9 rounded-full transition ${checked ? 'bg-indigo-600' : 'bg-gray-300'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${checked ? 'left-[18px]' : 'left-0.5'}`}
        />
      </span>
    </label>
  );
}
