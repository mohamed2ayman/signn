import { configureStore } from '@reduxjs/toolkit';
import authReducer from '@/store/slices/authSlice';
import supportChatReducer from '@/store/slices/supportChatSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    supportChat: supportChatReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore non-serializable date values in certain actions
        ignoredActions: ['auth/setUser'],
        ignoredPaths: ['auth.user.created_at', 'auth.user.updated_at'],
      },
    }),
  devTools: import.meta.env.DEV,
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
