import api from './axios';

// ─── Types ────────────────────────────────────────────────

export type ComplianceOverallStatus =
  | 'PENDING'
  | 'COMPLIANT'
  | 'PARTIALLY_COMPLIANT'
  | 'NON_COMPLIANT'
  | 'FAILED';

export type ComplianceExtractionStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED';

export type ComplianceFindingLayer =
  | 'STANDARD'
  | 'JURISDICTION'
  | 'PLAYBOOK'
  | 'CONFLICT';

export type ComplianceFindingType =
  | 'MISSING_CLAUSE'
  | 'DEVIATION'
  | 'CONFLICT'
  | 'JURISDICTION_OVERRIDE'
  | 'PLAYBOOK_DEVIATION';

export type ComplianceFindingSeverity =
  | 'CRITICAL'
  | 'HIGH'
  | 'MEDIUM'
  | 'LOW'
  | 'INFO';

export type ComplianceFindingStatus =
  | 'OPEN'
  | 'ACKNOWLEDGED'
  | 'RESOLVED'
  | 'WAIVED';

export type ReportType =
  | 'COMPLIANCE_SUMMARY'
  | 'OBLIGATIONS_REPORT'
  | 'JURISDICTION_CONFLICT';

export interface ComplianceFinding {
  id: string;
  compliance_check_id: string;
  layer: ComplianceFindingLayer;
  clause_ref: string | null;
  finding_type: ComplianceFindingType;
  severity: ComplianceFindingSeverity;
  requirement: string;
  actual_text: string | null;
  recommendation: string | null;
  knowledge_asset_ref: string | null;
  status: ComplianceFindingStatus;
  acknowledged_at: string | null;
  created_at: string;
}

export interface ComplianceCheck {
  id: string;
  contract_id: string;
  project_id: string;
  jurisdiction: string | null;
  contract_type: string | null;
  overall_status: ComplianceOverallStatus;
  knowledge_assets_used: string[] | null;
  findings_summary: {
    total?: number;
    by_layer?: Record<string, number>;
    by_severity?: Record<string, number>;
    overall_status?: string;
    /** True when the AI response was truncated and findings were salvaged from a partial result. */
    incomplete?: boolean;
    /** AI-side failure reason, stored on the FAILED branch. */
    error?: string;
  } | null;
  obligation_extraction_status: ComplianceExtractionStatus;
  ai_job_id: string | null;
  obligation_job_id: string | null;
  created_at: string;
  updated_at: string;
  findings?: ComplianceFinding[];
}

export type ObligationStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'OVERDUE'
  | 'MET'
  | 'WAIVED';

export type ObligationType =
  | 'NOTICE_PERIOD'
  | 'PAYMENT'
  | 'PERFORMANCE_BOND'
  | 'INSURANCE'
  | 'MILESTONE'
  | 'DEFECTS_LIABILITY'
  | 'DISPUTE_RESOLUTION'
  | 'REPORTING'
  | 'EMPLOYER_OBLIGATION'
  | 'CONTRACTOR_OBLIGATION'
  | 'ENGINEER_OBLIGATION'
  | 'OTHER';

export interface ContractObligation {
  id: string;
  contract_id: string;
  project_id: string | null;
  compliance_check_id: string | null;
  /** Phase 7.1 Step 3 — added for the detail drawer's "View Clause" back-link. */
  contract_clause_id: string | null;
  description: string;
  responsible_party: string | null;
  obligation_type: ObligationType;
  clause_ref: string | null;
  due_date: string | null;
  duration: string | null;
  timeframe_description: string | null;
  amount: string | null;
  currency: string | null;
  is_critical: boolean;
  status: ObligationStatus;
  completed_at: string | null;
  /** Phase 7.1 Step 3 — added for the detail drawer's Evidence section. */
  evidence_url: string | null;
  created_at: string;
  contract?: { id: string; name: string };
}

// ─── Calls ────────────────────────────────────────────────

const complianceService = {
  // checks
  runCheck: (contractId: string) =>
    api
      .post<ComplianceCheck>(`/contracts/${contractId}/compliance-checks`)
      .then((r) => r.data),

  listChecks: (contractId: string) =>
    api
      .get<ComplianceCheck[]>(`/contracts/${contractId}/compliance-checks`)
      .then((r) => r.data),

  getCheck: (contractId: string, checkId: string) =>
    api
      .get<ComplianceCheck>(
        `/contracts/${contractId}/compliance-checks/${checkId}`,
      )
      .then((r) => r.data),

  updateFinding: (
    contractId: string,
    checkId: string,
    findingId: string,
    status: ComplianceFindingStatus,
  ) =>
    api
      .patch(
        `/contracts/${contractId}/compliance-checks/${checkId}/findings/${findingId}`,
        { status },
      )
      .then((r) => r.data),

  // reports — async, email delivery
  emailReport: (
    contractId: string,
    checkId: string,
    type: 'summary' | 'conflict' | 'obligations',
  ) => {
    const path =
      type === 'summary'
        ? 'report'
        : type === 'conflict'
        ? 'conflict-report'
        : 'obligations-report';
    return api
      .post<{ job_id: string; message: string; email: string }>(
        `/contracts/${contractId}/compliance-checks/${checkId}/${path}`,
      )
      .then((r) => r.data);
  },

  // obligations
  listContractObligations: (contractId: string, params?: Record<string, unknown>) =>
    api
      .get<ContractObligation[]>(`/contracts/${contractId}/obligations`, {
        params,
      })
      .then((r) => r.data),

  listProjectObligations: (projectId: string, params?: Record<string, unknown>) =>
    api
      .get<ContractObligation[]>(`/projects/${projectId}/obligations`, {
        params,
      })
      .then((r) => r.data),

  updateObligation: (
    contractId: string,
    obligationId: string,
    patch: Partial<ContractObligation>,
  ) =>
    api
      .patch(`/contracts/${contractId}/obligations/${obligationId}`, patch)
      .then((r) => r.data),

  // ── Phase 7.1 Step 2 — assignment + evidence ─────────────────────
  //
  // Three contract-scoped endpoints introduced by Step 1 (Ayman PR).
  // They live here next to listContractObligations / updateObligation
  // because they share the `/contracts/:id/obligations/:obligationId/...`
  // prefix.

  /**
   * Assign a user to an obligation. Backend returns 409 if the user is
   * already assigned (DB UNIQUE constraint on obligation_id + user_id).
   */
  assignObligation: (
    contractId: string,
    obligationId: string,
    userId: string,
  ) =>
    api
      .post(
        `/contracts/${contractId}/obligations/${obligationId}/assign`,
        { user_id: userId },
      )
      .then((r) => r.data),

  /** Remove a user's assignment. 204 on success, 404 if not assigned. */
  unassignObligation: (
    contractId: string,
    obligationId: string,
    userId: string,
  ) =>
    api
      .delete(
        `/contracts/${contractId}/obligations/${obligationId}/assign/${userId}`,
      )
      .then((r) => r.data),

  /**
   * Attach a completion-evidence URL to an obligation. Backend
   * validates the URL with @IsUrl.
   */
  updateEvidence: (
    contractId: string,
    obligationId: string,
    evidenceUrl: string,
  ) =>
    api
      .put(
        `/contracts/${contractId}/obligations/${obligationId}/evidence`,
        { evidence_url: evidenceUrl },
      )
      .then((r) => r.data),

  icalExportUrl: (contractId: string) =>
    `${api.defaults.baseURL}/contracts/${contractId}/obligations/ical`,
};

export default complianceService;
