import { useState, useEffect } from 'react';
import { ShieldCheck, ShieldOff, RotateCcw, Search } from 'lucide-react';
import { adminService } from '@/services/api/adminService';
import type { AdminUser } from '@/services/api/adminService';
import LoadingSpinner from '@/components/common/LoadingSpinner';

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [resetting, setResetting] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    adminService
      .getAllUsers()
      .then(setUsers)
      .catch(() => setErrorMsg('Failed to load users'))
      .finally(() => setLoading(false));
  }, []);

  const handleResetMfa = async (user: AdminUser) => {
    if (
      !window.confirm(
        `Reset MFA for ${user.first_name} ${user.last_name} (${user.email})? They will need to set up MFA again.`,
      )
    ) {
      return;
    }
    setResetting(user.id);
    setSuccessMsg('');
    setErrorMsg('');
    try {
      await adminService.resetUserMfa(user.id);
      setUsers((prev) =>
        prev.map((u) =>
          u.id === user.id ? { ...u, mfa_enabled: false, mfa_method: null } : u,
        ),
      );
      setSuccessMsg(`MFA reset for ${user.email}`);
    } catch {
      setErrorMsg(`Failed to reset MFA for ${user.email}`);
    } finally {
      setResetting(null);
    }
  };

  const filtered = users.filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      `${u.first_name} ${u.last_name}`.toLowerCase().includes(search.toLowerCase()),
  );

  const mfaEnabledCount = users.filter((u) => u.mfa_enabled).length;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
        <p className="mt-1 text-sm text-gray-500">
          View all users and manage their MFA status.
        </p>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">Total Users</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">{users.length}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">MFA Enabled</p>
          <p className="mt-1 text-3xl font-bold text-emerald-600">{mfaEnabledCount}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">MFA Disabled</p>
          <p className="mt-1 text-3xl font-bold text-amber-500">{users.length - mfaEnabledCount}</p>
        </div>
      </div>

      {successMsg && (
        <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{successMsg}</div>
      )}
      {errorMsg && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{errorMsg}</div>
      )}

      {/* Search */}
      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search users by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-gray-200 py-2.5 pl-9 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              <th className="px-6 py-3">User</th>
              <th className="px-6 py-3">Role</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">MFA</th>
              <th className="px-6 py-3">Last Login</th>
              <th className="px-6 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <p className="font-medium text-gray-900">
                    {user.first_name} {user.last_name}
                  </p>
                  <p className="text-xs text-gray-500">{user.email}</p>
                </td>
                <td className="px-6 py-4">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    {user.role.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      user.is_active
                        ? 'bg-green-100 text-green-700'
                        : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {user.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-1.5">
                    {user.mfa_enabled ? (
                      <>
                        <ShieldCheck className="h-4 w-4 text-emerald-500" />
                        <span className="text-xs font-medium text-emerald-700">
                          {user.mfa_method === 'totp' ? 'TOTP' : 'Email'}
                        </span>
                      </>
                    ) : (
                      <>
                        <ShieldOff className="h-4 w-4 text-gray-400" />
                        <span className="text-xs text-gray-500">Disabled</span>
                      </>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 text-xs text-gray-500">
                  {user.last_login_at
                    ? new Date(user.last_login_at).toLocaleDateString()
                    : 'Never'}
                </td>
                <td className="px-6 py-4">
                  {user.mfa_enabled && (
                    <button
                      onClick={() => handleResetMfa(user)}
                      disabled={resetting === user.id}
                      className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {resetting === user.id ? 'Resetting…' : 'Reset MFA'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-sm text-gray-400">
                  No users found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
