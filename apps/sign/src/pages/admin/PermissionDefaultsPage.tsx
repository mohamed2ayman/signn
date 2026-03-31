import { useState, useEffect } from 'react';
import { permissionDefaultsService } from '@/services/api/permissionDefaultsService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import type { PermissionDefaultEntry, PermissionLevel } from '@/types';

const PERMISSION_LEVELS: PermissionLevel[] = ['VIEWER', 'COMMENTER', 'EDITOR', 'APPROVER'] as unknown as PermissionLevel[];

const levelBadge: Record<string, { bg: string; text: string }> = {
  VIEWER: { bg: 'bg-gray-100', text: 'text-gray-700' },
  COMMENTER: { bg: 'bg-blue-50', text: 'text-blue-700' },
  EDITOR: { bg: 'bg-amber-50', text: 'text-amber-700' },
  APPROVER: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
};

export default function PermissionDefaultsPage() {
  const [defaults, setDefaults] = useState<PermissionDefaultEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    permissionDefaultsService
      .getAll()
      .then(setDefaults)
      .catch(() => setError('Failed to load permission defaults'))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = async (jobTitle: string, newLevel: string) => {
    setSaving(jobTitle);
    setError('');
    try {
      const updated = await permissionDefaultsService.update(
        jobTitle,
        newLevel as PermissionLevel,
      );
      setDefaults((prev) =>
        prev.map((d) => (d.job_title === jobTitle ? updated : d)),
      );
    } catch {
      setError(`Failed to update default for ${jobTitle}`);
    } finally {
      setSaving(null);
    }
  };

  const handleReset = async (jobTitle: string) => {
    setSaving(jobTitle);
    setError('');
    try {
      const reset = await permissionDefaultsService.reset(jobTitle);
      setDefaults((prev) =>
        prev.map((d) => (d.job_title === jobTitle ? reset : d)),
      );
    } catch {
      setError(`Failed to reset default for ${jobTitle}`);
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">
          Permission Defaults Management
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure the default permission level assigned to each job title when
          users are added to projects. Changes only affect new assignments —
          existing per-project overrides are not retroactively changed.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-gray-200/80 bg-white shadow-card">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-[15px] font-semibold text-gray-900">
            Job Title → Default Permission Level
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-6 py-3 text-left font-medium text-gray-500">
                  Job Title
                </th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">
                  Current Default
                </th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">
                  Change To
                </th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">
                  Status
                </th>
                <th className="px-6 py-3 text-right font-medium text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {defaults.map((entry) => {
                const badge = levelBadge[entry.permission_level] || levelBadge.VIEWER;
                return (
                  <tr
                    key={entry.job_title}
                    className="transition-colors hover:bg-gray-50/50"
                  >
                    <td className="px-6 py-3.5 font-medium text-gray-900">
                      {entry.job_title}
                    </td>
                    <td className="px-6 py-3.5">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.bg} ${badge.text}`}
                      >
                        {entry.permission_level}
                      </span>
                    </td>
                    <td className="px-6 py-3.5">
                      <select
                        value={entry.permission_level}
                        onChange={(e) =>
                          handleChange(entry.job_title, e.target.value)
                        }
                        disabled={saving === entry.job_title}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                      >
                        {PERMISSION_LEVELS.map((lvl) => (
                          <option key={lvl} value={lvl}>
                            {lvl}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-6 py-3.5">
                      {entry.is_custom ? (
                        <span className="text-xs text-amber-600">
                          Custom override
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">
                          System default
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      {entry.is_custom && (
                        <button
                          onClick={() => handleReset(entry.job_title)}
                          disabled={saving === entry.job_title}
                          className="text-xs text-gray-500 underline transition-colors hover:text-red-600 disabled:opacity-50"
                        >
                          Reset to default
                        </button>
                      )}
                      {saving === entry.job_title && (
                        <LoadingSpinner size="sm" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
