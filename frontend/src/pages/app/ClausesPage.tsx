import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { clauseService } from '@/services/api/clauseService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import ConfidenceBadge from '@/components/common/ConfidenceBadge';
import type { Clause } from '@/types';

type SourceFilter = 'all' | 'AI_EXTRACTED' | 'MANUAL';
type ReviewFilter = 'all' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'EDITED';

export default function ClausesPage() {
  const navigate = useNavigate();
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [clauseTypes, setClauseTypes] = useState<string[]>([]);
  const [selectedType, setSelectedType] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [showDetailModal, setShowDetailModal] = useState<Clause | null>(null);

  useEffect(() => {
    loadClauses();
    clauseService.getClauseTypes().then(setClauseTypes).catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadClauses();
    }, 300);
    return () => clearTimeout(timer);
  }, [search, selectedType]);

  const loadClauses = async () => {
    try {
      const data = await clauseService.getAll({
        search: search || undefined,
        clause_type: selectedType || undefined,
      });
      setClauses(data);
    } catch (err) {
      console.error('Failed to load clauses:', err);
    } finally {
      setLoading(false);
    }
  };

  // Apply client-side filters for source and review status
  const filteredClauses = useMemo(() => {
    let result = clauses;
    if (sourceFilter !== 'all') {
      result = result.filter((c) => c.source === sourceFilter);
    }
    if (reviewFilter !== 'all') {
      result = result.filter((c) => c.review_status === reviewFilter);
    }
    return result;
  }, [clauses, sourceFilter, reviewFilter]);

  // Stats
  const stats = useMemo(() => {
    const total = clauses.length;
    const aiExtracted = clauses.filter((c) => c.source === 'AI_EXTRACTED').length;
    const manual = clauses.filter((c) => c.source === 'MANUAL' || !c.source).length;
    const pendingReview = clauses.filter((c) => c.review_status === 'PENDING_REVIEW').length;
    return { total, aiExtracted, manual, pendingReview };
  }, [clauses]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clause Library</h1>
          <p className="mt-1 text-sm text-gray-500">
            AI-extracted and manually curated clauses from your contracts
          </p>
        </div>
        <button
          onClick={() => navigate('/app/projects/new')}
          className="inline-flex items-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90"
        >
          <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          Upload & Extract
        </button>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
          <p className="text-sm text-gray-500">Total Clauses</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center space-x-2">
            <p className="text-2xl font-bold text-purple-600">{stats.aiExtracted}</p>
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">AI</span>
          </div>
          <p className="text-sm text-gray-500">AI-Extracted</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-2xl font-bold text-gray-600">{stats.manual}</p>
          <p className="text-sm text-gray-500">Manual</p>
        </div>
        {stats.pendingReview > 0 && (
          <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4">
            <p className="text-2xl font-bold text-amber-700">{stats.pendingReview}</p>
            <p className="text-sm text-amber-600">Pending Review</p>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clauses..."
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <svg className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        {/* Source Filter */}
        <div className="flex rounded-lg border border-gray-300 bg-white">
          {(['all', 'AI_EXTRACTED', 'MANUAL'] as SourceFilter[]).map((filter) => (
            <button
              key={filter}
              onClick={() => setSourceFilter(filter)}
              className={`px-3 py-2 text-xs font-medium transition ${
                sourceFilter === filter
                  ? 'bg-primary text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              } ${filter === 'all' ? 'rounded-l-lg' : filter === 'MANUAL' ? 'rounded-r-lg' : ''}`}
            >
              {filter === 'all' ? 'All Sources' : filter === 'AI_EXTRACTED' ? 'AI' : 'Manual'}
            </button>
          ))}
        </div>

        {/* Review Status Filter */}
        <select
          value={reviewFilter}
          onChange={(e) => setReviewFilter(e.target.value as ReviewFilter)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="all">All Statuses</option>
          <option value="PENDING_REVIEW">Pending Review</option>
          <option value="APPROVED">Approved</option>
          <option value="EDITED">Edited</option>
          <option value="REJECTED">Rejected</option>
        </select>

        {/* Clause Type Filter */}
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All Types</option>
          {clauseTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>

      {/* Clause Grid */}
      {filteredClauses.length === 0 ? (
        <EmptyState
          hasAnyClause={clauses.length > 0}
          onUpload={() => navigate('/app/projects/new')}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredClauses.map((clause) => (
            <ClauseCard
              key={clause.id}
              clause={clause}
              onClick={() => setShowDetailModal(clause)}
            />
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {showDetailModal && (
        <ClauseDetailModal
          clause={showDetailModal}
          onClose={() => setShowDetailModal(null)}
        />
      )}
    </div>
  );
}

/* ─── Sub-Components ─────────────────────────────────────────── */

function ClauseCard({
  clause,
  onClick,
}: {
  clause: Clause;
  onClick: () => void;
}) {
  const isAI = clause.source === 'AI_EXTRACTED';
  const isPending = clause.review_status === 'PENDING_REVIEW';

  return (
    <div
      onClick={onClick}
      className={`group cursor-pointer rounded-xl border bg-white p-5 shadow-sm transition hover:shadow-md ${
        isPending
          ? 'border-amber-200 hover:border-amber-300'
          : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      {/* Top: Source + Review Status */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {isAI ? (
            <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
              <svg className="mr-1 h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              AI Extracted
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              Manual
            </span>
          )}
          {clause.clause_type && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
              {clause.clause_type}
            </span>
          )}
        </div>
        <ReviewStatusBadge status={clause.review_status} />
      </div>

      {/* Title */}
      <h3 className="font-semibold text-gray-900 group-hover:text-primary transition-colors">
        {clause.title}
      </h3>

      {/* Content Preview */}
      <p className="mt-2 text-sm text-gray-500 line-clamp-3">{clause.content}</p>

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-xs text-gray-400">v{clause.version}</span>
          {isAI && clause.confidence_score !== undefined && clause.confidence_score !== null && (
            <ConfidenceBadge score={clause.confidence_score} />
          )}
        </div>
        <span className="text-xs text-gray-400">
          {new Date(clause.created_at).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}

function ReviewStatusBadge({ status }: { status?: string }) {
  if (!status || status === 'APPROVED') {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
        <svg className="mr-1 h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        Approved
      </span>
    );
  }
  if (status === 'PENDING_REVIEW') {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
        Pending
      </span>
    );
  }
  if (status === 'EDITED') {
    return (
      <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
        Edited
      </span>
    );
  }
  if (status === 'REJECTED') {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
        Rejected
      </span>
    );
  }
  return null;
}

function ClauseDetailModal({
  clause,
  onClose,
}: {
  clause: Clause;
  onClose: () => void;
}) {
  const isAI = clause.source === 'AI_EXTRACTED';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-gray-100 bg-white px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {isAI ? (
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100">
                  <svg className="h-4 w-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100">
                  <svg className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </div>
              )}
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{clause.title}</h2>
                <div className="mt-0.5 flex items-center space-x-2">
                  <span className="text-xs text-gray-400">v{clause.version}</span>
                  {clause.clause_type && (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                      {clause.clause_type}
                    </span>
                  )}
                  <ReviewStatusBadge status={clause.review_status} />
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Metadata */}
        {isAI && (
          <div className="border-b border-gray-100 bg-purple-50/50 px-6 py-3">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-1.5">
                <svg className="h-4 w-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span className="text-xs font-medium text-purple-700">AI Extracted</span>
              </div>
              {clause.confidence_score !== undefined && clause.confidence_score !== null && (
                <div className="flex items-center space-x-1.5">
                  <span className="text-xs text-gray-500">Confidence:</span>
                  <ConfidenceBadge score={clause.confidence_score} />
                </div>
              )}
              {clause.reviewed_at && (
                <div className="flex items-center space-x-1.5">
                  <span className="text-xs text-gray-500">
                    Reviewed {new Date(clause.reviewed_at).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Content */}
        <div className="px-6 py-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Clause Content
          </h3>
          <div className="whitespace-pre-wrap rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm leading-relaxed text-gray-700">
            {clause.content}
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-between border-t border-gray-100 bg-gray-50 px-6 py-3">
          <span className="text-xs text-gray-400">
            Created {new Date(clause.created_at).toLocaleDateString()}
          </span>
          <button
            onClick={onClose}
            className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-300"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  hasAnyClause,
  onUpload,
}: {
  hasAnyClause: boolean;
  onUpload: () => void;
}) {
  if (hasAnyClause) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white py-12 text-center">
        <svg className="mx-auto h-10 w-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <p className="mt-3 text-sm font-medium text-gray-500">No clauses match your filters</p>
        <p className="text-xs text-gray-400">Try adjusting your search or filters</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50 px-6 py-14 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-100">
        <svg className="h-7 w-7 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </div>
      <h3 className="mt-4 text-lg font-semibold text-gray-900">
        Your clause library builds automatically
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
        Upload construction contracts and SIGN's AI will automatically extract, categorize,
        and index every clause — building your searchable clause library with zero manual effort.
      </p>
      <button
        onClick={onUpload}
        className="mt-6 inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90"
      >
        <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        Upload Your First Contract
      </button>
    </div>
  );
}
