import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  MessageSquare,
  ChevronRight,
} from 'lucide-react';
import { contractService } from '@/services/api/contractService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import type { ContractApprover } from '@/types';

function ReviewModal({
  approver,
  onClose,
  onSubmit,
}: {
  approver: ContractApprover;
  onClose: () => void;
  onSubmit: (decision: 'APPROVED' | 'REJECTED', comment: string) => Promise<void>;
}) {
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED' | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!decision) {
      setError('Please select a decision.');
      return;
    }
    if (decision === 'REJECTED' && !comment.trim()) {
      setError('A comment is required when requesting changes.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(decision, comment);
      onClose();
    } catch {
      setError('Failed to submit decision. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-bold text-gray-900">Submit Review Decision</h2>
          <p className="mt-0.5 text-sm text-gray-500 truncate">
            {approver.contract?.name}
          </p>
        </div>

        <div className="space-y-4 p-6">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setDecision('APPROVED')}
              className={`flex items-center gap-2 rounded-xl border-2 p-4 text-left transition-all ${
                decision === 'APPROVED'
                  ? 'border-emerald-500 bg-emerald-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <CheckCircle2
                className={`h-6 w-6 ${decision === 'APPROVED' ? 'text-emerald-500' : 'text-gray-300'}`}
              />
              <div>
                <p className="text-sm font-semibold text-gray-900">Approve</p>
                <p className="text-xs text-gray-500">Mark as approved</p>
              </div>
            </button>
            <button
              onClick={() => setDecision('REJECTED')}
              className={`flex items-center gap-2 rounded-xl border-2 p-4 text-left transition-all ${
                decision === 'REJECTED'
                  ? 'border-red-400 bg-red-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <XCircle
                className={`h-6 w-6 ${decision === 'REJECTED' ? 'text-red-500' : 'text-gray-300'}`}
              />
              <div>
                <p className="text-sm font-semibold text-gray-900">Request Changes</p>
                <p className="text-xs text-gray-500">Return to draft</p>
              </div>
            </button>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Comment{' '}
              {decision === 'REJECTED' && (
                <span className="text-red-500">*</span>
              )}
            </label>
            <textarea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={
                decision === 'REJECTED'
                  ? 'Describe the changes needed...'
                  : 'Optional comment for the submitter...'
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}
        </div>

        <div className="flex gap-3 border-t border-gray-100 px-6 py-4">
          <button
            onClick={handleSubmit}
            disabled={submitting || !decision}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
              decision === 'REJECTED'
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-emerald-600 hover:bg-emerald-700'
            } ${!decision ? 'bg-gray-400' : ''}`}
          >
            {submitting ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Submitting…
              </>
            ) : decision === 'REJECTED' ? (
              'Request Changes'
            ) : (
              'Approve Contract'
            )}
          </button>
          <button
            onClick={onClose}
            className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ApprovalsPage() {
  const navigate = useNavigate();
  const [approvals, setApprovals] = useState<ContractApprover[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewingItem, setReviewingItem] = useState<ContractApprover | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const load = () => {
    contractService
      .getPendingApprovals()
      .then(setApprovals)
      .catch(() => showToast('error', 'Failed to load pending approvals'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleReviewSubmit = async (
    decision: 'APPROVED' | 'REJECTED',
    comment: string,
  ) => {
    if (!reviewingItem) return;
    await contractService.reviewApproval(
      reviewingItem.contract_id,
      decision,
      comment || undefined,
    );
    showToast(
      'success',
      decision === 'APPROVED'
        ? 'Contract approved successfully.'
        : 'Changes requested. Contract returned to draft.',
    );
    // Remove this item from the list
    setApprovals((prev) => prev.filter((a) => a.id !== reviewingItem.id));
    setReviewingItem(null);
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return 'just now';
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
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
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Approval Inbox</h1>
        <p className="mt-1 text-sm text-gray-500">
          Contracts waiting for your review and approval.
        </p>
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
      <div className="mb-6 flex items-center gap-4">
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <Clock className="h-5 w-5 text-amber-500" />
          <div>
            <p className="text-lg font-bold text-amber-800">{approvals.length}</p>
            <p className="text-xs text-amber-600">Awaiting your review</p>
          </div>
        </div>
      </div>

      {approvals.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-gray-200 bg-white py-20 text-center">
          <CheckCircle2 className="mb-3 h-12 w-12 text-emerald-400" />
          <h3 className="text-base font-semibold text-gray-700">All caught up!</h3>
          <p className="mt-1 text-sm text-gray-400">
            No contracts are currently waiting for your approval.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {approvals.map((item) => {
            const contract = item.contract;
            const project = contract?.project;
            const creator = contract?.creator;

            return (
              <div
                key={item.id}
                className="group flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
              >
                {/* Icon */}
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-amber-50">
                  <FileText className="h-5 w-5 text-amber-500" />
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold text-gray-900">
                      {contract?.name ?? '—'}
                    </p>
                    <span className="flex-shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                      PENDING YOUR REVIEW
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-400">
                    {project && (
                      <span className="font-medium text-gray-600">{project.name}</span>
                    )}
                    {creator && (
                      <span>
                        Submitted by{' '}
                        <span className="font-medium text-gray-600">
                          {creator.first_name} {creator.last_name}
                        </span>
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {timeAgo(item.assigned_at)}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-shrink-0 items-center gap-2">
                  <button
                    onClick={() =>
                      navigate(`/app/contracts/${item.contract_id}`)
                    }
                    className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Review
                    <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                  </button>
                  <button
                    onClick={() => setReviewingItem(item)}
                    className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Approve
                  </button>
                  <button
                    onClick={() => {
                      setReviewingItem(item);
                    }}
                    className="flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    Request Changes
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Review Modal */}
      {reviewingItem && (
        <ReviewModal
          approver={reviewingItem}
          onClose={() => setReviewingItem(null)}
          onSubmit={handleReviewSubmit}
        />
      )}
    </div>
  );
}
