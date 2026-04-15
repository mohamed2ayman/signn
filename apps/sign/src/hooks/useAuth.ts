import { useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '@/store';
import {
  setCredentials,
  setUser,
  setLoading,
  setMfaRequired,
  clearMfa,
  clearMfaSetupRequired,
  logout as logoutAction,
} from '@/store/slices/authSlice';
import { authService } from '@/services/auth/authService';
import type { RegisterRequest } from '@/services/auth/authService';

export function useAuth() {
  const dispatch = useDispatch<AppDispatch>();
  const {
    user,
    isAuthenticated,
    isLoading,
    mfaRequired,
    mfaMethod,
    mfaEmail,
    mfaSetupRequired,
  } = useSelector((state: RootState) => state.auth);

  const login = useCallback(
    async (email: string, password: string): Promise<{ error?: string }> => {
      try {
        dispatch(setLoading(true));
        const response = await authService.login({ email, password });

        if (response.requires_mfa) {
          dispatch(
            setMfaRequired({
              email: response.email || email,
              mfaMethod: (response.mfa_method as 'email' | 'totp') || 'email',
            }),
          );
          return {};
        }

        if (response.user && response.access_token) {
          dispatch(
            setCredentials({
              user: response.user,
              token: response.access_token,
              refreshToken: response.refresh_token,
              mfaSetupRequired: response.requires_mfa_setup ?? false,
            }),
          );
        }

        return {};
      } catch (err: unknown) {
        dispatch(setLoading(false));
        const error = err as { response?: { data?: { message?: string } } };
        return {
          error: error.response?.data?.message || 'auth.loginError',
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
          error: error.response?.data?.message || 'auth.registerError',
        };
      }
    },
    [dispatch],
  );

  const verifyMfa = useCallback(
    async (email: string, otpCode: string): Promise<{ error?: string }> => {
      try {
        dispatch(setLoading(true));
        const response = await authService.verifyMfa({ email, otp_code: otpCode });

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
          error: error.response?.data?.message || 'auth.mfaError',
        };
      }
    },
    [dispatch],
  );

  const verifyRecovery = useCallback(
    async (email: string, recoveryCode: string): Promise<{ error?: string }> => {
      try {
        dispatch(setLoading(true));
        const response = await authService.verifyRecovery({
          email,
          recovery_code: recoveryCode,
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
          error: error.response?.data?.message || 'Invalid recovery code',
        };
      }
    },
    [dispatch],
  );

  const refreshUserProfile = useCallback(async () => {
    try {
      const userData = await authService.getProfile();
      dispatch(setUser(userData));
    } catch {
      // ignore
    }
  }, [dispatch]);

  const completeMfaSetup = useCallback(() => {
    dispatch(clearMfaSetupRequired());
  }, [dispatch]);

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
    mfaMethod,
    mfaEmail,
    mfaSetupRequired,
    login,
    register,
    verifyMfa,
    verifyRecovery,
    refreshUserProfile,
    completeMfaSetup,
    logout,
    cancelMfa,
  };
}

export default useAuth;
