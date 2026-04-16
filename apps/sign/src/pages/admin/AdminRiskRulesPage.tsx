import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { riskRuleService, type RiskRule, type CreateRiskRulePayload, type RiskRuleSeverity } from '@/services/api/riskRuleService';
import LoadingSpinner from '@/components/common/LoadingSpinner';

const SEVERITY_STYLES: Record<RiskRuleSeverity, string> = {
  LOW: 'bg-blue-100 text-blue-700',
  MEDIUM: 'bg-yellow-100 text-yellow-700',
  HIGH: 'bg-red-100 text-red-700',
};

const CONTRACT_TYPES = [
  'FIDIC_RED_BOOK_1999', 'FIDIC_RED_BOOK_2017', 'FIDIC_YELLOW_BOOK_2017',
  'FIDIC_SILVER_BOOK_2017', 'FIDIC_EPC_2017', 'NEC4_ECC',
  'JCT_DB_2016', 'JCT_SBC_2016', 'ADHOC', 'UPLOADED',
];

const EMPTY_FORM: CreateRiskRulePayload = {
  name: '',
  description: '',
  risk_category: '',
  severity: 'MEDIUM',
  detection_keywords: [],
  applicable_contract_types: [],
  recommendation_template: '',
};

export default function AdminRiskRulesPage() {
  const [rules, setRules] = useState<RiskRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateRiskRulePayload>(EMPTY_FORM);
  const [keywordInput, setKeywordInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    riskRuleService.getAll(!showInactive).then(data => {
      setRules(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, [showInactive]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setKeywordInput('');
    setError('');
    setShowForm(true);
  };

  const openEdit = (rule: RiskRule) => {
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      description: rule.description ?? '',
      risk_category: rule.risk_category,
      severity: rule.severity,
      detection_keywords: rule.detection_keywords ?? [],
      applicable_contract_types: rule.applicable_contract_types ?? [],
      recommendation_template: rule.recommendation_template ?? '',
    });
    setKeywordInput('');
    setError('');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.risk_category.trim()) {
      setError('Name and Risk Category are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (editingId) {
        await riskRuleService.update(editingId, form);
      } else {
        await riskRuleService.create(form);
      }
      setShowForm(false);
      load();
    } catch {
      setError('Failed to save. Check your input and try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!window.confirm('Deactivate this rule? It will be hidden from risk analysis.')) return;
    await riskRuleService.delete(id);
    load();
  };

  const addKeyword = () => {
    const kw = keywordInput.trim();
    if (kw && !form.detection_keywords?.includes(kw)) {
      setForm(f => ({ ...f, detection_keywords: [...(f.detection_keywords ?? []), kw] }));
    }
    setKeywordInput('');
  };

  const removeKeyword = (kw: string) => {
    setForm(f => ({ ...f, detection_keywords: (f.detection_keywords ?? []).filter(k => k !== kw) }));
  };

  const toggleContractType = (ct: string) => {
    const current = form.applicable_contract_types ?? [];
    setForm(f => ({
      ...f,
      applicable_contract_types: current.includes(ct)
        ? current.filter(c => c !== ct)
        : [...current, ct],
    }));
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Risk Rules</h1>
          <p className="mt-1 text-sm text-gray-500">
            Configure detection keywords and risk categories used in AI contract analysis.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
              className="rounded border-gray-300"
            />
            Show inactive
          </label>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            New Rule
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        {(['HIGH', 'MEDIUM', 'LOW'] as RiskRuleSeverity[]).map(sev => {
          const count = rules.filter(r => r.severity === sev && r.is_active).length;
          return (
            <div key={sev} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-gray-500">{sev} Severity</p>
              <p className={`mt-1 text-2xl font-bold ${sev === 'HIGH' ? 'text-red-600' : sev === 'MEDIUM' ? 'text-yellow-600' : 'text-blue-600'}`}>{count}</p>
            </div>
          );
        })}
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center"><LoadingSpinner size="lg" /></div>
      ) : rules.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">No risk rules yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map(rule => (
            <div key={rule.id} className={`rounded-xl border bg-white shadow-sm ${!rule.is_active ? 'opacity-50' : ''}`}>
              <div
                className="flex cursor-pointer items-center justify-between px-5 py-4"
                onClick={() => setExpandedId(expandedId === rule.id ? null : rule.id)}
              >
                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SEVERITY_STYLES[rule.severity]}`}>
                    {rule.severity}
                  </span>
                  <span className="font-medium text-gray-900">{rule.name}</span>
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{rule.risk_category}</span>
                  {!rule.is_active && <span className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-400">Inactive</span>}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={e => { e.stopPropagation(); openEdit(rule); }}
                    className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {rule.is_active && (
                    <button
                      onClick={e => { e.stopPropagation(); handleDeactivate(rule.id); }}
                      className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {expandedId === rule.id ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                </div>
              </div>
              {expandedId === rule.id && (
                <div className="border-t border-gray-100 px-5 py-4 text-sm text-gray-600 space-y-2">
                  {rule.description && <p>{rule.description}</p>}
                  {rule.detection_keywords?.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      <span className="font-medium text-gray-500">Keywords:</span>
                      {rule.detection_keywords.map(kw => (
                        <span key={kw} className="rounded bg-gray-100 px-2 py-0.5 text-xs">{kw}</span>
                      ))}
                    </div>
                  ) : null}
                  {rule.recommendation_template && (
                    <p className="text-gray-500 italic">{rule.recommendation_template}</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              {editingId ? 'Edit Risk Rule' : 'New Risk Rule'}
            </h2>

            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Name *</label>
                  <input
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Uncapped Liability Clause"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Risk Category *</label>
                  <input
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    value={form.risk_category}
                    onChange={e => setForm(f => ({ ...f, risk_category: e.target.value }))}
                    placeholder="e.g. Liability"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Severity *</label>
                  <select
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    value={form.severity}
                    onChange={e => setForm(f => ({ ...f, severity: e.target.value as RiskRuleSeverity }))}
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
                  <textarea
                    rows={2}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Detection Keywords</label>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      value={keywordInput}
                      onChange={e => setKeywordInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); }}}
                      placeholder="Type keyword and press Enter"
                    />
                    <button
                      type="button"
                      onClick={addKeyword}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      Add
                    </button>
                  </div>
                  {form.detection_keywords && form.detection_keywords.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {form.detection_keywords.map(kw => (
                        <span
                          key={kw}
                          className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs cursor-pointer hover:bg-red-50 hover:text-red-600"
                          onClick={() => removeKeyword(kw)}
                        >
                          {kw} ×
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Applicable Contract Types</label>
                  <div className="flex flex-wrap gap-2">
                    {CONTRACT_TYPES.map(ct => (
                      <button
                        key={ct}
                        type="button"
                        onClick={() => toggleContractType(ct)}
                        className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                          form.applicable_contract_types?.includes(ct)
                            ? 'border-primary bg-primary text-white'
                            : 'border-gray-200 text-gray-500 hover:border-gray-400'
                        }`}
                      >
                        {ct}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Recommendation Template</label>
                  <textarea
                    rows={2}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    value={form.recommendation_template}
                    onChange={e => setForm(f => ({ ...f, recommendation_template: e.target.value }))}
                    placeholder="Guidance shown to users when this risk is detected"
                  />
                </div>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
              >
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
