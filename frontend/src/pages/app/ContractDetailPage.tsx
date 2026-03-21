import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { contractService } from '@/services/api/contractService';
import { clauseService } from '@/services/api/clauseService';
import { riskAnalysisService } from '@/services/api/riskAnalysisService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import type { Contract, ContractClause, Clause, ContractComment, RiskAnalysis } from '@/types';

/* ── Status Badge ─────────────────────────────────────────────── */
const statusStyles: Record<string, { bg: string; text: string; dot: string }> = {
  DRAFT: { bg: 'bg-gray-50', text: 'text-gray-600', dot: 'bg-gray-400' },
  PENDING_APPROVAL: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400' },
  APPROVED: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  ACTIVE: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  COMPLETED: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  TERMINATED: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  CHANGES_REQUESTED: { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-400' },
  SENT_TO_CONTRACTOR: { bg: 'bg-purple-50', text: 'text-purple-700', dot: 'bg-purple-400' },
  CONTRACTOR_REVIEWING: { bg: 'bg-indigo-50', text: 'text-indigo-700', dot: 'bg-indigo-400' },
  PENDING_FINAL_APPROVAL: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400' },
  RISK_ESCALATION_PENDING: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  PENDING_TENDERING: { bg: 'bg-cyan-50', text: 'text-cyan-700', dot: 'bg-cyan-400' },
};

function StatusBadge({ status }: { status: string }) {
  const s = statusStyles[status] || statusStyles.DRAFT;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {status.replace(/_/g, ' ')}
    </span>
  );
}

/* ── Risk Level Badge ────────────────────────────────────────── */
const riskColors: Record<string, { bg: string; text: string; icon: string }> = {
  HIGH: { bg: 'bg-red-50', text: 'text-red-700', icon: 'text-red-500' },
  MEDIUM: { bg: 'bg-amber-50', text: 'text-amber-700', icon: 'text-amber-500' },
  LOW: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'text-emerald-500' },
};

