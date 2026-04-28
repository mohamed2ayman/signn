// Types mirror the SIGN backend DTOs. Keep in sync with backend changes.

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface AuthUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  organization_id: string;
}

export interface LoginSuccessResponse {
  user: AuthUser;
  access_token: string;
  refresh_token: string;
}

export interface LoginMfaResponse {
  requires_mfa: true;
  mfa_method: 'totp' | 'email';
  email: string;
}

export type LoginResponse = LoginSuccessResponse | LoginMfaResponse;

export interface ParseDocxClause {
  id: string;
  clause_ref: string;
  text: string;
  title: string;
  clause_type: string | null;
  section_number: string | null;
  confidence: number;
  paragraph_start: number;
  paragraph_end: number;
  char_start: number;
  char_end: number;
}

export interface ParseDocxResult {
  full_text: string;
  clauses: ParseDocxClause[];
}

export interface AsyncJobResponse {
  job_id: string;
  status: string;
}

export interface JobStatusResponse {
  status: 'queued' | 'pending' | 'processing' | 'completed' | 'failed' | string;
  result?: any;
  error?: string;
  progress?: { clause_index: number; total: number };
}

export interface RiskFinding {
  clause_id: string;
  clause_ref?: string;
  risk_level: RiskLevel;
  description: string;
  recommendation?: string;
}

export interface KnowledgeAsset {
  id: string;
  title: string;
  description?: string;
  asset_type: string;
  tags?: string[];
  jurisdiction?: string;
  content?: string;
  created_at: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface NegotiationEvent {
  id: string;
  contract_id: string;
  clause_ref: string;
  event_type: string;
  original_text: string | null;
  new_text: string | null;
  performed_by: string;
  source: 'WORD_ADDIN' | 'WEB_APP';
  created_at: string;
}
