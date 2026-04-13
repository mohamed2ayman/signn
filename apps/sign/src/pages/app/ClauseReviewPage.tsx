import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { clauseReviewService } from '@/services/api/clauseReviewService';
import { documentProcessingService } from '@/services/api/documentProcessingService';
import { contractService } from '@/services/api/contractService';
import { ClauseReviewStatus } from '@/types';
import type { ContractClause, Contract, DocumentUpload } from '@/types';
import ClauseReviewCard from '@/components/review/ClauseReviewCard';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import Button from '@/components/common/Button';

type FilterMode = 'all' | 'pending' | 'approved' | 'rejected';

export default function ClauseReviewPage() {
  const { id: contractId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [contract, setContract] = useState<Contract | null>(null);
  const [contractClauses, setContractClauses] = useState<ContractClause[]>([]);
  const [documents, setDocuments] = useState<DocumentUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [selectedClauseId, setSelectedClauseId] = useState<string | null>(null);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [activeDocTab, setActiveDocTab] = useState<string | null>(null);

  // Load data
  useEffect(() => {
    if (!contractId) return;
    loadData();
  }, [contractId]);

  const loadData = async () => {
    if (!contractId) return;
    setLoading(true);
    try {
      const [clauseData, contractData, docsData] = await Promise.all([
        clauseReviewService.getClausesForReview(contractId),
        contractService.getById(contractId),
        documentProcessingService.getDocuments(contractId),
      ]);
      setContractClauses(clauseData);
      setContract(contractData);
      setDocuments(docsData);
      if (docsData.length > 0) setActiveDocTab(docsData[0].id);
    } catch (err) {
      console.error('Failed to load review data:', err);
      setError('Failed to load clause review data.');
    } finally {
      setLoading(false);
    }
  };

  // Derived state
  const allClauses = useMemo(
    () => contractClauses.map((cc) => ({ ...cc.clause!, sectionNumber: cc.section_number })).filter(Boolean),
    [contractClauses],
  );

  const filteredClauses = useMemo(() => {
    if (filter === 'all') return allClauses;
    const statusMap: Record<FilterMode, ClauseReviewStatus> = {
      all: ClauseReviewStatus.PENDING_REVIEW,
      pending: ClauseReviewStatus.PENDING_REVIEW,
      approved: ClauseReviewStatus.APPROVED,
      rejected: ClauseReviewStatus.REJECTED,
    };
    return allClauses.filter(
      (c) => c.review_status === statusMap[filter] ||
        (filter === 'approved' && c.review_status === ClauseReviewStatus.EDITED),
    );
  }, [allClauses, filter]);

  const stats = useMemo(() => {
    const total = allClauses.length;
    const reviewed = allClauses.filter(
      (c) =>
        c.review_status !== ClauseReviewStatus.PENDING_REVIEW,
    ).length;
    const approved = allClauses.filter(
      (c) =>
        c.review_status === ClauseReviewStatus.APPROVED ||
        c.review_status === ClauseReviewStatus.EDITED,
    ).length;
    const rejected = allClauses.filter(
      (c) => c.review_status === ClauseReviewStatus.REJECTED,
    ).length;
    const pending = total - reviewed;
    return { total, reviewed, approved, rejected, pending };
  }, [allClauses]);

  const allReviewed = stats.pending === 0 && stats.total > 0;

  // Active document text
  const activeDocument = useMemo(
    () => documents.find((d) => d.id === activeDocTab),
    [documents, activeDocTab],
  );

  // Actions
  const handleApprove = useCallback(
    async (clauseId: string) => {
      if (!contractId) return;
      await clauseReviewService.updateClauseReview(contractId, clauseId, {
        review_status: ClauseReviewStatus.APPROVED,
      });
      setContractClauses((prev) =>
        prev.map((cc) =>
          cc.clause?.id === clauseId
            ? {
                ...cc,
                clause: {
                  ...cc.clause!,
                  review_status: ClauseReviewStatus.APPROVED,
                },
              }
            : cc,
        ),
      );
    },
    [contractId],
  );

  const handleReject = useCallback(
    async (clauseId: string) => {
      if (!contractId) return;
      await clauseReviewService.updateClauseReview(contractId, clauseId, {
        review_status: ClauseReviewStatus.REJECTED,
      });
      setContractClauses((prev) =>
        prev.map((cc) =>
          cc.clause?.id === clauseId
            ? {
                ...cc,
                clause: {
                  ...cc.clause!,
                  review_status: ClauseReviewStatus.REJECTED,
                },
              }
            : cc,
        ),
      );
    },
    [contractId],
  );

  const handleEdit = useCallback(
    async (
      clauseId: string,
      data: { title?: string; content?: string; clause_type?: string },
    ) => {
      if (!contractId) return;
      const updated = await clauseReviewService.updateClauseReview(
        contractId,
        clauseId,
        {
          review_status: ClauseReviewStatus.EDITED,
          ...data,
        },
      );
      setContractClauses((prev) =>
        prev.map((cc) =>
          cc.clause?.id === clauseId ? { ...cc, clause: updated } : cc,
        ),
      );
    },
    [contractId],
  );

  const handleApproveAll = useCallback(async () => {
    if (!contractId) return;
    const pendingIds = allClauses
      .filter((c) => c.review_status === ClauseReviewStatus.PENDING_REVIEW)
      .map((c) => c.id);
    if (pendingIds.length === 0) return;

    await clauseReviewService.bulkApproveReview(contractId, pendingIds);
    setContractClauses((prev) =>
      prev.map((cc) =>
        pendingIds.includes(cc.clause?.id || '')
          ? {
              ...cc,
              clause: {
                ...cc.clause!,
                review_status: ClauseReviewStatus.APPROVED,
              },
            }
          : cc,
      ),
    );
  }, [contractId, allClauses]);

  const handleFinalize = useCallback(async () => {
    if (!contractId) return;
    setIsFinalizing(true);
    try {
      await clauseReviewService.finalizeReview(contractId);
      navigate(`/app/contracts/${contractId}`);
    } catch (err) {
      setError('Failed to finalize review. Please try again.');
    } finally {
      setIsFinalizing(false);
    }
  }, [contractId, navigate]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error && !contract) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <button
                onClick={() =>
                  contract?.project_id &&
                  navigate(`/app/projects/${contract.project_id}`)
                }
                className="hover:text-primary"
              >
                Project
              </button>
              <span>/</span>
              <span className="font-medium text-gray-900">
                {contract?.name || 'Contract'}
              </span>
              <span>/</span>
              <span className="text-primary">Clause Review</span>
            </div>
            <h1 className="mt-1 text-xl font-semibold text-gray-900">
              Review Extracted Clauses
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right text-sm">
              <p className="font-medium text-gray-900">
                {stats.total} clauses from {documents.length} document
                {documents.length !== 1 ? 's' : ''}
              </p>
              <p className="text-gray-500">
                {stats.reviewed} of {stats.total} reviewed
              </p>
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{
              width: `${stats.total > 0 ? (stats.reviewed / stats.total) * 100 : 0}%`,
            }}
          />
        </div>
      </div>

      {/* Main Content — Two Panel Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel — Document Viewer */}
        <div className="w-[55%] flex-shrink-0 border-r border-gray-200 bg-gray-50">
          {/* Document Tabs */}
          <div className="flex border-b border-gray-200 bg-white px-4">
            {documents.map((doc) => (
              <button
                key={doc.id}
                onClick={() => setActiveDocTab(doc.id)}
                className={`px-4 py-3 text-sm font-medium transition-colors ${
                  activeDocTab === doc.id
                    ? 'border-b-2 border-primary text-primary'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {doc.document_label || doc.original_name || doc.file_name}
              </button>
            ))}
          </div>

          {/* Document Text */}
          <div className="h-full overflow-y-auto p-6">
            {/* Parties Section — shown for agreement documents only */}
            {activeDocument?.extracted_text &&
              (contract?.party_first_name || contract?.party_second_name) &&
              (activeDocument.document_label || '').toLowerCase().match(/agreement|اتفاقية|عقد/) && (
              <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50/50 p-4 shadow-sm" dir="rtl">
                <h3 className="mb-2 text-sm font-semibold text-blue-800">
                  أطراف العقد
                </h3>
                <div className="space-y-1 text-sm text-gray-700">
                  {contract.party_first_name && (
                    <p><strong>الطرف الأول:</strong> {contract.party_first_name}</p>
                  )}
                  {contract.party_second_name && (
                    <p><strong>الطرف الثاني:</strong> {contract.party_second_name}</p>
                  )}
                </div>
              </div>
            )}

            {activeDocument?.extracted_text ? (
              <div className="rounded-lg bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-700">
                    Document Content
                  </h3>
                  {activeDocument.page_count && (
                    <span className="text-xs text-gray-400">
                      {activeDocument.page_count} pages
                    </span>
                  )}
                </div>
                <pre
                  className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-gray-700"
                  dir="auto"
                  style={{ unicodeBidi: 'plaintext' }}
                >
                  {activeDocument.extracted_text}
                </pre>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">
                No extracted text available for this document.
              </div>
            )}
          </div>
        </div>

        {/* Right Panel — Clause Review List */}
        <div className="flex w-[45%] flex-col bg-white">
          {/* Filter Bar */}
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <div className="flex gap-1">
              {(
                [
                  { key: 'all', label: 'All', count: stats.total },
                  { key: 'pending', label: 'Pending', count: stats.pending },
                  { key: 'approved', label: 'Approved', count: stats.approved },
                  { key: 'rejected', label: 'Rejected', count: stats.rejected },
                ] as const
              ).map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    filter === f.key
                      ? 'bg-primary text-white'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {f.label} ({f.count})
                </button>
              ))}
            </div>
            {stats.pending > 0 && (
              <button
                onClick={handleApproveAll}
                className="text-xs font-medium text-primary hover:text-primary/80"
              >
                Approve All ({stats.pending})
              </button>
            )}
          </div>

          {/* Clause Cards */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="space-y-3">
              {filteredClauses.map((clause) => (
                <ClauseReviewCard
                  key={clause.id}
                  clause={clause}
                  sectionNumber={(clause as any).sectionNumber}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onEdit={handleEdit}
                  isSelected={selectedClauseId === clause.id}
                  onClick={() => setSelectedClauseId(clause.id)}
                />
              ))}
              {filteredClauses.length === 0 && (
                <div className="py-8 text-center text-sm text-gray-400">
                  {filter === 'all'
                    ? 'No clauses extracted yet.'
                    : `No ${filter} clauses.`}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Sticky Bar */}
      <div className="flex-shrink-0 border-t border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <span className="text-sm text-gray-600">
                {stats.approved} approved
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-red-500" />
              <span className="text-sm text-gray-600">
                {stats.rejected} rejected
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-yellow-400" />
              <span className="text-sm text-gray-600">
                {stats.pending} pending
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() =>
                contract?.project_id &&
                navigate(`/app/projects/${contract.project_id}`)
              }
            >
              Save & Continue Later
            </Button>
            <Button
              onClick={handleFinalize}
              isLoading={isFinalizing}
              disabled={!allReviewed}
            >
              {allReviewed
                ? 'Finalize Review & Analyze'
                : `Review ${stats.pending} remaining clause${stats.pending !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </div>

        {error && (
          <div className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-600">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
