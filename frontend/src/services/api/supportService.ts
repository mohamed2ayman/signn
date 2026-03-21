import api from './axios';

export const supportService = {
  createTicket: async (data: {
    category: string;
    priority: string;
    subject: string;
    description: string;
  }) => {
    const response = await api.post('/support/tickets', data);
    return response.data;
  },

  getMyTickets: async () => {
    const response = await api.get('/support/tickets');
    return response.data;
  },

  getTicketById: async (id: string) => {
    const response = await api.get(`/support/tickets/${id}`);
    return response.data;
  },

  addReply: async (
    ticketId: string,
    content: string,
    isInternalNote = false,
  ) => {
    const response = await api.post(`/support/tickets/${ticketId}/replies`, {
      content,
      is_internal_note: isInternalNote,
    });
    return response.data;
  },

  // Admin endpoints
  getAdminTickets: async (filters?: {
    status?: string;
    priority?: string;
    category?: string;
  }) => {
    const response = await api.get('/support/admin/tickets', {
      params: filters,
    });
    return response.data;
  },

  updateStatus: async (ticketId: string, status: string) => {
    const response = await api.put(`/support/tickets/${ticketId}/status`, {
      status,
    });
    return response.data;
  },

  assignTicket: async (ticketId: string, assignedTo: string) => {
    const response = await api.put(`/support/tickets/${ticketId}/assign`, {
      assigned_to: assignedTo,
    });
    return response.data;
  },
};
