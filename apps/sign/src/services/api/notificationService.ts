import api from './axios';
import { Notification } from '@/types';

export const notificationService = {
  getAll: (params?: { is_read?: boolean; limit?: number }) =>
    api.get<Notification[]>('/notifications', { params }).then(r => r.data),

  getUnreadCount: () =>
    api.get<{ count: number }>('/notifications/unread-count').then(r => r.data),

  markAsRead: (id: string) =>
    api.put<Notification>(`/notifications/${id}/read`).then(r => r.data),

  markAllAsRead: () =>
    api.put('/notifications/read-all').then(r => r.data),

  delete: (id: string) =>
    api.delete(`/notifications/${id}`).then(r => r.data),
};
