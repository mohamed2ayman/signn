// ============================================================
// Enums
// ============================================================

export enum UserRole {
  SYSTEM_ADMIN = 'SYSTEM_ADMIN',
  OPERATIONS = 'OPERATIONS',
  OWNER_ADMIN = 'OWNER_ADMIN',
  OWNER_CREATOR = 'OWNER_CREATOR',
  OWNER_REVIEWER = 'OWNER_REVIEWER',
  CONTRACTOR_ADMIN = 'CONTRACTOR_ADMIN',
  CONTRACTOR_CREATOR = 'CONTRACTOR_CREATOR',
  CONTRACTOR_REVIEWER = 'CONTRACTOR_REVIEWER',
  CONTRACTOR_TENDERING = 'CONTRACTOR_TENDERING',
}

export enum PermissionLevel {
  VIEWER = 'VIEWER',
  COMMENTER = 'COMMENTER',
  EDITOR = 'EDITOR',
  APPROVER = 'APPROVER',
}

export const JOB_TITLES = [
  'CEO',
  'CFO',
  'COO',
  'Contract Administrator',
  'Contracts & Claims Team Leader',
  'Contracts Director',
  'Contracts Manager',
  'Junior Contracts Engineer',
  'Legal Counsel',
  'Managing Director',
  'Project Director',
  'Project Manager',
  'Senior Contracts and Claims Engineer',
  'Tendering Manager',
] as const;

/** Maps each job title to its default permission level */
export const JOB_TITLE_DEFAULT_PERMISSION: Record<string, PermissionLevel> = {
  'CEO': PermissionLevel.APPROVER,
  'CFO': PermissionLevel.APPROVER,
  'COO': PermissionLevel.APPROVER,
  'Managing Director': PermissionLevel.APPROVER,
  'Contracts Director': PermissionLevel.APPROVER,
  'Project Director': PermissionLevel.APPROVER,
  'Contracts Manager': PermissionLevel.EDITOR,
  'Tendering Manager': PermissionLevel.EDITOR,
  'Project Manager': PermissionLevel.EDITOR,
  'Legal Counsel': PermissionLevel.EDITOR,
  'Contracts & Claims Team Leader': PermissionLevel.EDITOR,
  'Senior Contracts and Claims Engineer': PermissionLevel.EDITOR,
  'Contract Administrator': PermissionLevel.EDITOR,
  'Junior Contracts Engineer': PermissionLevel.COMMENTER,
};

export type JobTitle = (typeof JOB_TITLES)[number];

export interface PermissionDefaultEntry {
  job_title: string;
  permission_level: PermissionLevel;
  is_custom: boolean;
}

export enum ContractStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  PENDING_TENDERING = 'PENDING_TENDERING',
  SENT_TO_CONTRACTOR = 'SENT_TO_CONTRACTOR',
  CONTRACTOR_REVIEWING = 'CONTRACTOR_REVIEWING',
  PENDING_FINAL_APPROVAL = 'PENDING_FINAL_APPROVAL',
  CHANGES_REQUESTED = 'CHANGES_REQUESTED',
  RISK_ESCALATION_PENDING = 'RISK_ESCALATION_PENDING',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  TERMINATED = 'TERMINATED',
}

export enum ContractType {
  FIDIC_RED = 'FIDIC_RED',
  FIDIC_YELLOW = 'FIDIC_YELLOW',
  ADHOC = 'ADHOC',
  UPLOADED = 'UPLOADED',
}

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum RiskAnalysisStatus {
  OPEN = 'OPEN',
  APPROVED = 'APPROVED',
  MANUAL_ADJUSTED = 'MANUAL_ADJUSTED',
  OBSERVED = 'OBSERVED',
  REJECTED = 'REJECTED',
}

export enum NotificationType {
  EMAIL = 'EMAIL',
  IN_APP = 'IN_APP',
  BOTH = 'BOTH',
}

export enum ObligationStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  OVERDUE = 'OVERDUE',
}

export enum AssetType {
  LAW = 'LAW',
  INTERNATIONAL_STANDARD = 'INTERNATIONAL_STANDARD',
  ORGANIZATION_POLICY = 'ORGANIZATION_POLICY',
  CONTRACT_TEMPLATE = 'CONTRACT_TEMPLATE',
  KNOWLEDGE = 'KNOWLEDGE',
}

export enum AssetReviewStatus {
  PENDING_REVIEW = 'PENDING_REVIEW',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  AUTO_APPROVED = 'AUTO_APPROVED',
}

