import { io, Socket } from 'socket.io-client';
import { store } from '@/store';

const SOCKET_URL =
  (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace('/api', '');

let socket: Socket | null = null;

export interface RoomUser {
  id: string;
  email: string;
  name?: string;
  joinedAt: string;
}

export type SocketEventHandler = (...args: any[]) => void;

export const socketService = {
  /**
   * Connect to the collaboration namespace with JWT auth
   */
  connect(): Socket {
    if (socket?.connected) return socket;

    const state = store.getState();
    const token = state.auth?.token;

    if (!token) {
      throw new Error('No auth token available for socket connection');
    }

    socket = io(`${SOCKET_URL}/collaboration`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socket.on('connect', () => {
      console.log('[Socket] Connected to collaboration namespace');
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
    });

    socket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
    });

    return socket;
  },

  /**
   * Disconnect and clean up
   */
  disconnect() {
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
  },

  /**
   * Get the current socket instance
   */
  getSocket(): Socket | null {
    return socket;
  },

  /**
   * Join a contract room
   */
  joinContract(contractId: string, name?: string) {
    if (!socket?.connected) return;
    socket.emit('join:contract', { contractId, name });
  },

  /**
   * Leave a contract room
   */
  leaveContract(contractId: string) {
    if (!socket?.connected) return;
    socket.emit('leave:contract', { contractId });
  },

  /**
   * Subscribe to an event
   */
  on(event: string, handler: SocketEventHandler) {
    if (!socket) return;
    socket.on(event, handler);
  },

  /**
   * Unsubscribe from an event
   */
  off(event: string, handler?: SocketEventHandler) {
    if (!socket) return;
    if (handler) {
      socket.off(event, handler);
    } else {
      socket.off(event);
    }
  },
};
