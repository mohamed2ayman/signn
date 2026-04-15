import { useState, useEffect } from 'react';
import { ShieldCheck, Plus, Pencil, Check, X } from 'lucide-react';
import { adminService } from '@/services/api/adminService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import Button from '@/components/common/Button';
import type { SubscriptionPlan } from '@/types';

interface EditState {
  planId: string;
  require_mfa: boolean;
}

export default function AdminSubscriptionsPage() {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Create plan form
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    price: '',
    currency: 'USD',
    duration_days: '365',
    max_projects: '10',
    max_users: '20',
    max_contracts_per_project: '50',
    require_mfa: false,
    is_active: true,
  });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    adminService
      .getPlans()
      .then(setPlans)
      .catch(() => setErrorMsg('Failed to load plans'))
      .finally(() => setLoading(false));
  }, []);

  const handleToggleRequireMfa = (plan: SubscriptionPlan) => {
    setEditState({ planId: plan.id, require_mfa: !plan.require_mfa });
  };

  const handleSaveRequireMfa = async () => {
    if (!editState) return;
    setSaving(true);
    setSuccessMsg('');
    setErrorMsg('');
    try {
      const updated = await adminService.updatePlan(editState.planId, {
        require_mfa: editState.require_mfa,
      });
      setPlans((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p)),
      );
      setSuccessMsg(
        `MFA requirement ${editState.require_mfa ? 'enabled' : 'disabled'} for plan`,
      );
      setEditState(null);
    } catch {
      setErrorMsg('Failed to update plan');
    } finally {
      setSaving(false);
    }
  };

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setSuccessMsg('');
    setErrorMsg('');
    try {
      const newPlan = await adminService.createPlan({
        name: createForm.name,
        description: createForm.description || undefined,
        price: parseFloat(createForm.price),
        currency: createForm.currency,
        duration_days: parseInt(createForm.duration_days),
        max_projects: parseInt(createForm.max_projects),
        max_users: parseInt(createForm.max_users),
        max_contracts_per_project: parseInt(createForm.max_contracts_per_project),
        require_mfa: createForm.require_mfa,
        is_active: createForm.is_active,
      });
      setPlans((prev) => [newPlan, ...prev]);
      setShowCreate(false);
      setCreateForm({
        name: '', description: '', price: '', currency: 'USD',
        duration_days: '365', max_projects: '10', max_users: '20',
        max_contracts_per_project: '50', require_mfa: false, is_active: true,
      });
      setSuccessMsg('Plan created successfully');
    } catch {
      setErrorMsg('Failed to create plan');
    } finally {
      setCreating(false);
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
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Subscription Plans</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage subscription plans and MFA enforcement policies.
          </p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)}>
          <Plus className="mr-1.5 h-4 w-4" />
          New Plan
        </Button>
      </div>

      {successMsg && (
        <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{successMsg}</div>
      )}
      {errorMsg && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{errorMsg}</div>
      )}

      {/* Create Form */}
      {showCreate && (
        <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Create New Plan</h2>
          <form onSubmit={handleCreatePlan} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Name *</label>
                <input
                  required
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Price *</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  value={createForm.price}
                  onChange={(e) => setCreateForm({ ...createForm, price: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Duration (days)</label>
                <input
                  type="number"
                  value={createForm.duration_days}
                  onChange={(e) => setCreateForm({ ...createForm, duration_days: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Max Users</label>
                <input
                  type="number"
                  value={createForm.max_users}
                  onChange={(e) => setCreateForm({ ...createForm, max_users: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
              <textarea
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="flex items-center gap-6">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={createForm.require_mfa}
                  onChange={(e) => setCreateForm({ ...createForm, require_mfa: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-primary"
                />
                <ShieldCheck className="h-4 w-4 text-primary" />
                Require MFA for all users
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={createForm.is_active}
                  onChange={(e) => setCreateForm({ ...createForm, is_active: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-primary"
                />
                Active
              </label>
            </div>
            <div className="flex gap-3">
              <Button type="submit" isLoading={creating}>Create Plan</Button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Plans Table */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              <th className="px-6 py-3">Plan</th>
              <th className="px-6 py-3">Price</th>
              <th className="px-6 py-3">Limits</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Require MFA</th>
              <th className="px-6 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {plans.map((plan) => {
              const isEditing = editState?.planId === plan.id;
              const currentRequireMfa = isEditing ? editState.require_mfa : plan.require_mfa;

              return (
                <tr key={plan.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <p className="font-medium text-gray-900">{plan.name}</p>
                    {plan.description && (
                      <p className="text-xs text-gray-400">{plan.description}</p>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700">
                    {plan.currency} {Number(plan.price).toLocaleString()}
                    <span className="ml-1 text-xs text-gray-400">/ {plan.duration_days}d</span>
                  </td>
                  <td className="px-6 py-4 text-xs text-gray-500">
                    <div>{plan.max_projects} projects</div>
                    <div>{plan.max_users} users</div>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        plan.is_active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {plan.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => handleToggleRequireMfa(plan)}
                      disabled={saving && isEditing}
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        currentRequireMfa
                          ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {currentRequireMfa ? 'Required' : 'Optional'}
                    </button>
                  </td>
                  <td className="px-6 py-4">
                    {isEditing && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleSaveRequireMfa}
                          disabled={saving}
                          className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                        >
                          <Check className="h-3.5 w-3.5" />
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          onClick={() => setEditState(null)}
                          className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
                        >
                          <X className="h-3.5 w-3.5" />
                          Cancel
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {plans.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-sm text-gray-400">
                  No plans found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