export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum RiskRuleSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum PartyType {
  EMPLOYER = 'EMPLOYER',
  ENGINEERING_CONSULTANT = 'ENGINEERING_CONSULTANT',
  DESIGN_CONSULTANT = 'DESIGN_CONSULTANT',
  COST_CONSULTANT = 'COST_CONSULTANT',
  CONTRACTOR = 'CONTRACTOR',
  SUBCONTRACTOR = 'SUBCONTRACTOR',
}

export enum DocumentProcessingStatus {
  UPLOADED = 'UPLOADED',
  EXTRACTING_TEXT = 'EXTRACTING_TEXT',
  TEXT_EXTRACTED = 'TEXT_EXTRACTED',
  EXTRACTING_CLAUSES = 'EXTRACTING_CLAUSES',
  CLAUSES_EXTRACTED = 'CLAUSES_EXTRACTED',
  FAILED = 'FAILED',
}

export enum ClauseSource {
  MANUAL = 'MANUAL',
  AI_EXTRACTED = 'AI_EXTRACTED',
  AI_DRAFTED = 'AI_DRAFTED',
}

export enum ClauseReviewStatus {
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EDITED = 'EDITED',
}

// ============================================================
// Interfaces
// ============================================================

export interface User {
  id: string;
  organization_id: string | null;
  email: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  job_title: string | null;
  default_permission_level: PermissionLevel | null;
  is_active: boolean;
  is_email_verified: boolean;
  mfa_enabled: boolean;
  preferred_language: string;
  onboarding_completed?: boolean;
  onboarding_level?: 'none' | 'quick' | 'comprehensive';
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  organization?: Organization;
}

export interface SupportTicketReply {
  id: string;
  ticket_id: string;
  user_id: string;
  content: string;
  is_internal_note: boolean;
  created_at: string;
  user?: User;
}

export interface ContractShare {
  id: string;
  contract_id: string;
  shared_by: string;
  shared_with_email: string;
  permission: 'view' | 'comment' | 'edit';
  token: string;
  expires_at: string | null;
  accessed_at: string | null;
  is_active: boolean;
  created_at: string;
  contract?: Contract;
  sharer?: User;
}

export interface Organization {
  id: string;
  name: string;
  industry: string | null;
  crn: string | null;
  country: string | null;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  organization_id: string;
  name: string;
  objective: string | null;
  country: string | null;
  start_date: string | null;
  end_date: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  organization?: Organization;
  creator?: User;
  members?: ProjectMember[];
  contracts?: Contract[];
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: string | null;
  permission_level: PermissionLevel | null;
  added_at: string;
  user?: User;
  project?: Project;
}

export interface Contract {
  id: string;
  project_id: string;
  name: string;
  contract_type: ContractType;
  status: ContractStatus;
  current_version: number;
  creation_flow?: 'UPLOAD_ANALYZE' | 'DRAFT_FROM_REQUIREMENTS' | 'MANUAL';
  party_type: string | null;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  shared_at: string | null;
  created_at: string;
  updated_at: string;
  project?: Project;
  creator?: User;
  approver?: User;
  contract_clauses?: ContractClause[];
  versions?: ContractVersion[];
  comments?: ContractComment[];
  risk_analyses?: RiskAnalysis[];
  obligations?: Obligation[];
  contractor_responses?: ContractorResponse[];
  documents?: DocumentUpload[];
}

export interface Clause {
  id: string;
  organization_id: string | null;
  title: string;
  content: string;
  clause_type: string | null;
  version: number;
  parent_clause_id: string | null;
  is_active: boolean;
  source?: ClauseSource;
  source_document_id?: string | null;
  confidence_score?: number | null;
  review_status?: ClauseReviewStatus;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  organization?: Organization;
  creator?: User;
  parent_clause?: Clause;
  source_document?: DocumentUpload;
}

export interface DocumentUpload {
  id: string;
  contract_id: string;
  organization_id: string;
  file_url: string;
  file_name: string;
  original_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  document_priority: number;
  document_label: string | null;
  processing_status: DocumentProcessingStatus;
  extracted_text: string | null;
  page_count: number | null;
  error_message: string | null;
  processing_job_id: string | null;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
}

export interface ContractClause {
  id: string;
  contract_id: string;
  clause_id: string;
  section_number: string | null;
  order_index: number;
  customizations: Record<string, unknown> | null;
  created_at: string;
  contract?: Contract;
  clause?: Clause;
  risk_analyses?: RiskAnalysis[];
  obligations?: Obligation[];
  comments?: ContractComment[];
}

