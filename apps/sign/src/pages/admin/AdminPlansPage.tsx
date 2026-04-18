import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus,
  Pencil,
  LayoutGrid,
  ShieldCheck,
  X,
  Clock,
  BarChart2,
  Users,
  FileText,
} from 'lucide-react';
import { adminService } from '@/services/api/adminService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import Button from '@/components/common/Button';
import type { SubscriptionPlan } from '@/types';

export const PLATFORM_FEATURES = [
  { key: 'claims_management', label: 'Claims Management' },
  { key: 'notices_management', label: 'Notices Management' },
  { key: 'subcontracting', label: 'Subcontracting' },
  { key: 'ai_document_processing', label: 'AI Document Processing' },
  { key: 'version_control', label: 'Version Control' },
  { key: 'clause_library', label: 'Clause Library' },
  { key: 'knowledge_assets', label: 'Knowledge Assets' },
  { key: 'obligations_tracking', label: 'Obligations Tracking' },
  { key: 'contract_store', label: 'Contract Store' },
  { key: 'advanced_permissions', label: 'Advanced Permissions' },
  { key: 'team_management', label: 'Team Management' },
  { key: 'mfa_support', label: 'MFA Support' },
  { key: 'api_access', label: 'API Access' },
  { key: 'priority_support', label: 'Priority Support' },
  { key: 'custom_branding', label: 'Custom Branding' },
  { key: 'analytics', label: 'Advanced Analytics' },
];

type ModalMode = 'create' | 'edit';

interface PlanForm {
  name: string;
  description: string;
  price: string;
  currency: string;
  duration_days: string;
  max_projects: string;
  max_users: string;
  max_contracts_per_project: string;
  require_mfa: boolean;
  is_active: boolean;
  features: Record<string, boolean>;
}

const DEFAULT_FORM: PlanForm = {
  name: '',
  description: '',
  price: '',
  currency: 'USD',
  duration_days: '365',
  max_projects: '10',
  max_users: '20',
  max_contracts_per_project: '50',
  // Platform-wide policy: MFA is required on all plans and is enforced
  // server-side. UI shows this as a locked row — never user-toggleable.
  require_mfa: true,
  is_active: true,
  features: {},
};

function planToForm(plan: SubscriptionPlan): PlanForm {
  return {
    name: plan.name,
    description: plan.description || '',
    price: String(plan.price),
    currency: plan.currency,
    duration_days: String(plan.duration_days),
    max_projects: String(plan.max_projects),
    max_users: String(plan.max_users),
    max_contracts_per_project: String(plan.max_contracts_per_project),
    require_mfa: plan.require_mfa,
    is_active: plan.is_active,
    features: plan.features || {},
  };
}

