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
  email?: string;
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
