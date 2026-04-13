import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { contractService } from '@/services/api/contractService';
import { clauseService } from '@/services/api/clauseService';
import { riskAnalysisService } from '@/services/api/riskAnalysisService';
import { exportService } from '@/services/api/exportService';
import { contractSharingService } from '@/services/api/contractSharingService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import ChatPanel from '@/components/chat/ChatPanel';
import { useCollaboration } from '@/hooks/useCollaboration';
import type { Contract, ContractClause, Clause, ContractComment, RiskAnalysis, ContractShare, SignatureSigner, ConflictDetail, ContractVersion } from '@/types';
import VersionTimeline from '@/components/versions/VersionTimeline';
import DiffViewerModal from '@/components/versions/DiffViewerModal';
import VersionSnapshotModal from '@/components/versions/VersionSnapshotModal';
import ClaimsTab from '@/components/claims/ClaimsTab';
import NoticesTab from '@/components/notices/NoticesTab';
import SubContractsTab from '@/components/subcontracts/SubContractsTab';

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

/* ── Conflict Type Labels ────────────────────────────────────── */
const conflictTypeLabels: Record<string, string> = {
  deadline_conflict: 'Deadline Conflict',
  value_conflict: 'Value Conflict',
  scope_conflict: 'Scope Conflict',
  obligation_conflict: 'Obligation Conflict',
};

function parseConflictDetail(risk: RiskAnalysis): ConflictDetail | null {
  if (risk.risk_category !== 'DOCUMENT_CONFLICT' || !risk.citation_excerpt) return null;
  try {
    return JSON.parse(risk.citation_excerpt) as ConflictDetail;
  } catch {
    return null;
  }
}

