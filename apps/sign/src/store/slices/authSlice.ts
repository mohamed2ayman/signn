import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { User } from '@/types';

interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  mfaRequired: boolean;
  mfaMethod: 'email' | 'totp' | null;
  mfaEmail: string | null;
  mfaSetupRequired: boolean;
}

const initialState: AuthState = {
  user: null,
  token: localStorage.getItem('access_token'),
  refreshToken: localStorage.getItem('refresh_token'),
  isAuthenticated: !!localStorage.getItem('access_token'),
  isLoading: false,
  mfaRequired: false,
  mfaMethod: null,
  mfaEmail: null,
  mfaSetupRequired: false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials: (
      state,
      action: PayloadAction<{
        user: User;
        token: string;
        refreshToken?: string;
        mfaSetupRequired?: boolean;
      }>,
    ) => {
      state.user = action.payload.user;
      state.token = action.payload.token;
      state.refreshToken = action.payload.refreshToken || state.refreshToken;
      state.isAuthenticated = true;
      state.isLoading = false;
      state.mfaRequired = false;
      state.mfaMethod = null;
      state.mfaEmail = null;
      state.mfaSetupRequired = action.payload.mfaSetupRequired ?? false;
      localStorage.setItem('access_token', action.payload.token);
      if (action.payload.refreshToken) {
        localStorage.setItem('refresh_token', action.payload.refreshToken);
      }
    },
    setUser: (state, action: PayloadAction<User>) => {
      state.user = action.payload;
      state.mfaSetupRequired = false;
    },
    setToken: (state, action: PayloadAction<string>) => {
      state.token = action.payload;
      localStorage.setItem('access_token', action.payload);
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    setMfaRequired: (
      state,
      action: PayloadAction<{ email: string; mfaMethod: 'email' | 'totp' }>,
    ) => {
      state.mfaRequired = true;
      state.mfaMethod = action.payload.mfaMethod;
      state.mfaEmail = action.payload.email;
      state.isLoading = false;
    },
    clearMfa: (state) => {
      state.mfaRequired = false;
      state.mfaMethod = null;
      state.mfaEmail = null;
    },
    clearMfaSetupRequired: (state) => {
      state.mfaSetupRequired = false;
    },
    logout: (state) => {
      state.user = null;
      state.token = null;
      state.refreshToken = null;
      state.isAuthenticated = false;
      state.isLoading = false;
      state.mfaRequired = false;
      state.mfaMethod = null;
      state.mfaEmail = null;
      state.mfaSetupRequired = false;
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    },
  },
});

export const {
  setCredentials,
  setUser,
  setToken,
  setLoading,
  setMfaRequired,
  clearMfa,
  clearMfaSetupRequired,
  logout,
} = authSlice.actions;

export default authSlice.reducer;
