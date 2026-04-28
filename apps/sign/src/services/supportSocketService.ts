import { io, Socket } from 'socket.io-client';
import { store } from '@/store';

/**
 * Sibling of socketService.ts dedicated to the /support namespace.
 *
 * The collaboration singleton in socketService.ts can only hold ONE socket
 * instance, so we cannot reuse it for the live-chat /support namespace —
 * this file mirrors its lifecycle but maintains its own connection.
 */

const SOCKET_URL = (
  import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1'
).replace(/\/api\/v1\/?$/, '').replace(/\/api\/?$/, '');

let socket: Socket | null = null;

export type SupportSocketHandler = (...args: any[]) => void;

export const supportSocketService = {
  /** Connect to the /support namespace with JWT auth. Idempotent. */
  connect(): Socket {
    if (socket?.connected) return socket;

    const token = store.getState().auth?.token;
    if (!token) {
      throw new Error('No auth token available for support socket');
    }

    socket = io(`${SOCKET_URL}/support`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socket.on('connect', () => {
      // eslint-disable-next-line no-console
      console.log('[SupportSocket] Connected');
    });
    socket.on('disconnect', (reason) => {
      // eslint-disable-next-line no-console
      console.log('[SupportSocket] Disconnected:', reason);
    });
    socket.on('connect_error', (err) => {
      // eslint-disable-next-line no-console
      console.error('[SupportSocket] Connection error:', err.message);
    });

    return socket;
  },

  disconnect() {
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
  },

  getSocket(): Socket | null {
    return socket;
  },

  joinChat(chatId: string) {
    if (!socket?.connected) return;
    socket.emit('support:join', { chatId });
  },

  leaveChat(chatId: string) {
    if (!socket?.connected) return;
    socket.emit('support:leave', { chatId });
  },

  /**
   * Caller is responsible for debouncing this 300ms after the first
   * keystroke and stop-emitting after 2s of idle (see useTypingEmitter).
   */
  sendTyping(chatId: string) {
    if (!socket?.connected) return;
    socket.emit('support:typing', { chatId });
  },

  sendStopTyping(chatId: string) {
    if (!socket?.connected) return;
    socket.emit('support:stop_typing', { chatId });
  },

  on(event: string, handler: SupportSocketHandler) {
    socket?.on(event, handler);
  },

  off(event: string, handler?: SupportSocketHandler) {
    if (!socket) return;
    if (handler) socket.off(event, handler);
    else socket.off(event);
  },
};