/* ── Document Conflict Card ─────────────────────────────────── */
function DocumentConflictCard({
  risk,
  conflict,
  onAcceptGoverning,
  onOverride,
}: {
  risk: RiskAnalysis;
  conflict: ConflictDetail;
  onAcceptGoverning: (riskId: string) => void;
  onOverride: (riskId: string) => void;
}) {
  const typeLabel = conflictTypeLabels[conflict.type] || conflict.type.replace(/_/g, ' ');

  return (
    <div className="rounded-xl border-2 border-amber-200 bg-white shadow-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between bg-amber-50 px-5 py-3">
        <div className="flex items-center gap-2">
          <svg className="h-5 w-5 text-amber-500" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2L1 21h22L12 2zm0 4l7.53 13H4.47L12 6zm-1 5v4h2v-4h-2zm0 6v2h2v-2h-2z" />
          </svg>
          <span className="text-sm font-bold text-amber-800">Document Conflict</span>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            {typeLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <RiskLevelBadge level={risk.risk_level} />
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            risk.status === 'OPEN' ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-500'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${risk.status === 'OPEN' ? 'bg-amber-400' : 'bg-gray-300'}`} />
            {risk.status}
          </span>
        </div>
      </div>

      {/* Description */}
      <div className="border-b border-gray-100 px-5 py-3">
        <p className="text-sm leading-relaxed text-gray-700">{risk.description}</p>
      </div>

      {/* Document Comparison */}
      <div className="grid grid-cols-2 divide-x divide-gray-100">
        {/* Document A — Higher Priority (Governing) */}
        <div className="px-5 py-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
              GOVERNING
            </span>
            <span className="text-xs text-gray-400">Priority {conflict.document_a.priority}</span>
          </div>
          <p className="text-sm font-semibold text-gray-800">{conflict.document_a.label}</p>
          <div className="mt-2 rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
            <p className="text-sm leading-relaxed text-gray-600">{conflict.document_a.clause_text}</p>
          </div>
        </div>

        {/* Document B — Lower Priority (Overridden) */}
        <div className="px-5 py-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500">
              OVERRIDDEN
            </span>
            <span className="text-xs text-gray-400">Priority {conflict.document_b.priority}</span>
          </div>
          <p className="text-sm font-semibold text-gray-800">{conflict.document_b.label}</p>
          <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50/40 p-3">
            <p className="text-sm leading-relaxed text-gray-400 line-through">{conflict.document_b.clause_text}</p>
          </div>
        </div>
      </div>

      {/* Values */}
      <div className="grid grid-cols-2 gap-3 border-t border-gray-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">
            {conflict.governing_value}
          </span>
          <span className="text-xs text-gray-400">Selected value</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-400 line-through">
            {conflict.overridden_value}
          </span>
          <span className="text-xs text-gray-400">Overridden value</span>
        </div>
      </div>

      {/* Governing Reason */}
      <div className="border-t border-gray-100 px-5 py-3">
        <p className="text-xs text-gray-500">
          <span className="font-semibold text-gray-600">Why this value governs: </span>
          {conflict.governing_reason}
        </p>
      </div>

      {/* AI Suggestion */}
      {risk.recommendation && (
        <div className="border-t border-gray-100 px-5 py-3">
          <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
            <div className="mb-1 flex items-center gap-1.5">
              <svg className="h-3.5 w-3.5 text-blue-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
              </svg>
              <span className="text-xs font-semibold text-blue-700">AI Suggestion</span>
            </div>
            <p className="text-sm text-blue-600">{risk.recommendation}</p>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {risk.status === 'OPEN' && (
        <div className="flex items-center gap-3 border-t border-gray-100 bg-gray-50/50 px-5 py-3">
          <button
            onClick={() => onAcceptGoverning(risk.id)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            Accept Governing Value
          </button>
          <button
            onClick={() => onOverride(risk.id)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
            </svg>
            Override Decision
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Tab Button ──────────────────────────────────────────────── */
const tabConfig = [
  { key: 'clauses' as const, label: 'Clauses', icon: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z' },
  { key: 'comments' as const, label: 'Comments', icon: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z' },
  { key: 'risks' as const, label: 'Risk Analysis', icon: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z' },
  { key: 'claims' as const, label: 'Claims', icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z', activeOnly: true },
  { key: 'notices' as const, label: 'Notices', icon: 'M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0', activeOnly: true },
  { key: 'subcontracts' as const, label: 'Sub-Contracts', icon: 'M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z', activeOnly: true },
  { key: 'history' as const, label: 'History', icon: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z' },
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
  const [activeTab, setActiveTab] = useState<'clauses' | 'comments' | 'risks' | 'claims' | 'notices' | 'subcontracts' | 'history'>('clauses');
  const [diffPair, setDiffPair] = useState<{ a: string; b: string } | null>(null);
  const [snapshotVersion, setSnapshotVersion] = useState<ContractVersion | null>(null);
  const [showAddClause, setShowAddClause] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [selectedClauseId, setSelectedClauseId] = useState<string | null>(null);

  // Export & Share state
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [sharePermission, setSharePermission] = useState('view');
  const [shareExpiry, setShareExpiry] = useState('7');
  const [shares, setShares] = useState<ContractShare[]>([]);
  const [loadingShares, setLoadingShares] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [shareSuccess, setShareSuccess] = useState('');
  const [chatOpen, setChatOpen] = useState(false);

  // Signature state
  const [showSignModal, setShowSignModal] = useState(false);
  const [signSigners, setSignSigners] = useState([{ email: '', name: '' }]);
  const [signingLoading, setSigningLoading] = useState(false);
  const [signatureSigners, setSignatureSigners] = useState<SignatureSigner[]>([]);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Party names editing state
  const [editingParties, setEditingParties] = useState(false);
  const [partyFirstDraft, setPartyFirstDraft] = useState('');
  const [partySecondDraft, setPartySecondDraft] = useState('');
  const [savingParties, setSavingParties] = useState(false);

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

  // ── Real-time collaboration ──
  const reloadClauses = useCallback(() => {
    if (id) contractService.getClauses(id).then(setClauses).catch(() => {});
  }, [id]);

  const reloadComments = useCallback(() => {
    if (id) contractService.getComments(id).then(setComments).catch(() => {});
  }, [id]);

  const reloadRisks = useCallback(() => {
    if (id) riskAnalysisService.getByContract(id).then(setRisks).catch(() => {});
  }, [id]);

  const handleRealtimeStatusChange = useCallback(
    (_payload: { oldStatus: string; newStatus: string }) => {
      // Reload the full contract to get updated data
      if (id) contractService.getById(id).then(setContract).catch(() => {});
    },
    [id],
  );

  const { liveUsers, toasts, dismissToast } = useCollaboration({
    contractId: id,
    onClausesChanged: reloadClauses,
    onCommentsChanged: reloadComments,
    onStatusChanged: handleRealtimeStatusChange,
    onRisksChanged: reloadRisks,
  });

  const handleConflictAcceptGoverning = async (riskId: string) => {
    try {
      const updated = await riskAnalysisService.updateStatus(riskId, 'APPROVED');
      setRisks((prev) => prev.map((r) => (r.id === riskId ? { ...r, status: updated.status, handled_at: updated.handled_at } : r)));
    } catch (err) {
      console.error('Failed to accept governing value:', err);
    }
  };

  const handleConflictOverride = async (riskId: string) => {
    try {
      const updated = await riskAnalysisService.updateStatus(riskId, 'MANUAL_ADJUSTED');
      setRisks((prev) => prev.map((r) => (r.id === riskId ? { ...r, status: updated.status, handled_at: updated.handled_at } : r)));
    } catch (err) {
      console.error('Failed to override decision:', err);
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

  // Close export menu on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Export handlers
  const handleExport = async (type: 'pdf' | 'risk' | 'summary') => {
    if (!id) return;
    setExporting(type);
    try {
      if (type === 'pdf') await exportService.downloadContractPdf(id);
      else if (type === 'risk') await exportService.downloadRiskReport(id);
      else await exportService.downloadSummary(id, 'pdf');
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(null);
      setShowExportMenu(false);
    }
  };

  // Share handlers
  const loadShares = async () => {
    if (!id) return;
    setLoadingShares(true);
    try {
      const data = await contractSharingService.getSharesByContract(id);
      setShares(data);
    } catch (err) {
      console.error('Failed to load shares:', err);
    } finally {
      setLoadingShares(false);
    }
  };

  const handleShareContract = async () => {
    if (!id || !shareEmail.trim()) return;
    try {
      await contractSharingService.createShare({
        contract_id: id,
        shared_with_email: shareEmail.trim(),
        permission: sharePermission,
        expires_in_days: shareExpiry ? parseInt(shareExpiry) : undefined,
      });
      setShareEmail('');
      setShareSuccess('Share link sent successfully!');
      setTimeout(() => setShareSuccess(''), 3000);
      loadShares();
    } catch (err) {
      console.error('Failed to share:', err);
    }
  };

  const handleRevokeShare = async (shareId: string) => {
    try {
      await contractSharingService.revokeShare(shareId);
      setShares(shares.filter(s => s.id !== shareId));
    } catch (err) {
      console.error('Failed to revoke share:', err);
    }
  };

  const openShareModal = () => {
    setShowShareModal(true);
    loadShares();
  };

  // Signature handlers
  const loadSignatureStatus = async () => {
    if (!id) return;
    try {
      const data = await contractService.getSignatureStatus(id);
      setSignatureSigners(data.signers || []);
      // Refresh contract if status changed
      if (data.signature_status === 'FULLY_EXECUTED' && contract?.status !== 'ACTIVE') {
        const updated = await contractService.getById(id);
        setContract(updated);
      }
    } catch {
      // silently fail
    }
  };

  const handleInitiateSignature = async () => {
    if (!id) return;
    const validSigners = signSigners.filter(s => s.email.trim() && s.name.trim());
    if (validSigners.length === 0) return;

    setSigningLoading(true);
    try {
      const { signingUrl } = await contractService.initiateSignature(id, validSigners);
      setShowSignModal(false);
      // Refresh contract to show signature_status
      const updated = await contractService.getById(id);
      setContract(updated);
      loadSignatureStatus();
      // Open DocuSign signing in a new window
      if (signingUrl) {
        window.open(signingUrl, '_blank', 'width=1000,height=800');
      }
    } catch (err) {
      console.error('Failed to initiate signature:', err);
    } finally {
      setSigningLoading(false);
    }
  };

  // Load signature status when contract has an envelope
  useEffect(() => {
    if (contract?.docusign_envelope_id) {
      loadSignatureStatus();
    }
  }, [contract?.docusign_envelope_id]);

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
      {/* ── Toast Notifications ── */}
      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg backdrop-blur-sm transition-all animate-in slide-in-from-right ${
                toast.type === 'success'
                  ? 'bg-emerald-50/95 text-emerald-800 border border-emerald-200'
                  : toast.type === 'warning'
                  ? 'bg-amber-50/95 text-amber-800 border border-amber-200'
                  : 'bg-blue-50/95 text-blue-800 border border-blue-200'
              }`}
            >
              {toast.type === 'success' && (
                <svg className="h-4 w-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              )}
              {toast.type === 'warning' && (
                <svg className="h-4 w-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
              )}
              {toast.type === 'info' && (
                <svg className="h-4 w-4 text-blue-500 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
              )}
              <span>{toast.message}</span>
              <button
                onClick={() => dismissToast(toast.id)}
                className="ml-2 rounded p-0.5 hover:bg-black/5"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400">
        <button onClick={() => navigate('/app/projects')} className="transition-colors hover:text-primary">Projects</button>
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
        <button onClick={() => navigate(-1)} className="transition-colors hover:text-primary">Contract</button>
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
        <span className="font-medium text-gray-700 truncate max-w-[200px]">{contract.name}</span>
      </nav>

      {/* ── Live Collaboration Presence Bar ── */}
      {liveUsers.length > 1 && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2 text-sm">
          <div className="flex items-center gap-1 text-blue-600">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
            </span>
            <span className="font-medium">{liveUsers.length} collaborators online</span>
          </div>
          <div className="flex -space-x-2">
            {liveUsers.slice(0, 5).map((u) => (
              <div
                key={u.id}
                title={u.name || u.email}
                className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-primary text-[10px] font-bold text-white shadow-sm"
              >
                {(u.name || u.email).charAt(0).toUpperCase()}
              </div>
            ))}
            {liveUsers.length > 5 && (
              <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-gray-200 text-[10px] font-bold text-gray-600 shadow-sm">
                +{liveUsers.length - 5}
              </div>
            )}
          </div>
          <div className="ml-1 flex flex-wrap gap-1 text-xs text-gray-500">
            {liveUsers.slice(0, 3).map((u, i) => (
              <span key={u.id}>
                {u.name || u.email.split('@')[0]}
                {i < Math.min(liveUsers.length, 3) - 1 ? ',' : ''}
              </span>
            ))}
            {liveUsers.length > 3 && <span>and {liveUsers.length - 3} more</span>}
          </div>
        </div>
      )}

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
                <button
                  onClick={() => setActiveTab('history')}
                  className="text-xs text-blue-600 hover:underline"
                >
                  View History
                </button>
              </div>
              <p className="mt-1 text-sm text-gray-400">
                {contract.contract_type.replace(/_/g, ' ')} · Version {contract.current_version}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Share Button */}
            <button
              onClick={openShareModal}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
              </svg>
              Share
            </button>

            {/* AI Assistant Button */}
            <button
              onClick={() => setChatOpen(!chatOpen)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition ${
                chatOpen
                  ? 'bg-primary text-white shadow-sm hover:bg-primary-600'
                  : 'border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10'
              }`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
              </svg>
              AI Assistant
            </button>

            {/* Export Dropdown */}
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Export
                <svg className="h-3.5 w-3.5 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showExportMenu && (
                <div className="absolute right-0 z-20 mt-1.5 w-56 rounded-xl border border-gray-200 bg-white py-1.5 shadow-lg">
                  <button
                    onClick={() => handleExport('pdf')}
                    disabled={exporting === 'pdf'}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                  >
                    <svg className="h-4 w-4 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM6 20V4h7v5h5v11H6z" />
                    </svg>
                    {exporting === 'pdf' ? 'Exporting...' : 'Contract PDF'}
                  </button>
                  <button
                    onClick={() => handleExport('risk')}
                    disabled={exporting === 'risk'}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                  >
                    <svg className="h-4 w-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
                    </svg>
                    {exporting === 'risk' ? 'Exporting...' : 'Risk Analysis Report'}
                  </button>
                  <button
                    onClick={() => handleExport('summary')}
                    disabled={exporting === 'summary'}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                  >
                    <svg className="h-4 w-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
                    </svg>
                    {exporting === 'summary' ? 'Exporting...' : 'Summary Report'}
                  </button>
                </div>
              )}
            </div>

            {/* Status Actions */}
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
            {contract.status === 'APPROVED' && !contract.signature_status && (
              <button
                onClick={() => setShowSignModal(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                </svg>
                Send for Signature
              </button>
            )}
            {contract.signature_status && (
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                contract.signature_status === 'FULLY_EXECUTED'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-amber-50 text-amber-700'
              }`}>
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                </svg>
                {contract.signature_status === 'FULLY_EXECUTED' ? 'Fully Executed' : contract.signature_status === 'AWAITING_COUNTERPARTY' ? 'Awaiting Counterparty' : 'Pending Signature'}
              </span>
            )}
          </div>
        </div>

        {/* Signature Status Section */}
        {contract.signature_status && signatureSigners.length > 0 && (
          <div className="mt-5 rounded-lg border border-indigo-100 bg-indigo-50/30 px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
              <svg className="h-4 w-4 text-indigo-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
              <span className="text-sm font-semibold text-indigo-900">Signature Status</span>
              {contract.executed_at && (
                <span className="text-xs text-indigo-500">
                  Executed {new Date(contract.executed_at).toLocaleDateString()}
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {signatureSigners.map((signer, i) => (
                <div key={i} className="flex items-center gap-3 rounded-md bg-white px-3 py-2">
                  <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                    signer.status === 'completed' || signer.status === 'signed'
                      ? 'bg-emerald-500'
                      : 'bg-gray-300'
                  }`}>
                    {signer.status === 'completed' || signer.status === 'signed' ? (
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    ) : (
                      <span>{i + 1}</span>
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800">{signer.name}</p>
                    <p className="text-xs text-gray-400">{signer.email}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    signer.status === 'completed' || signer.status === 'signed'
                      ? 'bg-emerald-50 text-emerald-600'
                      : signer.status === 'sent' || signer.status === 'delivered'
                        ? 'bg-amber-50 text-amber-600'
                        : 'bg-gray-100 text-gray-500'
                  }`}>
                    {signer.status === 'completed' || signer.status === 'signed'
                      ? 'Signed'
                      : signer.status === 'sent'
                        ? 'Sent'
                        : signer.status === 'delivered'
                          ? 'Viewed'
                          : signer.status}
                  </span>
                  {signer.signed_at && (
                    <span className="text-[10px] text-gray-400">
                      {new Date(signer.signed_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

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

      {/* Contract Parties Card */}
      <div className="rounded-xl border border-gray-200/80 bg-white p-5 shadow-card">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-gray-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
            <h3 className="text-sm font-semibold text-gray-800">أطراف العقد</h3>
          </div>
          {!editingParties && (
            <button
              onClick={() => {
                setPartyFirstDraft(contract.party_first_name || '');
                setPartySecondDraft(contract.party_second_name || '');
                setEditingParties(true);
              }}
              className="text-xs font-medium text-primary hover:text-primary/80"
            >
              {contract.party_first_name || contract.party_second_name ? 'Edit' : 'Add Parties'}
            </button>
          )}
        </div>

        {editingParties ? (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">الطرف الأول</label>
              <input
                type="text"
                dir="auto"
                value={partyFirstDraft}
                onChange={(e) => setPartyFirstDraft(e.target.value)}
                placeholder="Enter first party name..."
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">الطرف الثاني</label>
              <input
                type="text"
                dir="auto"
                value={partySecondDraft}
                onChange={(e) => setPartySecondDraft(e.target.value)}
                placeholder="Enter second party name..."
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setEditingParties(false)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                disabled={savingParties}
                onClick={async () => {
                  if (!id) return;
                  setSavingParties(true);
                  try {
                    const updated = await contractService.updateParties(id, {
                      party_first_name: partyFirstDraft || null,
                      party_second_name: partySecondDraft || null,
                    });
                    setContract(updated);
                    setEditingParties(false);
                  } catch (err) {
                    console.error('Failed to save parties:', err);
                  } finally {
                    setSavingParties(false);
                  }
                }}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {savingParties ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        ) : contract.party_first_name || contract.party_second_name ? (
          <div className="space-y-2" dir="rtl">
            {contract.party_first_name && (
              <p className="text-sm text-gray-700">
                <strong className="text-gray-600">الطرف الأول:</strong> {contract.party_first_name}
              </p>
            )}
            {contract.party_second_name && (
              <p className="text-sm text-gray-700">
                <strong className="text-gray-600">الطرف الثاني:</strong> {contract.party_second_name}
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">
            No parties extracted yet. Click "Add Parties" to enter manually, or upload a contract agreement document.
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-1">
          {tabConfig.map((tab) => {
            const isActiveOnly = 'activeOnly' in tab && tab.activeOnly;
            const isContractActive = contract.status === 'ACTIVE';
            const disabled = isActiveOnly && !isContractActive;
            return (
              <button
                key={tab.key}
                onClick={() => !disabled && setActiveTab(tab.key)}
                title={disabled ? 'Available for Active contracts only' : undefined}
                className={`inline-flex items-center gap-2 border-b-2 px-4 pb-3 pt-1 text-sm font-medium transition-colors ${
                  disabled
                    ? 'border-transparent text-gray-300 cursor-not-allowed'
                    : activeTab === tab.key
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
            );
          })}
        </nav>
      </div>

      {/* ── Clauses Tab ──────────────────────────────────────────── */}
      {activeTab === 'clauses' && (
        <div className="space-y-4">
          {/* Standard form helper banner */}
          {contract.contract_type !== 'ADHOC' && contract.contract_type !== 'UPLOADED' && (
            <div className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50/70 px-4 py-3 text-sm">
              <div className="flex items-center gap-2">
                {(contract.contract_type as string).startsWith('FIDIC_') ? (
                  <span className="rounded bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-700">FIDIC</span>
                ) : (
                  <span className="rounded bg-teal-100 px-2 py-0.5 text-xs font-bold text-teal-700">NEC</span>
                )}
                <span className="text-gray-600">
                  {(contract.contract_type as string).startsWith('FIDIC_')
                    ? 'General Conditions populated from FIDIC standard form'
                    : 'Core Clauses populated from NEC standard form'}
                </span>
              </div>
              <div className="relative ml-auto group">
                <svg className="h-4 w-4 text-gray-400 cursor-help" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827m0 0v.75m0-2.577c0-.828.705-1.466 1.45-1.827.24-.116.467-.263.67-.442 1.172-1.025 1.172-2.687 0-3.712-1.171-1.025-3.071-1.025-4.242 0" /></svg>
                <div className="absolute bottom-full right-0 mb-2 hidden w-72 rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600 shadow-lg group-hover:block z-10">
                  Standard forms provide the internationally recognized clause structure. Customize using {(contract.contract_type as string).startsWith('FIDIC_') ? 'Particular Conditions' : 'Contract Data / Secondary Option Clauses'} without modifying the General Conditions.
                </div>
              </div>
            </div>
          )}

          {contract.status === 'DRAFT' && (
            <div className="flex justify-end gap-2">
              <button
                onClick={loadAvailableClauses}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                {contract.contract_type !== 'ADHOC' && contract.contract_type !== 'UPLOADED'
                  ? (contract.contract_type as string).startsWith('FIDIC_')
                    ? 'Add Particular Conditions'
                    : 'Add Contract Data / Secondary Option Clause'
                  : 'Add Clause'}
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
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-gray-900">{cc.clause?.title}</h3>
                        {(cc.customizations as any)?.source_organization === 'FIDIC' && (
                          <span className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-700">FIDIC</span>
                        )}
                        {(cc.customizations as any)?.source_organization === 'NEC' && (
                          <span className="shrink-0 rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-bold text-teal-700">NEC</span>
                        )}
                        {(cc.customizations as any)?.is_general_condition && (
                          <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">General</span>
                        )}
                      </div>
                      {cc.clause?.clause_type && !(cc.customizations as any)?.source_organization && (
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

          {/* Document Conflict Risks — special cards */}
          {risks.filter(r => r.risk_category === 'DOCUMENT_CONFLICT').length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 text-amber-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2L1 21h22L12 2zm0 4l7.53 13H4.47L12 6zm-1 5v4h2v-4h-2zm0 6v2h2v-2h-2z" />
                </svg>
                <h3 className="text-sm font-bold text-amber-800">
                  Document Conflicts ({risks.filter(r => r.risk_category === 'DOCUMENT_CONFLICT').length})
                </h3>
              </div>
              {risks
                .filter((r) => r.risk_category === 'DOCUMENT_CONFLICT')
                .map((risk) => {
                  const conflict = parseConflictDetail(risk);
                  if (!conflict) return null;
                  return (
                    <DocumentConflictCard
                      key={risk.id}
                      risk={risk}
                      conflict={conflict}
                      onAcceptGoverning={handleConflictAcceptGoverning}
                      onOverride={handleConflictOverride}
                    />
                  );
                })}
            </div>
          )}

          {/* Regular Risks — unchanged rendering */}
          {risks.filter(r => r.risk_category !== 'DOCUMENT_CONFLICT').map((risk) => (
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
                {risk.citation_source && risk.risk_category !== 'DOCUMENT_CONFLICT' && (
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

      {/* ── Claims Tab ───────────────────────────────────────────── */}
      {activeTab === 'claims' && contract.status === 'ACTIVE' && (
        <div className="rounded-xl border border-gray-200/80 bg-white p-6 shadow-card">
          <ClaimsTab contractId={contract.id} />
        </div>
      )}

      {/* ── Notices Tab ──────────────────────────────────────────── */}
      {activeTab === 'notices' && contract.status === 'ACTIVE' && (
        <div className="rounded-xl border border-gray-200/80 bg-white p-6 shadow-card">
          <NoticesTab contractId={contract.id} />
        </div>
      )}

      {/* ── Sub-Contracts Tab ────────────────────────────────────── */}
      {activeTab === 'subcontracts' && contract.status === 'ACTIVE' && (
        <div className="rounded-xl border border-gray-200/80 bg-white p-6 shadow-card">
          <SubContractsTab contractId={contract.id} contractName={contract.name} />
        </div>
      )}

      {/* ── History Tab ──────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="rounded-xl border border-gray-200/80 bg-white p-6 shadow-card">
          <VersionTimeline
            contractId={contract.id}
            onCompare={(a, b) => setDiffPair({ a, b })}
            onViewSnapshot={(v) => setSnapshotVersion(v)}
          />
        </div>
      )}

      {diffPair && (
        <DiffViewerModal
          contractId={contract.id}
          versionAId={diffPair.a}
          versionBId={diffPair.b}
          onClose={() => setDiffPair(null)}
        />
      )}

      {snapshotVersion && (
        <VersionSnapshotModal
          version={snapshotVersion}
          onClose={() => setSnapshotVersion(null)}
        />
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

      {/* ── Share Contract Modal ───────────────────────────────────── */}
      {showShareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/40 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-gray-200/50 bg-white shadow-elevated">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                  <svg className="h-5 w-5 text-primary" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Share Contract</h2>
                  <p className="text-sm text-gray-400">Send a secure link to collaborate</p>
                </div>
              </div>
              <button
                onClick={() => setShowShareModal(false)}
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Share Form */}
            <div className="px-6 py-5 space-y-4">
              {shareSuccess && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">
                  <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  {shareSuccess}
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Email address</label>
                <input
                  type="email"
                  value={shareEmail}
                  onChange={(e) => setShareEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm transition-colors placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Permission</label>
                  <select
                    value={sharePermission}
                    onChange={(e) => setSharePermission(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="view">View only</option>
                    <option value="comment">Can comment</option>
                    <option value="edit">Can edit</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Expires in</label>
                  <select
                    value={shareExpiry}
                    onChange={(e) => setShareExpiry(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="1">1 day</option>
                    <option value="7">7 days</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                    <option value="">Never</option>
                  </select>
                </div>
              </div>

              <button
                onClick={handleShareContract}
                disabled={!shareEmail.trim()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
                Send Share Link
              </button>
            </div>

            {/* Active Shares */}
            {shares.length > 0 && (
              <div className="border-t border-gray-100 px-6 py-4">
                <h3 className="mb-3 text-sm font-semibold text-gray-700">Active Shares</h3>
                <div className="space-y-2.5">
                  {shares.map((share) => (
                    <div key={share.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3.5 py-2.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {share.shared_with_email?.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-800">{share.shared_with_email}</p>
                          <div className="flex items-center gap-2 text-xs text-gray-400">
                            <span className="capitalize">{share.permission}</span>
                            {share.expires_at && (
                              <>
                                <span>&middot;</span>
                                <span>Expires {new Date(share.expires_at).toLocaleDateString()}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRevokeShare(share.id)}
                        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                        title="Revoke access"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {loadingShares && (
              <div className="border-t border-gray-100 px-6 py-4 text-center">
                <LoadingSpinner size="sm" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Send for Signature Modal */}
      {showSignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-gray-200/50 bg-white p-6 shadow-elevated">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Send for Signature</h2>
                <p className="mt-0.5 text-sm text-gray-400">Add signers who need to sign this contract</p>
              </div>
              <button onClick={() => setShowSignModal(false)} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-3">
              {signSigners.map((signer, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Full name"
                    value={signer.name}
                    onChange={(e) => {
                      const updated = [...signSigners];
                      updated[i] = { ...updated[i], name: e.target.value };
                      setSignSigners(updated);
                    }}
                    className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <input
                    type="email"
                    placeholder="Email address"
                    value={signer.email}
                    onChange={(e) => {
                      const updated = [...signSigners];
                      updated[i] = { ...updated[i], email: e.target.value };
                      setSignSigners(updated);
                    }}
                    className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  {signSigners.length > 1 && (
                    <button
                      onClick={() => setSignSigners(signSigners.filter((_, j) => j !== i))}
                      className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-500"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}

              <button
                onClick={() => setSignSigners([...signSigners, { email: '', name: '' }])}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary transition hover:text-primary-600"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add another signer
              </button>
            </div>

            <div className="mt-5 flex justify-end gap-2.5 border-t border-gray-100 pt-4">
              <button
                onClick={() => setShowSignModal(false)}
                className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleInitiateSignature}
                disabled={signingLoading || signSigners.every(s => !s.email.trim() || !s.name.trim())}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
              >
                {signingLoading && <LoadingSpinner size="sm" />}
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
                Send for Signature
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Chat Panel */}
      {id && (
        <ChatPanel
          contractId={id}
          isOpen={chatOpen}
          onClose={() => setChatOpen(false)}
        />
      )}
    </div>
  );
}
