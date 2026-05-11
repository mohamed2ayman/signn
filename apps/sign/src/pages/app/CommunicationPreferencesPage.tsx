import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/services/api/axios';
import LoadingSpinner from '@/components/common/LoadingSpinner';

interface CommunicationPreferences {
  marketing_email_opt_in: boolean;
  email_digest_opt_out: boolean;
  ai_training_opt_in: boolean;
}

async function fetchPreferences(): Promise<CommunicationPreferences> {
  const { data } = await api.get<CommunicationPreferences>('/me/communication-preferences');
  return data;
}

async function patchPreferences(
  patch: Partial<CommunicationPreferences>,
): Promise<CommunicationPreferences> {
  const { data } = await api.patch<CommunicationPreferences>(
    '/me/communication-preferences',
    patch,
  );
  return data;
}

interface ToggleCardProps {
  title: string;
  description: string;
  enabled: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

function ToggleCard({ title, description, enabled, onChange, disabled }: ToggleCardProps) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex-1">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <p className="mt-1 text-xs text-gray-500">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`${title} toggle`}
        disabled={disabled}
        onClick={() => onChange(!enabled)}
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

export default function CommunicationPreferencesPage() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['me-communication-preferences'],
    queryFn: fetchPreferences,
  });

  const mutation = useMutation({
    mutationFn: patchPreferences,
    onSuccess: (next) => {
      qc.setQueryData(['me-communication-preferences'], next);
    },
    onError: () => {
      toast.error('Could not save your preferences. Please try again.');
    },
  });

  const apply = (patch: Partial<CommunicationPreferences>, successMsg?: string) => {
    mutation.mutate(patch, {
      onSuccess: () => {
        if (successMsg) toast.success(successMsg);
        else toast.success('Preferences saved');
      },
    });
  };

  if (query.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  const prefs = query.data ?? {
    marketing_email_opt_in: false,
    email_digest_opt_out: false,
    ai_training_opt_in: false,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-2">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Communication Preferences</h1>
        <p className="mt-1 text-sm text-gray-500">Manage how SIGN communicates with you</p>
      </header>

      <ToggleCard
        title="Marketing emails and product updates"
        description="Receive news about new features, industry insights, and SIGN updates"
        enabled={prefs.marketing_email_opt_in}
        onChange={(v) => apply({ marketing_email_opt_in: v })}
        disabled={mutation.isPending}
      />

      <ToggleCard
        title="Weekly obligation digest emails"
        description="Receive a weekly summary of upcoming contract obligations and deadlines"
        enabled={!prefs.email_digest_opt_out}
        onChange={(v) => apply({ email_digest_opt_out: !v })}
        disabled={mutation.isPending}
      />

      <ToggleCard
        title="Allow my data to be used to improve SIGN AI"
        description="Opt in to let SIGN use anonymized clause and feedback data to improve AI features"
        enabled={prefs.ai_training_opt_in}
        onChange={(v) => apply({ ai_training_opt_in: v })}
        disabled={mutation.isPending}
      />

      <div className="rounded-xl border border-red-100 bg-red-50/50 p-5">
        <h3 className="text-sm font-semibold text-red-700">One-click unsubscribe</h3>
        <p className="mt-1 text-xs text-red-600/80">
          Turn off all marketing emails immediately. Transactional emails (security alerts,
          billing, contract activity) cannot be disabled — see policy below.
        </p>
        <button
          type="button"
          onClick={() =>
            apply(
              { marketing_email_opt_in: false },
              'You have been unsubscribed from all marketing communications',
            )
          }
          disabled={mutation.isPending || !prefs.marketing_email_opt_in}
          className="mt-3 inline-flex items-center gap-2 rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
        >
          Unsubscribe from all marketing
        </button>
      </div>

      <p className="pt-2 text-center text-xs text-gray-400">
        <Link to="/legal/communications" className="hover:underline">
          View our full Communication Preferences Policy →
        </Link>
      </p>
    </div>
  );
}
