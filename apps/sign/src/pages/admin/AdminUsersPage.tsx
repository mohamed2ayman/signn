import { useState, useEffect } from 'react';
import { ShieldCheck, ShieldOff, RotateCcw, Search, Plus, Send, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { adminService } from '@/services/api/adminService';
import type { AdminUser, CreateOperationsUserRequest } from '@/services/api/adminService';
import LoadingSpinner from '@/components/common/LoadingSpinner';

// ─── Types ────────────────────────────────────────────────────────────────────

type TabKey = 'all' | 'operations' | 'owners' | 'contractors';

const TABS: { key: TabKey; label: string; roles?: string[] }[] = [
  { key: 'all',         label: 'All Users' },
  { key: 'operations',  label: 'Operations Team', roles: ['OPERATIONS'] },
  { key: 'owners',      label: 'Owner Admins',    roles: ['OWNER_ADMIN'] },
  { key: 'contractors', label: 'Contractors',      roles: ['CONTRACTOR_ADMIN', 'CONTRACTOR_CREATOR', 'CONTRACTOR_REVIEWER', 'CONTRACTOR_TENDERING'] },
];

// ─── Password strength ────────────────────────────────────────────────────────

function getPasswordStrength(pw: string) {
  let score = 0;
  if (pw.length >= 8)           score++;
  if (/[A-Z]/.test(pw))        score++;
  if (/[0-9]/.test(pw))        score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 1) return { label: 'Weak',   color: 'bg-red-500',   text: 'text-red-500',   pct: 25 };
  if (score === 2) return { label: 'Fair',   color: 'bg-amber-400', text: 'text-amber-500', pct: 50 };
  if (score === 3) return { label: 'Good',   color: 'bg-blue-500',  text: 'text-blue-600',  pct: 75 };
  return                { label: 'Strong', color: 'bg-green-500', text: 'text-green-600', pct: 100 };
}

// ─── Invitation status badge ──────────────────────────────────────────────────

function InvitationBadge({ user }: { user: AdminUser }) {
  const { invitation_status, invitation_sent_at } = user;

  if (invitation_status === 'ACCEPTED') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
        Active
      </span>
    );
  }
  if (invitation_status === 'EXPIRED') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        Expired
      </span>
    );
  }
  if (invitation_status === 'PENDING' && invitation_sent_at) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
        title={new Date(invitation_sent_at).toLocaleString()}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        Inv. Sent · {formatDistanceToNow(new Date(invitation_sent_at), { addSuffix: false })} ago
      </span>
    );
  }
  return <span className="text-xs text-gray-300">—</span>;
}

// ─── Add Operations Modal ─────────────────────────────────────────────────────

interface AddModalProps {
  onClose: () => void;
  onSuccess: (user: AdminUser, email: string) => void;
}

