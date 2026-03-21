import { useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '@/store';
import {
  setCredentials,
  setLoading,
  setMfaRequired,
  clearMfa,
  logout as logoutAction,
} from '@/store/slices/authSlice';
import { authService } from '@/services/auth/authService';
import type { RegisterRequest } from '@/services/auth/authService';

export function useAuth() {
  const dispatch = useDispatch<AppDispatch>();
  const { user, isAuthenticated, isLoading, mfaRequired, mfaEmail } =
    useSelector((state: RootState) => state.auth);

  const login = useCallback(
    async (email: string, password: string): Promise<{ error?: string }> => {
      try {
        dispatch(setLoading(true));
        const response = await authService.login({ email, password });

        // Check if MFA is required
        if (response.requires_mfa) {
          dispatch(
            setMfaRequired({ email: response.email || email }),
          );
          return {};
        }

        // Successful login without MFA
        if (response.user && response.access_token) {
          dispatch(
            setCredentials({
              user: response.user,
              token: response.access_token,
              refreshToken: response.refresh_token,
            }),
          );
        }

        return {};
      } catch (err: unknown) {
        dispatch(setLoading(false));
        const error = err as { response?: { data?: { message?: string } } };
        return {
          error:
            error.response?.data?.message || 'auth.loginError',
        };
      }
    },
    [dispatch],
  );

  const register = useCallback(
    async (data: RegisterRequest): Promise<{ error?: string }> => {
      try {
        dispatch(setLoading(true));
        const response = await authService.register(data);

        if (response.user && response.access_token) {
          dispatch(
            setCredentials({
              user: response.user,
              token: response.access_token,
              refreshToken: response.refresh_token,
            }),
          );
        }

        return {};
      } catch (err: unknown) {
        dispatch(setLoading(false));
        const error = err as { response?: { data?: { message?: string } } };
        return {
          error:
            error.response?.data?.message || 'auth.registerError',
        };
      }
    },
    [dispatch],
  );

  const verifyMfa = useCallback(
    async (email: string, otpCode: string): Promise<{ error?: string }> => {
      try {
        dispatch(setLoading(true));
        const response = await authService.verifyMfa({
          email,
          otp_code: otpCode,
        });

        if (response.user && response.access_token) {
          dispatch(
            setCredentials({
              user: response.user,
              token: response.access_token,
              refreshToken: response.refresh_token,
            }),
          );
        }

        return {};
      } catch (err: unknown) {
        dispatch(setLoading(false));
        const error = err as { response?: { data?: { message?: string } } };
        return {
          error:
            error.response?.data?.message || 'auth.mfaError',
        };
      }
    },
    [dispatch],
  );

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch {
      // Ignore logout API errors - clear state regardless
    } finally {
      dispatch(logoutAction());
    }
  }, [dispatch]);

  const cancelMfa = useCallback(() => {
    dispatch(clearMfa());
  }, [dispatch]);

  return {
    user,
    isAuthenticated,
    isLoading,
    mfaRequired,
    mfaEmail,
    login,
    register,
    verifyMfa,
    logout,
    cancelMfa,
  };
}

export default useAuth;
