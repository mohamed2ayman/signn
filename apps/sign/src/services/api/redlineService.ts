import api from './axios';

/**
 * 7.19 Slice 3 — client for the counterparty-redlining API (Slice 1) and the
 * negotiation status machine (Slice 2).
 *
 * The list rows are the backend's SCRUBBED projection: display name +
 * TEAM/GUEST flag + caller-relative is_author only — no emails, roles, or
 * user/org UUIDs ever reach the client. `word_level_diff` is backend-computed
 * by the SAME shared util the version compare uses (jsdiff is not a frontend
 * dependency), so DiffView renders redlines byte-consistently with version
 * diffs.
 */

export type RedlineStatus =
  | 'PROPOSED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'COUNTERED'
  | 'WITHDRAWN'
  | 'STALE';

export type NegotiationStatus =
  | 'DRAFT'
  | 'SHARED'
  | 'UNDER_REVIEW'
  | 'AGREED'
  | 'READY_TO_SIGN';

export interface RedlineRow {
  id: string;
  contract_id: string;
  contract_clause_id: string;
  round: number;
  parent_redline_id: string | null;
  status: RedlineStatus;
  proposed_title: string | null;
  proposed_content: string;
  note: string | null;
  base_content_snapshot: string;
  decided_at: string | null;
  decision_note: string | null;
  resulting_version_id: string | null;
  resulting_clause_id: string | null;
  created_at: string;
  author_name: string;
  author_role: 'TEAM' | 'GUEST';
  is_author: boolean;
  word_level_diff: Array<{ value: string; added?: boolean; removed?: boolean }> | null;
}

const redlineService = {
  async list(
    contractId: string,
    filters?: { status?: RedlineStatus; contractClauseId?: string },
  ): Promise<RedlineRow[]> {
    const params: Record<string, string> = {};
    if (filters?.status) params.status = filters.status;
    if (filters?.contractClauseId) params.contractClauseId = filters.contractClauseId;
    const { data } = await api.get(`/contracts/${contractId}/redlines`, { params });
    return data;
  },

  async propose(
    contractId: string,
    contractClauseId: string,
    body: { proposedContent: string; proposedTitle?: string; note?: string },
  ): Promise<RedlineRow> {
    const { data } = await api.post(
      `/contracts/${contractId}/clauses/${contractClauseId}/redlines`,
      body,
    );
    return data;
  },

  async accept(
    contractId: string,
    redlineId: string,
    body: { editedTitle?: string; editedContent?: string; note?: string } = {},
  ): Promise<RedlineRow> {
    const { data } = await api.post(
      `/contracts/${contractId}/redlines/${redlineId}/accept`,
      body,
    );
    return data;
  },

  async reject(
    contractId: string,
    redlineId: string,
    body: { note?: string } = {},
  ): Promise<RedlineRow> {
    const { data } = await api.post(
      `/contracts/${contractId}/redlines/${redlineId}/reject`,
      body,
    );
    return data;
  },

  async counter(
    contractId: string,
    redlineId: string,
    body: { proposedContent: string; proposedTitle?: string; note?: string },
  ): Promise<RedlineRow> {
    const { data } = await api.post(
      `/contracts/${contractId}/redlines/${redlineId}/counter`,
      body,
    );
    return data;
  },

  async withdraw(contractId: string, redlineId: string): Promise<RedlineRow> {
    const { data } = await api.post(
      `/contracts/${contractId}/redlines/${redlineId}/withdraw`,
    );
    return data;
  },

  // ── Negotiation status machine (Slice 2) ────────────────────────────────
  async getNegotiation(
    contractId: string,
  ): Promise<{ negotiation_status: NegotiationStatus }> {
    const { data } = await api.get(`/contracts/${contractId}/negotiation`);
    return data;
  },

  async agree(contractId: string): Promise<{ negotiation_status: NegotiationStatus }> {
    const { data } = await api.post(`/contracts/${contractId}/negotiation/agree`);
    return data;
  },

  async readyToSign(
    contractId: string,
  ): Promise<{ negotiation_status: NegotiationStatus }> {
    const { data } = await api.post(`/contracts/${contractId}/negotiation/ready-to-sign`);
    return data;
  },
};

export default redlineService;
