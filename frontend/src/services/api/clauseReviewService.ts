import api from '@/services/api/axios';
import type { ContractClause, Clause, ClauseReviewStatus } from '@/types';

export const clauseReviewService = {
  getClausesForReview: (contractId: string) =>
    api
      .get<ContractClause[]>(`/contracts/${contractId}/review/clauses`)
      .then((r) => r.data),

  updateClauseReview: (
    contractId: string,
    clauseId: string,
    data: {
      review_status: ClauseReviewStatus;
      title?: string;
      content?: string;
      clause_type?: string;
    },
  ) =>
    api
      .put<Clause>(`/contracts/${contractId}/review/clauses/${clauseId}`, data)
      .then((r) => r.data),

  bulkApproveReview: (contractId: string, clauseIds: string[]) =>
    api
      .post(`/contracts/${contractId}/review/clauses/bulk-approve`, {
        clause_ids: clauseIds,
      })
      .then((r) => r.data),

  finalizeReview: (contractId: string) =>
    api
      .post<{ risk_job_id: string; obligations_job_id: string }>(
        `/contracts/${contractId}/review/finalize`,
      )
      .then((r) => r.data),
};

export default clauseReviewService;
