import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import meService from '@/services/api/meService';
import LoadingSpinner from '@/components/common/LoadingSpinner';

/**
 * /app/settings/security — user-facing Profile + Security page.
 *
 * Includes: name/job-title editor, password change form, active sessions
 * list with per-session revoke + "sign out everywhere", and a GDPR
 * self-service data-export button.
 */
export default function MySecurityPage() {
  const qc = useQueryClient();

  const profile = useQuery({ queryKey: ['me-profile'], queryFn: meService.getProfile });
  const sessions = useQuery({ queryKey: ['me-sessions'], queryFn: meService.listSessions });

  const [nameDraft, setNameDraft] = useState<{
    first_name: string;
    last_name: string;
    job_title: string;
  } | null>(null);
  const draft = nameDraft ?? {
    first_name: profile.data?.first_name ?? '',
    last_name: profile.data?.last_name ?? '',
    job_title: profile.data?.job_title ?? '',
  };

  const updateProfile = useMutation({
    mutationFn: meService.updateProfile,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me-profile'] });
      setNameDraft(null);
    },
  });

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const changePw = useMutation({
    mutationFn: ({ current, next }: { current: string; next: string }) =>
      meService.changePassword(current, next),
    onSuccess: () => {
      setPw({ current: '', next: '', confirm: '' });
      setPwMsg('Password updated.');
    },
    onError: (err: any) => {
      setPwMsg(err?.response?.data?.message ?? 'Could not change password.');
    },
  });

  const revokeOne = useMutation({
    mutationFn: meService.revokeSession,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me-sessions'] }),
  });
  const revokeAll = useMutation({
    mutationFn: meService.revokeAllSessions,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me-sessions'] }),
  });

  const exportData = useMutation({ mutationFn: meService.exportMyData });

  if (profile.isLoading || !profile.data) return <LoadingSpinner />;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Profile & Security</h1>
        <p className="mt-1 text-sm text-gray-600">
          Manage your account, password, active sessions, and personal data.
        </p>
      </header>

      <Section title="Profile">
        <Field label="Email">
          <input
            disabled
            value={profile.data.email}
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="First name">
            <input
              value={draft.first_name}
              onChange={(e) =>
                setNameDraft({ ...draft, first_name: e.target.value })
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Last name">
            <input
              value={draft.last_name}
              onChange={(e) => setNameDraft({ ...draft, last_name: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </Field>
        </div>
        <Field label="Job title">
          <input
            value={draft.job_title}
            onChange={(e) => setNameDraft({ ...draft, job_title: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </Field>
        <div className="flex justify-end">
          <button
            onClick={() => updateProfile.mutate(draft)}
            disabled={updateProfile.isPending || !nameDraft}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {updateProfile.isPending ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </Section>

      <Section title="Change password">
        <Field label="Current password">
          <input
            type="password"
            value={pw.current}
            onChange={(e) => setPw({ ...pw, current: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="New password">
          <input
            type="password"
            value={pw.next}
            onChange={(e) => setPw({ ...pw, next: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Confirm new password">
          <input
            type="password"
            value={pw.confirm}
            onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </Field>
        {pwMsg && (
          <p
            className={`text-sm ${
              pwMsg === 'Password updated.' ? 'text-green-700' : 'text-red-600'
            }`}
          >
            {pwMsg}
          </p>
        )}
        <div className="flex justify-end">
          <button
            disabled={
              changePw.isPending ||
              !pw.current ||
              !pw.next ||
              pw.next !== pw.confirm
            }
            onClick={() =>
              changePw.mutate({ current: pw.current, next: pw.next })
            }
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {changePw.isPending ? 'Updating…' : 'Update password'}
          </button>
        </div>
        {profile.data.password_changed_at && (
          <p className="text-xs text-gray-500">
            Last changed{' '}
            {formatDistanceToNow(new Date(profile.data.password_changed_at), {
              addSuffix: true,
            })}
          </p>
        )}
      </Section>

      <Section title="Active sessions">
        <div className="flex justify-end">
          <button
            onClick={() => revokeAll.mutate()}
            disabled={revokeAll.isPending}
            className="text-xs font-semibold text-red-600 hover:text-red-700"
          >
            Sign out everywhere
          </button>
        </div>
        {sessions.isLoading ? (
          <LoadingSpinner />
        ) : !sessions.data || sessions.data.length === 0 ? (
          <p className="text-sm text-gray-500">No active sessions.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {sessions.data.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {s.browser ?? 'Unknown browser'} on {s.os ?? 'unknown OS'}
                    {s.is_suspicious && (
                      <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                        SUSPICIOUS
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {s.location ?? 'unknown location'} · {s.ip_address ?? '—'} ·
                    last active {formatDistanceToNow(new Date(s.last_active_at), {
                      addSuffix: true,
                    })}
                  </div>
                </div>
                <button
                  onClick={() => revokeOne.mutate(s.id)}
                  className="text-xs font-semibold text-red-600 hover:text-red-700"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Your data (GDPR)">
        <p className="text-sm text-gray-600">
          You can download a complete copy of every record we hold about you.
          Profile, contracts you created, audit history, sessions, and devices.
          The link expires after 24 hours.
        </p>
        {exportData.data && (
          <div className="rounded-md bg-green-50 p-3">
            <p className="text-sm text-green-900">
              Export ready —{' '}
              <a className="underline" href={exportData.data.download_url}>
                download archive
              </a>
              . Expires{' '}
              {format(new Date(exportData.data.expires_at), 'PPpp')}.
            </p>
          </div>
        )}
        <div className="flex justify-end">
          <button
            disabled={exportData.isPending}
            onClick={() => exportData.mutate()}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-60"
          >
            {exportData.isPending ? 'Preparing…' : 'Request data export'}
          </button>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
