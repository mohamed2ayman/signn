import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type {
  SupportChat,
  SupportChatMessage,
} from '@/services/api/supportChatService';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'error';

interface SupportChatState {
  /** The user's active chat (one at a time on the user side). */
  activeChat: SupportChat | null;
  /** Messages for activeChat, kept in chronological order. */
  messages: SupportChatMessage[];
  /** Set of user IDs currently typing in the activeChat (excluding self). */
  typingUserIds: string[];
  connectionState: ConnectionState;
  /** UI: is the floating widget expanded into the chat window? */
  isOpen: boolean;
  /** UI: should the CSAT modal be shown? Set when ops closes the chat. */
  showCsat: boolean;
}

const initialState: SupportChatState = {
  activeChat: null,
  messages: [],
  typingUserIds: [],
  connectionState: 'idle',
  isOpen: false,
  showCsat: false,
};

const supportChatSlice = createSlice({
  name: 'supportChat',
  initialState,
  reducers: {
    setActiveChat(state, action: PayloadAction<SupportChat | null>) {
      state.activeChat = action.payload;
      // Reset transcript when switching chats.
      state.messages = [];
      state.typingUserIds = [];
      state.showCsat = false;
    },
    setMessages(state, action: PayloadAction<SupportChatMessage[]>) {
      state.messages = action.payload;
    },
    appendMessage(state, action: PayloadAction<SupportChatMessage>) {
      // Idempotent: dedupe by id (handles socket + REST double-emits).
      if (state.messages.some((m) => m.id === action.payload.id)) return;
      state.messages.push(action.payload);
    },
    patchActiveChat(state, action: PayloadAction<Partial<SupportChat>>) {
      if (!state.activeChat) return;
      state.activeChat = { ...state.activeChat, ...action.payload };
    },
    addTypingUser(state, action: PayloadAction<string>) {
      if (!state.typingUserIds.includes(action.payload)) {
        state.typingUserIds.push(action.payload);
      }
    },
    removeTypingUser(state, action: PayloadAction<string>) {
      state.typingUserIds = state.typingUserIds.filter(
        (id) => id !== action.payload,
      );
    },
    setConnectionState(state, action: PayloadAction<ConnectionState>) {
      state.connectionState = action.payload;
    },
    setOpen(state, action: PayloadAction<boolean>) {
      state.isOpen = action.payload;
    },
    setShowCsat(state, action: PayloadAction<boolean>) {
      state.showCsat = action.payload;
    },
    reset() {
      return initialState;
    },
  },
});

export const {
  setActiveChat,
  setMessages,
  appendMessage,
  patchActiveChat,
  addTypingUser,
  removeTypingUser,
  setConnectionState,
  setOpen,
  setShowCsat,
  reset,
} = supportChatSlice.actions;

export default supportChatSlice.reducer;
