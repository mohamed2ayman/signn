import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import NotificationsPage from '@/pages/app/NotificationsPage';
import { notificationService } from '@/services/api/notificationService';
import type { Notification } from '@/types';

// Mock the service at the service level (per lesson #37 — never mock axios)
vi.mock('@/services/api/notificationService', () => ({
  notificationService: {
    getAll: vi.fn(),
    getUnreadCount: vi.fn(),
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
    delete: vi.fn(),
  },
}));

const NOTIFICATIONS: Notification[] = [
  {
    id: 'n-1',
    user_id: 'u-1',
    title: 'Contract signed',
    message: 'Bridge contract was fully executed',
    type: 'IN_APP',
    related_entity_type: 'contract',
    related_entity_id: 'c-1',
    is_read: false,
    created_at: new Date().toISOString(),
  } as Notification,
  {
    id: 'n-2',
    user_id: 'u-1',
    title: 'Obligation due in 7 days',
    message: 'Submit monthly progress report',
    type: 'IN_APP',
    related_entity_type: 'obligation',
    related_entity_id: 'o-1',
    is_read: true,
    created_at: new Date().toISOString(),
  } as Notification,
];

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, qc };
}

describe('NotificationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders notifications loaded via React Query', async () => {
    vi.mocked(notificationService.getAll).mockResolvedValue(NOTIFICATIONS);
    renderPage();
    await screen.findByText('Contract signed');
    expect(screen.getByText('Obligation due in 7 days')).toBeInTheDocument();
    // Unread count appears in header subtitle
    expect(screen.getByText(/1 unread/)).toBeInTheDocument();
  });

  it('renders empty state with no notifications', async () => {
    vi.mocked(notificationService.getAll).mockResolvedValue([]);
    renderPage();
    await screen.findByText('No notifications yet');
  });

  it('invalidates the notifications cache on mark-as-read', async () => {
    vi.mocked(notificationService.getAll).mockResolvedValue(NOTIFICATIONS);
    vi.mocked(notificationService.markAsRead).mockResolvedValue(
      { ...NOTIFICATIONS[0], is_read: true } as Notification,
    );
    const { qc } = renderPage();
    await screen.findByText('Contract signed');

    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    // The mark-as-read button is the SVG-icon button with title "Mark as read"
    const markBtn = screen.getByTitle('Mark as read');
    await userEvent.click(markBtn);

    await waitFor(() =>
      expect(notificationService.markAsRead).toHaveBeenCalledWith('n-1'),
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notifications'] }),
    );
  });

  it('invalidates the notifications cache on mark-all-as-read', async () => {
    vi.mocked(notificationService.getAll).mockResolvedValue(NOTIFICATIONS);
    vi.mocked(notificationService.markAllAsRead).mockResolvedValue(undefined);
    const { qc } = renderPage();
    await screen.findByText('Contract signed');

    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    await userEvent.click(screen.getByText('Mark all as read'));

    await waitFor(() =>
      expect(notificationService.markAllAsRead).toHaveBeenCalled(),
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notifications'] }),
    );
  });

  it('hides the Mark-all button when zero unread', async () => {
    vi.mocked(notificationService.getAll).mockResolvedValue([
      { ...NOTIFICATIONS[0], is_read: true } as Notification,
    ]);
    renderPage();
    await screen.findByText('Contract signed');
    expect(screen.queryByText('Mark all as read')).not.toBeInTheDocument();
    expect(screen.getByText('All caught up')).toBeInTheDocument();
  });
});
