import api from './axios';

export const aiService = {
  triggerRiskAnalysis: (data: { contract_id: string; clauses: Array<{ id: string; text: string }>; knowledge_context?: string }) =>
    api.post<{ job_id: string; status: string }>('/ai/risk-analysis', data).then(r => r.data),

  triggerSummarize: (data: { contract_id: string; full_text: string }) =>
    api.post<{ job_id: string; status: string }>('/ai/summarize', data).then(r => r.data),

  triggerDiffAnalysis: (data: { original_clauses: Array<{ id: string; text: string }>; modified_clauses: Array<{ id: string; text: string }> }) =>
    api.post<{ job_id: string; status: string }>('/ai/diff', data).then(r => r.data),

  triggerExtractObligations: (data: { contract_id: string; clauses: Array<{ id: string; text: string }> }) =>
    api.post<{ job_id: string; status: string }>('/ai/extract-obligations', data).then(r => r.data),

  triggerChat: (data: { message: string; contract_id?: string; history?: Array<{ role: string; content: string }> }) =>
    api.post<{ job_id: string; status: string }>('/ai/chat', data).then(r => r.data),

  triggerResearch: (data: { keywords: string[]; jurisdiction?: string }) =>
    api.post<{ job_id: string; status: string }>('/ai/research', data).then(r => r.data),

  getJobStatus: (jobId: string) =>
    api.get<{ job_id: string; status: string; result?: any; error?: string }>(`/ai/jobs/${jobId}`).then(r => r.data),

  triggerConflictDetection: (data: {
    contract_id: string;
    clauses: Array<{
      id: string;
      text: string;
      document_id?: string | null;
      document_label?: string | null;
      document_priority?: number;
    }>;
  }) =>
    api.post<{ job_id: string; status: string }>('/ai/detect-conflicts', data).then(r => r.data),

  searchEmbeddings: (data: { query: string; filters?: Record<string, any>; top_k?: number }) =>
    api.post<{ results: any[] }>('/ai/embeddings/search', data).then(r => r.data),
};
