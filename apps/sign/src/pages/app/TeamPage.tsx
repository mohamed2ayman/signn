import { useState, useEffect } from 'react';
import { adminService } from '@/services/api/adminService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import type { User, UserRole } from '@/types';
import { JOB_TITLES, JOB_TITLE_DEFAULT_PERMISSION, PermissionLevel } from '@/types';

const INVITABLE_ROLES: { value: string; label: string; description: string }[] = [
  {
    value: 'OWNER_ADMIN',
    label: 'Organization Admin',
    description: 'Full access to manage team, projects, and settings',
  },
  {
    value: 'OWNER_CREATOR',
    label: 'Contract Creator',
    description: 'Can create, edit, and manage contracts within assigned projects',
  },
  {
    value: 'OWNER_REVIEWER',
    label: 'Contract Reviewer',
    description: 'Can review and comment on contracts within assigned projects',
  },
];

const PERMISSION_LEVELS: {
  value: PermissionLevel;
  label: string;
  description: string;
}[] = [
  {
    value: PermissionLevel.VIEWER,
    label: 'Viewer',
    description: 'Can view contracts and documents (read-only)',
  },
  {
    value: PermissionLevel.COMMENTER,
    label: 'Commenter',
    description: 'Can view and add comments on contracts',
  },
  {
    value: PermissionLevel.EDITOR,
    label: 'Editor',
    description: 'Can create, edit, and manage contract content',
  },
  {
    value: PermissionLevel.APPROVER,
    label: 'Approver',
    description: 'Full access including final approval of contracts',
  },
];

export default function TeamPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    email: '',
    role: 'OWNER_CREATOR' as string,
    job_title: '',
    default_permission_level: '' as string,
  });
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    adminService
      .getUsers()
      .then(setUsers)
      .catch(() => setError('Failed to load team members'))
      .finally(() => setLoading(false));
  }, []);

  /** When job title changes, auto-select the default permission level */
  const handleJobTitleChange = (jobTitle: string) => {
    const defaultPermission =
      jobTitle && JOB_TITLE_DEFAULT_PERMISSION[jobTitle]
        ? JOB_TITLE_DEFAULT_PERMISSION[jobTitle]
        : '';
    setInviteForm((prev) => ({
      ...prev,
      job_title: jobTitle,
      default_permission_level: defaultPermission,
    }));
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteForm.email) return;
    setInviting(true);
    setError('');
    setSuccess('');
    try {
      await adminService.inviteUser({
        email: inviteForm.email,
        role: inviteForm.role as UserRole,
        job_title: inviteForm.job_title || undefined,
        default_permission_level:
          (inviteForm.default_permission_level as PermissionLevel) || undefined,
      });
      setSuccess(`Invitation sent to ${inviteForm.email}`);
      setInviteForm({
        email: '',
        role: 'OWNER_CREATOR',
        job_title: '',
        default_permission_level: '',
      });
      setShowInvite(false);
      // Refresh list
      const updated = await adminService.getUsers();
      setUsers(updated);
    } catch {
      setError('Failed to send invitation');
    } finally {
      setInviting(false);
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Team Management</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your organization members, invite new users, and assign job
            titles.
          </p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4v16m8-8H4"
            />
          </svg>
          Invite Member
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-600">
          {success}
        </div>
      )}

      {/* Team Members Table */}
      <div className="rounded-xl border border-gray-200/80 bg-white shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-6 py-3 text-left font-medium text-gray-500">
                  Member
                </th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">
                  Job Title
                </th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">
                  System Role
                </th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">
                  Permission Level
                </th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">
                  Status
                </th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">
                  Last Login
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="transition-colors hover:bg-gray-50/50"
                >
                  <td className="px-6 py-3.5">
                    <div>
                      <p className="font-medium text-gray-900">
                        {user.first_name || user.last_name
                          ? `${user.first_name} ${user.last_name}`
                          : '(pending invitation)'}
                      </p>
                      <p className="text-xs text-gray-400">{user.email}</p>
                    </div>
                  </td>
                  <td className="px-6 py-3.5 text-gray-600">
                    {user.job_title || (
                      <span className="text-gray-300">Not set</span>
                    )}
                  </td>
                  <td className="px-6 py-3.5">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                      {INVITABLE_ROLES.find((r) => r.value === user.role)
                        ?.label || user.role.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-3.5">
                    {user.default_permission_level ? (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
                        {user.default_permission_level}
                      </span>
                    ) : (
                      <span className="text-gray-300 text-xs">Not set</span>
                    )}
                  </td>
                  <td className="px-6 py-3.5">
                    {user.is_active ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                        Pending
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3.5 text-xs text-gray-400">
                    {user.last_login_at
                      ? new Date(user.last_login_at).toLocaleDateString()
                      : 'Never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite Modal */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-gray-200/50 bg-white p-6 shadow-elevated">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Invite Team Member
                </h2>
                <p className="mt-0.5 text-sm text-gray-400">
                  Send an invitation with role, job title, and permission level
                </p>
              </div>
              <button
                onClick={() => setShowInvite(false)}
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <form onSubmit={handleInvite} className="space-y-4">
              {/* Email */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Email Address *
                </label>
                <input
                  type="email"
                  required
                  value={inviteForm.email}
                  onChange={(e) =>
                    setInviteForm({ ...inviteForm, email: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm transition-colors placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="colleague@company.com"
                />
              </div>

              {/* System Role */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  System Role *
                </label>
                <select
                  value={inviteForm.role}
                  onChange={(e) =>
                    setInviteForm({ ...inviteForm, role: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {INVITABLE_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-400">
                  {INVITABLE_ROLES.find((r) => r.value === inviteForm.role)
                    ?.description}
                </p>
              </div>

              {/* Job Title */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Job Title
                </label>
                <select
                  value={inviteForm.job_title}
                  onChange={(e) => handleJobTitleChange(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">Select a job title...</option>
                  {JOB_TITLES.map((jt) => (
                    <option key={jt} value={jt}>
                      {jt}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-400">
                  Determines the default permission level when added to projects
                </p>
              </div>

              {/* Permission Level */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Default Permission Level
                </label>
                <select
                  value={inviteForm.default_permission_level}
                  onChange={(e) =>
                    setInviteForm({
                      ...inviteForm,
                      default_permission_level: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">Select permission level...</option>
                  {PERMISSION_LEVELS.map((pl) => (
                    <option key={pl.value} value={pl.value}>
                      {pl.label} — {pl.description}
                    </option>
                  ))}
                </select>
                {inviteForm.default_permission_level && (
                  <p className="mt-1 text-xs text-gray-400">
                    {
                      PERMISSION_LEVELS.find(
                        (pl) =>
                          pl.value === inviteForm.default_permission_level,
                      )?.description
                    }
                  </p>
                )}
                {inviteForm.job_title &&
                  inviteForm.default_permission_level &&
                  JOB_TITLE_DEFAULT_PERMISSION[inviteForm.job_title] &&
                  inviteForm.default_permission_level !==
                    JOB_TITLE_DEFAULT_PERMISSION[inviteForm.job_title] && (
                    <p className="mt-1 text-xs text-amber-500">
                      Note: This overrides the default (
                      {JOB_TITLE_DEFAULT_PERMISSION[inviteForm.job_title]}) for
                      the selected job title.
                    </p>
                  )}
              </div>

              <div className="flex justify-end gap-2.5 border-t border-gray-100 pt-4">
                <button
                  type="button"
                  onClick={() => setShowInvite(false)}
                  className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviting}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-50"
                >
                  {inviting && <LoadingSpinner size="sm" />}
                  Send Invitation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
