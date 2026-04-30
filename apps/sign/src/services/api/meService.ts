import api from './axios';
import type { UserSession } from './adminSecurityService';

export interface MyProfile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  job_title: string | null;
  preferred_language: string;
  role: string;
  organization_id: string | null;
  mfa_enabled: boolean;
  mfa_method: string | null;
  password_changed_at: string | null;
  last_login_at: string | null;
}

export interface UpdateProfilePayload {
  first_name?: string;
  last_name?: string;
  job_title?: string;
  preferred_language?: string;
}

const meService = {
  getProfile: () => api.get<MyProfile>('/me/profile').then((r) => r.data),
  updateProfile: (payload: UpdateProfilePayload) =>
    api.patch('/me/profile', payload).then((r) => r.data),
  changePassword: (current_password: string, new_password: string) =>
    api.post('/me/change-password', { current_password, new_password }).then((r) => r.data),

  listSessions: () => api.get<UserSession[]>('/me/sessions').then((r) => r.data),
  revokeSession: (id: string) => api.delete(`/me/sessions/${id}`).then((r) => r.data),
  revokeAllSessions: () => api.delete<{ revoked: number }>('/me/sessions').then((r) => r.data),

  exportMyData: () =>
    api
      .post<{ download_url: string; expires_at: string }>('/me/gdpr/export')
      .then((r) => r.data),
};

export default meService;
