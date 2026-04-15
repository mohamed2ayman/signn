import api from '@/services/api/axios';
import type { User, SubscriptionPlan } from '@/types';

// ============================================================
// Request Types
// ============================================================

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  organization_name: string;
  industry?: string;
  country?: string;
  plan_id: string;
}

export interface VerifyMfaRequest {
  email: string;
  otp_code: string;
}

export interface VerifyRecoveryRequest {
  email: string;
  recovery_code: string;
}

export interface AcceptInvitationRequest {
  token: string;
  password: string;
  first_name: string;
  last_name: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
}

// ============================================================
// Response Types
// ============================================================

export interface LoginResponse {
  user?: User;
  access_token?: string;
  refresh_token?: string;
  requires_mfa?: boolean;
  requires_mfa_setup?: boolean;
  mfa_method?: string;
  email?: string;
}

export interface MfaStatusResponse {
  mfa_enabled: boolean;
  mfa_method: 'email' | 'totp' | null;
  recovery_codes_count: number;
  requires_mfa_setup: boolean;
}

export interface MfaTotpSetupResponse {
  secret: string;
  otpauth_uri: string;
  qr_code: string;
}

export interface EnableMfaResponse {
  message: string;
  recovery_codes: string[];
}

export interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
}

// ============================================================
// Auth Service
// ============================================================

export const authService = {
  /**
   * Authenticate user with email and password.
   * May return requires_mfa=true if MFA is enabled on the account.
   */
  async login(data: LoginRequest): Promise<LoginResponse> {
    const response = await api.post<LoginResponse>('/auth/login', data);
    if (response.data.refresh_token) {
      localStorage.setItem('refresh_token', response.data.refresh_token);
    }
    return response.data;
  },

  /**
   * Register a new user and organization
   */
  async register(data: RegisterRequest): Promise<LoginResponse> {
    const response = await api.post<LoginResponse>('/auth/register', data);
    if (response.data.refresh_token) {
      localStorage.setItem('refresh_token', response.data.refresh_token);
    }
    return response.data;
  },

  /**
   * Verify MFA OTP code after login
   */
  async verifyMfa(data: VerifyMfaRequest): Promise<LoginResponse> {
    const response = await api.post<LoginResponse>('/auth/verify-mfa', data);
    if (response.data.refresh_token) {
      localStorage.setItem('refresh_token', response.data.refresh_token);
    }
    return response.data;
  },

  /**
   * Use a backup recovery code to bypass MFA
   */
  async verifyRecovery(data: VerifyRecoveryRequest): Promise<LoginResponse> {
    const response = await api.post<LoginResponse>('/auth/verify-recovery', data);
    if (response.data.refresh_token) {
      localStorage.setItem('refresh_token', response.data.refresh_token);
    }
    return response.data;
  },

  // ─── MFA Settings ─────────────────────────────────────────

  async getMfaStatus(): Promise<MfaStatusResponse> {
    const response = await api.get<MfaStatusResponse>('/auth/mfa/status');
    return response.data;
  },

  async setupMfaTotp(): Promise<MfaTotpSetupResponse> {
    const response = await api.post<MfaTotpSetupResponse>('/auth/mfa/setup/totp');
    return response.data;
  },

  async enableMfaTotp(totpCode: string): Promise<EnableMfaResponse> {
    const response = await api.post<EnableMfaResponse>('/auth/mfa/enable/totp', {
      totp_code: totpCode,
    });
    return response.data;
  },

  async enableMfaEmail(): Promise<EnableMfaResponse> {
    const response = await api.post<EnableMfaResponse>('/auth/mfa/enable/email');
    return response.data;
  },

  async disableMfa(password: string): Promise<{ message: string }> {
    const response = await api.delete<{ message: string }>('/auth/mfa/disable', {
      data: { password },
    });
    return response.data;
  },

  /**
   * Refresh the access token using the refresh token
   */
  async refreshToken(refresh_token: string): Promise<RefreshTokenResponse> {
    const response = await api.post<RefreshTokenResponse>('/auth/refresh', {
      refresh_token,
    });
    localStorage.setItem('refresh_token', response.data.refresh_token);
    return response.data;
  },

  /**
   * Log out the current user
   */
  async logout(): Promise<void> {
    try {
      await api.post('/auth/logout');
    } finally {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    }
  },

  /**
   * Accept an invitation to join an organization
   */
  async acceptInvitation(data: AcceptInvitationRequest): Promise<LoginResponse> {
    const response = await api.post<LoginResponse>('/auth/accept-invitation', data);
    if (response.data.refresh_token) {
      localStorage.setItem('refresh_token', response.data.refresh_token);
    }
    return response.data;
  },

  /**
   * Request password reset email
   */
  async forgotPassword(data: ForgotPasswordRequest): Promise<{ message: string }> {
    const response = await api.post<{ message: string }>('/auth/forgot-password', data);
    return response.data;
  },

  /**
   * Reset password with token
   */
  async resetPassword(data: ResetPasswordRequest): Promise<{ message: string }> {
    const response = await api.post<{ message: string }>('/auth/reset-password', data);
    return response.data;
  },

  /**
   * Get the current authenticated user's profile
   */
  async getProfile(): Promise<User> {
    const response = await api.get<User>('/auth/profile');
    return response.data;
  },

  /**
   * Get available subscription plans (public endpoint for registration)
   */
  async getSubscriptionPlans(): Promise<SubscriptionPlan[]> {
    const response = await api.get<SubscriptionPlan[]>('/admin/subscription-plans');
    return response.data;
  },
};

export default authService;