export default function AdminPlansPage() {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>('create');
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [form, setForm] = useState<PlanForm>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    adminService
      .getPlans()
      .then(setPlans)
      .catch(() => showToast('error', 'Failed to load plans'))
      .finally(() => setLoading(false));
  }, []);

  const openCreate = () => {
    setForm(DEFAULT_FORM);
    setModalMode('create');
    setEditingPlanId(null);
    setShowModal(true);
  };

  const openEdit = (plan: SubscriptionPlan) => {
    setForm(planToForm(plan));
    setModalMode('edit');
    setEditingPlanId(plan.id);
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      name: form.name,
      description: form.description || undefined,
      price: parseFloat(form.price),
      currency: form.currency,
      duration_days: parseInt(form.duration_days),
      max_projects: parseInt(form.max_projects),
      max_users: parseInt(form.max_users),
      max_contracts_per_project: parseInt(form.max_contracts_per_project),
      require_mfa: form.require_mfa,
      is_active: form.is_active,
      features: form.features,
    };
    try {
      if (modalMode === 'create') {
        const created = await adminService.createPlan(payload);
        setPlans((prev) => [created, ...prev]);
        showToast('success', 'Plan created successfully');
      } else if (editingPlanId) {
        const updated = await adminService.updatePlan(editingPlanId, payload);
        setPlans((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        showToast('success', 'Plan updated successfully');
      }
      setShowModal(false);
    } catch {
      showToast('error', `Failed to ${modalMode === 'create' ? 'create' : 'update'} plan`);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (plan: SubscriptionPlan) => {
    setTogglingId(plan.id);
    try {
      const updated = await adminService.updatePlan(plan.id, { is_active: !plan.is_active });
      setPlans((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      showToast('success', `Plan ${updated.is_active ? 'activated' : 'deactivated'}`);
    } catch {
      showToast('error', 'Failed to update plan status');
    } finally {
      setTogglingId(null);
    }
  };

  const toggleFeature = (key: string) => {
    setForm((f) => ({
      ...f,
      features: { ...f.features, [key]: !f.features[key] },
    }));
  };

  const featuresCount = (plan: SubscriptionPlan) =>
    Object.values(plan.features || {}).filter(Boolean).length;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const selectedCount = Object.values(form.features).filter(Boolean).length;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Subscription Plans</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage plans, pricing, limits, and feature access.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/admin/plans/compare"
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            <LayoutGrid className="h-4 w-4" />
            Compare Plans
          </Link>
          <Button onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" />
            New Plan
          </Button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`mb-4 rounded-lg p-3 text-sm ${
            toast.type === 'success'
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-red-50 text-red-600'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Stats */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Total Plans</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{plans.length}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Active</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600">
            {plans.filter((p) => p.is_active).length}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Inactive</p>
          <p className="mt-1 text-2xl font-bold text-gray-400">
            {plans.filter((p) => !p.is_active).length}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              <th className="px-6 py-3">Plan</th>
              <th className="px-6 py-3">Price</th>
              <th className="px-6 py-3">Duration</th>
              <th className="px-6 py-3">Limits</th>
              <th className="px-6 py-3">Features</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">MFA</th>
              <th className="px-6 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {plans.map((plan) => (
              <tr key={plan.id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <p className="font-semibold text-gray-900">{plan.name}</p>
                  {plan.description && (
                    <p className="mt-0.5 max-w-[200px] truncate text-xs text-gray-400">
                      {plan.description}
                    </p>
                  )}
                </td>
                <td className="px-6 py-4 text-sm font-medium text-gray-700">
                  {plan.currency} {Number(plan.price).toLocaleString()}
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-1 text-sm text-gray-600">
                    <Clock className="h-3.5 w-3.5 text-gray-400" />
                    {plan.duration_days}d
                  </div>
                </td>
                <td className="px-6 py-4 text-xs text-gray-500">
                  <div className="flex items-center gap-1">
                    <BarChart2 className="h-3 w-3 text-gray-400" />
                    {plan.max_projects} projects
                  </div>
                  <div className="flex items-center gap-1">
                    <Users className="h-3 w-3 text-gray-400" />
                    {plan.max_users} users
                  </div>
                  <div className="flex items-center gap-1">
                    <FileText className="h-3 w-3 text-gray-400" />
                    {plan.max_contracts_per_project} contracts/proj
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                    {featuresCount(plan)} / {PLATFORM_FEATURES.length}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      plan.is_active
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {plan.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-6 py-4">
                  {plan.require_mfa ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-600">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Required
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">Optional</span>
                  )}
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEdit(plan)}
                      className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </button>
                    <button
                      onClick={() => handleToggleActive(plan)}
                      disabled={togglingId === plan.id}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                        plan.is_active
                          ? 'bg-red-50 text-red-600 hover:bg-red-100'
                          : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      }`}
                    >
                      {togglingId === plan.id
                        ? '…'
                        : plan.is_active
                          ? 'Deactivate'
                          : 'Activate'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {plans.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-12 text-center text-sm text-gray-400">
                  No plans found. Create your first plan.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-6 py-4">
              <h2 className="text-lg font-bold text-gray-900">
                {modalMode === 'create' ? 'Create New Plan' : 'Edit Plan'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-5 p-6">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Plan Name *
                  </label>
                  <input
                    required
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Professional"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Description
                  </label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    rows={2}
                    placeholder="Short description of this plan"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Price *</label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Currency</label>
                  <select
                    value={form.currency}
                    onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="USD">USD</option>
                    <option value="EGP">EGP</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="SAR">SAR</option>
                    <option value="AED">AED</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Duration (days) *
                  </label>
                  <input
                    required
                    type="number"
                    min="1"
                    value={form.duration_days}
                    onChange={(e) => setForm((f) => ({ ...f, duration_days: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Max Projects *
                  </label>
                  <input
                    required
                    type="number"
                    min="1"
                    value={form.max_projects}
                    onChange={(e) => setForm((f) => ({ ...f, max_projects: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Max Users *
                  </label>
                  <input
                    required
                    type="number"
                    min="1"
                    value={form.max_users}
                    onChange={(e) => setForm((f) => ({ ...f, max_users: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Max Contracts / Project *
                  </label>
                  <input
                    required
                    type="number"
                    min="1"
                    value={form.max_contracts_per_project}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, max_contracts_per_project: e.target.value }))
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              {/* Feature Matrix */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-semibold text-gray-700">Feature Access</label>
                  <span className="text-xs text-gray-400">
                    {selectedCount} of {PLATFORM_FEATURES.length} selected
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-gray-200 p-4">
                  {PLATFORM_FEATURES.map((feat) => (
                    <label
                      key={feat.key}
                      className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 hover:text-gray-900"
                    >
                      <input
                        type="checkbox"
                        checked={!!form.features[feat.key]}
                        onChange={() => toggleFeature(feat.key)}
                        className="h-4 w-4 rounded border-gray-300 accent-primary"
                      />
                      {feat.label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Toggles */}
              <div className="flex items-center gap-6">
                {/*
                  MFA toggle is intentionally read-only.
                  Platform-wide policy: MFA is required on ALL plans.
                  The field still exists in the DB/entity, but the UI
                  prevents it from being disabled.
                */}
                <div
                  className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"
                  aria-readonly="true"
                  title="Platform-wide policy — MFA is required on all plans and cannot be disabled."
                >
                  <svg
                    className="h-4 w-4 text-primary"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                  <span className="font-medium">MFA Required</span>
                  <span className="text-gray-500">— Enabled for all plans (platform policy)</span>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                    className="h-4 w-4 rounded border-gray-300 accent-primary"
                  />
                  Plan is active
                </label>
              </div>

              {/* Actions */}
              <div className="flex gap-3 border-t border-gray-100 pt-2">
                <Button type="submit" isLoading={saving}>
                  {modalMode === 'create' ? 'Create Plan' : 'Save Changes'}
                </Button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