function AddOperationsModal({ onClose, onSuccess }: AddModalProps) {
  const [form, setForm] = useState<CreateOperationsUserRequest>({
    firstName: '', lastName: '', email: '',
    temporaryPassword: '', jobTitle: '', department: '',
  });
  const [emailError, setEmailError]   = useState('');
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [showPw, setShowPw]           = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [serverError, setServerError] = useState('');

  const set = (field: keyof CreateOperationsUserRequest) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleEmailBlur = async () => {
    if (!form.email) return;
    setCheckingEmail(true);
    setEmailError('');
    try {
      const { exists } = await adminService.checkEmail(form.email);
      if (exists) setEmailError('Email already registered');
    } catch {
      // silently ignore network errors
    } finally {
      setCheckingEmail(false);
    }
  };

  const strength = form.temporaryPassword ? getPasswordStrength(form.temporaryPassword) : null;

  const isValid =
    form.firstName.trim() &&
    form.lastName.trim() &&
    form.email.trim() &&
    !emailError &&
    form.temporaryPassword.length >= 8 &&
    /[A-Z]/.test(form.temporaryPassword) &&
    /[0-9]/.test(form.temporaryPassword) &&
    /[^A-Za-z0-9]/.test(form.temporaryPassword);

  const handleSubmit = async () => {
    if (!isValid) return;
    setSubmitting(true);
    setServerError('');
    try {
      const newUser = await adminService.createOperationsUser(form);
      onSuccess(newUser, form.email);
    } catch (err: any) {
      setServerError(
        err?.response?.data?.message ?? 'Failed to create user. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <h2 className="text-base font-semibold text-gray-900">Add Operations Member</h2>
            <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="space-y-4 px-6 py-5">
            {serverError && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{serverError}</div>
            )}

            {/* Role (readonly) */}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Role</label>
              <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                  Operations
                </span>
                <span className="text-xs text-gray-400">Read-only — set automatically</span>
              </div>
            </div>

            {/* Name row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">
                  First Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.firstName}
                  onChange={set('firstName')}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Jane"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">
                  Last Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.lastName}
                  onChange={set('lastName')}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Smith"
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Email Address <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="email"
                  value={form.email}
                  onChange={set('email')}
                  onBlur={handleEmailBlur}
                  className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
                    emailError
                      ? 'border-red-400 focus:border-red-400 focus:ring-red-300'
                      : 'border-gray-200 focus:border-primary focus:ring-primary'
                  }`}
                  placeholder="jane.smith@example.com"
                />
                {checkingEmail && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <LoadingSpinner size="sm" />
                  </div>
                )}
              </div>
              {emailError && (
                <p className="mt-1 text-xs text-red-600">{emailError}</p>
              )}
            </div>

            {/* Temporary password */}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Temporary Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={form.temporaryPassword}
                  onChange={set('temporaryPassword')}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 pr-10 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Min 8 chars, 1 uppercase, 1 number, 1 special"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPw ? (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>

              {/* Strength meter */}
              {form.temporaryPassword && strength && (
                <div className="mt-1.5">
                  <div className="h-1 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${strength.color}`}
                      style={{ width: `${strength.pct}%` }}
                    />
                  </div>
                  <p className={`mt-0.5 text-xs font-medium ${strength.text}`}>{strength.label}</p>
                </div>
              )}
            </div>

            {/* Optional fields */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Job Title</label>
                <input
                  type="text"
                  value={form.jobTitle ?? ''}
                  onChange={set('jobTitle')}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Optional"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Department</label>
                <input
                  type="text"
                  value={form.department ?? ''}
                  onChange={set('department')}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Optional"
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-6 py-4">
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!isValid || submitting}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? <LoadingSpinner size="sm" /> : <Send className="h-3.5 w-3.5" />}
              {submitting ? 'Creating…' : 'Create & Send Invitation'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, type, onDismiss }: { message: string; type: 'success' | 'error'; onDismiss: () => void }) {
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-xl px-4 py-3 shadow-lg ${
      type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
    }`}>
      <p className="text-sm font-medium">{message}</p>
      <button onClick={onDismiss} className="ml-1 flex-shrink-0 opacity-80 hover:opacity-100">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const [users, setUsers]       = useState<AdminUser[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [showModal, setShowModal] = useState(false);
  const [resending, setResending] = useState<string | null>(null);
  const [resettingMfa, setResettingMfa] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadUsers = () => {
    setLoading(true);
    adminService
      .getAllUsers()
      .then(setUsers)
      .catch(() => showToast('Failed to load users', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadUsers(); }, []);

  // ── Derived counts for tabs + stats ──────────────────────────────────────
  const countByTab = (tab: typeof TABS[number]) =>
    tab.roles
      ? users.filter((u) => tab.roles!.includes(u.role)).length
      : users.length;

  const tabUsers = (() => {
    const tab = TABS.find((t) => t.key === activeTab)!;
    if (!tab.roles) return users;
    return users.filter((u) => tab.roles!.includes(u.role));
  })();

  const filtered = tabUsers.filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      `${u.first_name} ${u.last_name}`.toLowerCase().includes(search.toLowerCase()),
  );

  const mfaEnabled   = users.filter((u) => u.mfa_enabled).length;
  const opsCount     = users.filter((u) => u.role === 'OPERATIONS').length;

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleResetMfa = async (user: AdminUser) => {
    if (!window.confirm(`Reset MFA for ${user.first_name} ${user.last_name}? They will need to re-enrol.`)) return;
    setResettingMfa(user.id);
    try {
      await adminService.resetUserMfa(user.id);
      setUsers((prev) =>
        prev.map((u) => u.id === user.id ? { ...u, mfa_enabled: false, mfa_method: null } : u),
      );
      showToast(`MFA reset for ${user.email}`);
    } catch {
      showToast(`Failed to reset MFA for ${user.email}`, 'error');
    } finally {
      setResettingMfa(null);
    }
  };

  const handleResendInvitation = async (user: AdminUser) => {
    setResending(user.id);
    try {
      await adminService.resendInvitation(user.id);
      setUsers((prev) =>
        prev.map((u) =>
          u.id === user.id
            ? { ...u, invitation_sent_at: new Date().toISOString(), invitation_status: 'PENDING' }
            : u,
        ),
      );
      showToast(`Invitation resent to ${user.email}`);
    } catch {
      showToast(`Failed to resend invitation`, 'error');
    } finally {
      setResending(null);
    }
  };

  const handleModalSuccess = (_newUser: AdminUser, email: string) => {
    setShowModal(false);
    loadUsers(); // refetch to get computed invitation_status
    showToast(`Operations member created. Invitation email sent to ${email}`);
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><LoadingSpinner size="lg" /></div>;
  }

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage all platform users, invite Operations members, and monitor MFA status.
        </p>
      </div>

      {/* Stats cards */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">Total Users</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">{users.length}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">MFA Enabled</p>
          <p className="mt-1 text-3xl font-bold text-emerald-600">{mfaEnabled}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">MFA Disabled</p>
          <p className="mt-1 text-3xl font-bold text-amber-500">{users.length - mfaEnabled}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">Operations Members</p>
          <p className="mt-1 text-3xl font-bold text-blue-600">{opsCount}</p>
        </div>
      </div>

      {/* Tab bar + Add button */}
      <div className="mb-4 flex items-center justify-between">
        {/* Tabs */}
        <div className="flex gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1">
          {TABS.map((tab) => {
            const count = countByTab(tab);
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                  activeTab === tab.key
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  activeTab === tab.key
                    ? 'bg-primary/10 text-primary'
                    : 'bg-gray-200 text-gray-500'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Add button — only on Operations tab */}
        {activeTab === 'operations' && (
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Add Operations Member
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-gray-200 py-2.5 pl-9 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              <th className="px-5 py-3">User</th>
              <th className="px-5 py-3">Role</th>
              <th className="px-5 py-3">Account</th>
              <th className="px-5 py-3">MFA</th>
              <th className="px-5 py-3">Last Login</th>
              <th className="px-5 py-3">Invitation</th>
              <th className="px-5 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((user) => {
              const canResend =
                user.invitation_status === 'PENDING' ||
                user.invitation_status === 'EXPIRED';
              return (
                <tr key={user.id} className="hover:bg-gray-50/70 transition-colors">
                  {/* User */}
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-gray-900">{user.first_name} {user.last_name}</p>
                    <p className="text-xs text-gray-400">{user.email}</p>
                  </td>

                  {/* Role */}
                  <td className="px-5 py-3.5">
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {user.role.replace(/_/g, ' ')}
                    </span>
                  </td>

                  {/* Account status */}
                  <td className="px-5 py-3.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      user.is_active
                        ? 'bg-green-100 text-green-700'
                        : 'bg-red-100 text-red-700'
                    }`}>
                      {user.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>

                  {/* MFA */}
                  <td className="px-5 py-3.5">
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
                          <ShieldOff className="h-4 w-4 text-gray-300" />
                          <span className="text-xs text-gray-400">Off</span>
                        </>
                      )}
                    </div>
                  </td>

                  {/* Last login */}
                  <td className="px-5 py-3.5 text-xs text-gray-500">
                    {user.last_login_at
                      ? formatDistanceToNow(new Date(user.last_login_at), { addSuffix: true })
                      : <span className="text-gray-300">Never</span>}
                  </td>

                  {/* Invitation status */}
                  <td className="px-5 py-3.5">
                    <InvitationBadge user={user} />
                  </td>

                  {/* Actions */}
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      {/* Reset MFA */}
                      {user.mfa_enabled && (
                        <button
                          onClick={() => handleResetMfa(user)}
                          disabled={resettingMfa === user.id}
                          title="Reset MFA"
                          className="flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {resettingMfa === user.id ? '…' : 'Reset MFA'}
                        </button>
                      )}

                      {/* Resend invitation */}
                      {canResend && (
                        <button
                          onClick={() => handleResendInvitation(user)}
                          disabled={resending === user.id}
                          title="Resend invitation email"
                          className="flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                        >
                          <Send className="h-3.5 w-3.5" />
                          {resending === user.id ? '…' : 'Resend'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}

            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-sm text-gray-400">
                  No users match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Operations Modal */}
      {showModal && (
        <AddOperationsModal
          onClose={() => setShowModal(false)}
          onSuccess={handleModalSuccess}
        />
      )}

      {/* Toast */}
      {toast && (
        <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
      )}
    </div>
  );
}