export interface ContractVersion {
  id: string;
  contract_id: string;
  version_number: number;
  snapshot: Record<string, unknown>;
  change_summary: string | null;
  created_by: string | null;
  created_at: string;
  creator?: User;
}

export interface ProjectParty {
  id: string;
  project_id: string;
  owner_organization_id: string;
  party_organization_id: string | null;
  party_type: PartyType;
  name: string;
  email: string;
  contact_person: string | null;
  phone: string | null;
  invitation_token: string | null;
  invitation_status: string;
  permissions: Record<string, boolean> | null;
  created_at: string;
  project?: Project;
  owner_organization?: Organization;
  party_organization?: Organization;
}

export interface PartyTypePermissions {
  can_create_contracts: boolean;
  can_review_contracts: boolean;
  can_approve_contracts: boolean;
  can_submit_responses: boolean;
  can_manage_subparties: boolean;
  can_view_risk_analysis: boolean;
}

export interface ContractorResponse {
  id: string;
  contract_id: string;
  party_id: string;
  response_contract_id: string | null;
  status: string;
  submitted_at: string | null;
  created_at: string;
  contract?: Contract;
  party?: ProjectParty;
  response_contract?: Contract;
}

export interface RiskAnalysis {
  id: string;
  contract_id: string;
  contract_clause_id: string | null;
  risk_category: string;
  risk_level: RiskLevel;
  description: string;
  recommendation: string | null;
  citation_source: string | null;
  citation_excerpt: string | null;
  status: string;
  handled_by: string | null;
  handled_at: string | null;
  created_at: string;
  contract?: Contract;
  contract_clause?: ContractClause;
  handler?: User;
}

export interface KnowledgeAsset {
  id: string;
  organization_id: string | null;
  title: string;
  description: string | null;
  asset_type: AssetType;
  review_status: AssetReviewStatus;
  file_url: string | null;
  file_name: string | null;
  jurisdiction: string | null;
  tags: string[] | null;
  include_in_risk_analysis: boolean;
  include_in_citations: boolean;
  embedding_status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  organization?: Organization;
  reviewer?: User;
  creator?: User;
}

export interface Obligation {
  id: string;
  contract_id: string;
  contract_clause_id: string | null;
  description: string;
  responsible_party: string | null;
  due_date: string | null;
  frequency: string | null;
  status: ObligationStatus;
  reminder_days_before: number;
  completed_at: string | null;
  completed_by: string | null;
  evidence_url: string | null;
  created_at: string;
  updated_at: string;
  contract?: Contract;
  contract_clause?: ContractClause;
  completer?: User;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: NotificationType;
  is_read: boolean;
  related_entity_type: string | null;
  related_entity_id: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  organization_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
  user?: User;
  organization?: Organization;
}

export interface ContractComment {
  id: string;
  contract_id: string;
  contract_clause_id: string | null;
  user_id: string;
  content: string;
  is_resolved: boolean;
  parent_comment_id: string | null;
  created_at: string;
  updated_at: string;
  user?: User;
  contract?: Contract;
  contract_clause?: ContractClause;
  parent_comment?: ContractComment;
  replies?: ContractComment[];
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  duration_days: number;
  max_projects: number;
  max_users: number;
  max_contracts_per_project: number;
  features: Record<string, boolean> | null;
  is_active: boolean;
  created_at: string;
}

export interface OrganizationSubscription {
  id: string;
  organization_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  start_date: string;
  end_date: string;
  paymob_subscription_id: string | null;
  created_at: string;
  organization?: Organization;
  plan?: SubscriptionPlan;
}

export interface SupportTicket {
  id: string;
  user_id: string;
  organization_id: string | null;
  category: string;
  priority: string;
  subject: string;
  description: string;
  status: string;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  user?: User;
  organization?: Organization;
  assignee?: User;
  replies?: SupportTicketReply[];
}

export interface RiskRule {
  id: string;
  name: string;
  description: string | null;
  risk_category: string;
  severity: RiskRuleSeverity;
  detection_keywords: string[] | null;
  applicable_contract_types: string[] | null;
  recommendation_template: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  creator?: User;
}

export interface RiskCategory {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

// ============================================================
// API Response Types
// ============================================================

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiError {
  message: string;
  statusCode: number;
  error?: string;
}