function RiskLevelBadge({ level }: { level: string }) {
  const c = riskColors[level] || riskColors.LOW;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${c.bg} ${c.text}`}>
      <svg className={`h-3 w-3 ${c.icon}`} fill="currentColor" viewBox="0 0 24 24">
        {level === 'HIGH' ? (
          <path d="M12 2L1 21h22L12 2zm0 4l7.53 13H4.47L12 6zm-1 5v4h2v-4h-2zm0 6v2h2v-2h-2z" />
        ) : (
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 5h2v6h-2V7zm0 8h2v2h-2v-2z" />
        )}
      </svg>
      {level}
    </span>
  );
}

/* ── Tab Button ──────────────────────────────────────────────── */
const tabConfig = [
  { key: 'clauses' as const, label: 'Clauses', icon: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z' },
  { key: 'comments' as const, label: 'Comments', icon: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z' },
  { key: 'risks' as const, label: 'Risk Analysis', icon: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z' },
  { key: 'versions' as const, label: 'Versions', icon: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z' },
];

/* ── Main Component ──────────────────────────────────────────── */
export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [contract, setContract] = useState<Contract | null>(null);
  const [clauses, setClauses] = useState<ContractClause[]>([]);
  const [comments, setComments] = useState<ContractComment[]>([]);
  const [risks, setRisks] = useState<RiskAnalysis[]>([]);
  const [availableClauses, setAvailableClauses] = useState<Clause[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'clauses' | 'comments' | 'risks' | 'versions'>('clauses');
  const [showAddClause, setShowAddClause] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [selectedClauseId, setSelectedClauseId] = useState<string | null>(null);

  useEffect(() => {
    if (id) loadContract();
  }, [id]);

  const loadContract = async () => {
    if (!id) return;
    try {
      const [contractData, clauseData, commentData, riskData] = await Promise.all([
        contractService.getById(id),
        contractService.getClauses(id),
        contractService.getComments(id),
        riskAnalysisService.getByContract(id),
      ]);
      setContract(contractData);
      setClauses(clauseData);
      setComments(commentData);
      setRisks(riskData);
    } catch (err) {
      console.error('Failed to load contract:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddClause = async (clauseId: string) => {
    if (!id) return;
    try {
      await contractService.addClause(id, { clause_id: clauseId });
      const updatedClauses = await contractService.getClauses(id);
      setClauses(updatedClauses);
      setShowAddClause(false);
    } catch (err) {
      console.error('Failed to add clause:', err);
    }
  };

  const handleRemoveClause = async (contractClauseId: string) => {
    if (!id) return;
    try {
      await contractService.removeClause(id, contractClauseId);
      setClauses(clauses.filter((c) => c.id !== contractClauseId));
    } catch (err) {
      console.error('Failed to remove clause:', err);
    }
  };

  const handleAddComment = async () => {
    if (!id || !newComment.trim()) return;
    try {
      await contractService.addComment(id, {
        content: newComment,
        contract_clause_id: selectedClauseId || undefined,
      });
      const updatedComments = await contractService.getComments(id);
      setComments(updatedComments);
      setNewComment('');
    } catch (err) {
      console.error('Failed to add comment:', err);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!id) return;
    try {
      const updated = await contractService.updateStatus(id, newStatus);
      setContract(updated);
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  const loadAvailableClauses = async () => {
    try {
      const data = await clauseService.getAll();
      setAvailableClauses(data);
      setShowAddClause(true);
    } catch (err) {
      console.error('Failed to load clauses:', err);
    }
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><LoadingSpinner size="lg" /></div>;
  }

  if (!contract) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-gray-400">
        <svg className="mb-3 h-12 w-12" fill="none" stroke="currentColor" strokeWidth={1.2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        <p className="text-sm font-medium">Contract not found</p>
      </div>
    );
  }

  const clauseRisks = (clauseId: string) => risks.filter((r) => r.contract_clause_id === clauseId);
  const highRisks = risks.filter(r => r.risk_level === 'HIGH');
  const openRisks = risks.filter(r => r.status === 'OPEN');

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400">
        <button onClick={() => navigate('/app/projects')} className="transition-colors hover:text-primary">Projects</button>
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
        <button onClick={() => navigate(-1)} className="transition-colors hover:text-primary">Contract</button>
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
        <span className="font-medium text-gray-700 truncate max-w-[200px]">{contract.name}</span>
      </nav>

      {/* Contract Header */}
      <div className="rounded-xl border border-gray-200/80 bg-white p-6 shadow-card">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-navy-50">
              <svg className="h-6 w-6 text-navy-600" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold text-gray-900">{contract.name}</h1>
                <StatusBadge status={contract.status} />
              </div>
              <p className="mt-1 text-sm text-gray-400">
                {contract.contract_type.replace(/_/g, ' ')} · Version {contract.current_version}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {contract.status === 'DRAFT' && (
              <button
                onClick={() => handleStatusChange('PENDING_APPROVAL')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
                Submit for Approval
              </button>
            )}
            {contract.status === 'PENDING_APPROVAL' && (
              <button
                onClick={() => handleStatusChange('APPROVED')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                Approve
              </button>
            )}
          </div>
        </div>

        {/* AI Insights Bar */}
        {(highRisks.length > 0 || openRisks.length > 0) && (
          <div className="mt-5 flex items-center gap-4 rounded-lg border border-amber-100 bg-amber-50/50 px-4 py-3">
            <svg className="h-5 w-5 flex-shrink-0 text-amber-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
            </svg>
            <div className="flex-1 text-sm text-amber-800">
              <span className="font-semibold">AI Insight:</span>{' '}
              {highRisks.length > 0 && <span>{highRisks.length} high-risk {highRisks.length === 1 ? 'issue' : 'issues'} detected. </span>}
              {openRisks.length > 0 && <span>{openRisks.length} open {openRisks.length === 1 ? 'risk requires' : 'risks require'} attention.</span>}
            </div>
            <button
              onClick={() => setActiveTab('risks')}
              className="flex-shrink-0 text-sm font-medium text-amber-700 transition-colors hover:text-amber-900"
            >
              View risks &rarr;
            </button>
          </div>
        )}

        {/* Quick Stats */}
        <div className="mt-5 grid grid-cols-4 gap-4 border-t border-gray-100 pt-5">
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900">{clauses.length}</p>
            <p className="mt-0.5 text-xs text-gray-400">Clauses</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900">{comments.length}</p>
            <p className="mt-0.5 text-xs text-gray-400">Comments</p>
          </div>
          <div className="text-center">
            <p className={`text-2xl font-bold ${highRisks.length > 0 ? 'text-red-600' : 'text-gray-900'}`}>{risks.length}</p>
            <p className="mt-0.5 text-xs text-gray-400">Risks</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900">v{contract.current_version}</p>
            <p className="mt-0.5 text-xs text-gray-400">Version</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-1">
          {tabConfig.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-2 border-b-2 px-4 pb-3 pt-1 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
              </svg>
              {tab.label}
              {tab.key === 'clauses' && <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">{clauses.length}</span>}
              {tab.key === 'comments' && comments.length > 0 && <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">{comments.length}</span>}
              {tab.key === 'risks' && risks.length > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${highRisks.length > 0 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                  {risks.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Clauses Tab ──────────────────────────────────────────── */}
      {activeTab === 'clauses' && (
        <div className="space-y-4">
          {contract.status === 'DRAFT' && (
            <div className="flex justify-end">
              <button
                onClick={loadAvailableClauses}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add Clause
              </button>
            </div>
          )}

          {clauses.map((cc, index) => {
            const risks = clauseRisks(cc.id);
            return (
              <div key={cc.id} className="rounded-xl border border-gray-200/80 bg-white shadow-card transition-shadow hover:shadow-card-hover">
                {/* Clause Header */}
                <div className="flex items-start justify-between border-b border-gray-100 px-5 py-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/8 text-sm font-bold text-primary">
                      {cc.section_number || index + 1}
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">{cc.clause?.title}</h3>
                      {cc.clause?.clause_type && (
                        <span className="text-xs text-gray-400">{cc.clause.clause_type}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {risks.map((risk) => (
                      <RiskLevelBadge key={risk.id} level={risk.risk_level} />
                    ))}
                    {contract.status === 'DRAFT' && (
                      <button
                        onClick={() => handleRemoveClause(cc.id)}
                        className="rounded-lg p-1.5 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500"
                        title="Remove clause"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                {/* Clause Content */}
                <div className="px-5 py-4">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-600">
                    {cc.clause?.content}
                  </p>
                </div>

                {/* Inline Risk Insights */}
                {risks.length > 0 && (
                  <div className="border-t border-gray-100 bg-gray-50/70 px-5 py-3">
                    <div className="mb-2 flex items-center gap-1.5">
                      <svg className="h-3.5 w-3.5 text-amber-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                      </svg>
                      <span className="text-xs font-semibold text-gray-500">AI Risk Analysis</span>
                    </div>
                    <div className="space-y-2">
                      {risks.map((risk) => (
                        <div key={risk.id} className="flex items-start gap-2">
                          <RiskLevelBadge level={risk.risk_level} />
                          <p className="text-sm text-gray-600">{risk.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {clauses.length === 0 && (
            <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/50 px-6 py-14 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100">
                <svg className="h-6 w-6 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
                </svg>
              </div>
              <p className="mt-3 text-sm font-medium text-gray-500">No clauses added yet</p>
              <p className="mt-1 text-xs text-gray-400">Add clauses from your library to build this contract</p>
              {contract.status === 'DRAFT' && (
                <button
                  onClick={loadAvailableClauses}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add Clause
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Comments Tab ─────────────────────────────────────────── */}
      {activeTab === 'comments' && (
        <div className="space-y-4">
          {/* Comment Composer */}
          <div className="rounded-xl border border-gray-200/80 bg-white p-5 shadow-card">
            <label className="mb-2 block text-sm font-medium text-gray-700">Add a comment</label>
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Share your thoughts or feedback on this contract..."
              className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm transition-colors placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              rows={3}
            />
            <div className="mt-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {selectedClauseId && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary">
                    Linked to clause
                    <button onClick={() => setSelectedClauseId(null)} className="ml-1 hover:text-primary-700">&times;</button>
                  </span>
                )}
              </div>
              <button
                onClick={handleAddComment}
                disabled={!newComment.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
                Post
              </button>
            </div>
          </div>

          {/* Comments List */}
          {comments.map((comment) => (
            <div key={comment.id} className="rounded-xl border border-gray-200/80 bg-white p-5 shadow-card">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-100 text-xs font-semibold text-navy-600">
                    {comment.user?.first_name?.charAt(0)}{comment.user?.last_name?.charAt(0)}
                  </div>
                  <div>
                    <span className="text-sm font-semibold text-gray-900">
                      {comment.user?.first_name} {comment.user?.last_name}
                    </span>
                    <span className="ml-2 text-xs text-gray-400">
                      {new Date(comment.created_at).toLocaleString()}
                    </span>
                  </div>
                </div>
                {comment.is_resolved && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    Resolved
                  </span>
                )}
              </div>
              <p className="mt-3 text-sm leading-relaxed text-gray-600">{comment.content}</p>
              {comment.replies && comment.replies.length > 0 && (
                <div className="ml-10 mt-4 space-y-3 border-l-2 border-gray-100 pl-4">
                  {comment.replies.map((reply) => (
                    <div key={reply.id}>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-700">
                          {reply.user?.first_name} {reply.user?.last_name}
                        </span>
                        <span className="text-xs text-gray-400">
                          {new Date(reply.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-gray-500">{reply.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {comments.length === 0 && (
            <div className="py-10 text-center">
              <svg className="mx-auto h-10 w-10 text-gray-200" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
              </svg>
              <p className="mt-3 text-sm text-gray-400">No comments yet. Start the conversation above.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Risks Tab ────────────────────────────────────────────── */}
      {activeTab === 'risks' && (
        <div className="space-y-4">
          {/* Risk Summary Bar */}
          {risks.length > 0 && (
            <div className="grid grid-cols-3 gap-4">
              {['HIGH', 'MEDIUM', 'LOW'].map((level) => {
                const count = risks.filter(r => r.risk_level === level).length;
                const colors = riskColors[level];
                return (
                  <div key={level} className={`rounded-xl border px-4 py-3 ${colors.bg} border-transparent`}>
                    <p className={`text-2xl font-bold ${colors.text}`}>{count}</p>
                    <p className={`text-xs font-medium ${colors.text} opacity-70`}>{level} Risk</p>
                  </div>
                );
              })}
            </div>
          )}

          {risks.map((risk) => (
            <div key={risk.id} className="rounded-xl border border-gray-200/80 bg-white shadow-card transition-shadow hover:shadow-card-hover">
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3">
                  <RiskLevelBadge level={risk.risk_level} />
                  <span className="text-xs font-medium text-gray-400">{risk.risk_category}</span>
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  risk.status === 'OPEN' ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-500'
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${risk.status === 'OPEN' ? 'bg-amber-400' : 'bg-gray-300'}`} />
                  {risk.status}
                </span>
              </div>
              <div className="border-t border-gray-50 px-5 py-4">
                <p className="text-sm leading-relaxed text-gray-600">{risk.description}</p>
                {risk.recommendation && (
                  <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3">
                    <div className="mb-1 flex items-center gap-1.5">
                      <svg className="h-3.5 w-3.5 text-blue-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                      </svg>
                      <span className="text-xs font-semibold text-blue-700">AI Recommendation</span>
                    </div>
                    <p className="text-sm text-blue-600">{risk.recommendation}</p>
                  </div>
                )}
                {risk.citation_source && (
                  <p className="mt-2 text-xs text-gray-400">
                    <span className="font-medium">Source:</span> {risk.citation_source}
                  </p>
                )}
              </div>
            </div>
          ))}

          {risks.length === 0 && (
            <div className="py-10 text-center">
              <svg className="mx-auto h-10 w-10 text-emerald-200" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
              <p className="mt-3 text-sm font-medium text-gray-500">No risks identified</p>
              <p className="mt-1 text-xs text-gray-400">Risk analysis will appear here when clauses are analyzed</p>
            </div>
          )}
        </div>
      )}

      {/* ── Versions Tab ─────────────────────────────────────────── */}
      {activeTab === 'versions' && (
        <div className="rounded-xl border border-gray-200/80 bg-white p-8 text-center shadow-card">
          <svg className="mx-auto h-10 w-10 text-gray-200" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="mt-3 text-sm font-medium text-gray-500">Version History</p>
          <p className="mt-1 text-xs text-gray-400">Current version: v{contract.current_version}</p>
        </div>
      )}

      {/* ── Add Clause Modal ─────────────────────────────────────── */}
      {showAddClause && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/40 backdrop-blur-sm">
          <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-gray-200/50 bg-white shadow-elevated">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Add Clause</h2>
                <p className="mt-0.5 text-sm text-gray-400">Select a clause from your library</p>
              </div>
              <button
                onClick={() => setShowAddClause(false)}
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="divide-y divide-gray-50 px-6">
              {availableClauses.map((clause) => (
                <button
                  key={clause.id}
                  className="w-full py-4 text-left transition-colors hover:bg-gray-50/50"
                  onClick={() => handleAddClause(clause.id)}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">{clause.title}</h3>
                    {clause.clause_type && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">{clause.clause_type}</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-gray-500 line-clamp-2">{clause.content}</p>
                </button>
              ))}
              {availableClauses.length === 0 && (
                <div className="py-8 text-center text-sm text-gray-400">
                  No clauses available in the library
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
