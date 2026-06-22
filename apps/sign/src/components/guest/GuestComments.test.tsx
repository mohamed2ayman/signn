import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import GuestComments from '@/components/guest/GuestComments';
import { getGuestComments, postGuestComment } from '@/services/api/guestService';
import type { GuestVisibleComment, GuestComment } from '@/services/api/guestService';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));
vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/services/api/guestService', () => ({
  getGuestComments: vi.fn(),
  postGuestComment: vi.fn(),
}));

const mockedGet = getGuestComments as unknown as ReturnType<typeof vi.fn>;
const mockedPost = postGuestComment as unknown as ReturnType<typeof vi.fn>;

const CONVERSATION: GuestVisibleComment[] = [
  {
    id: 'g1',
    contract_id: 'c1',
    contract_clause_id: null,
    content: 'GUEST question about the payment clause',
    created_at: '2026-06-22T10:00:00Z',
    author_name: 'Gina Guest',
    author_role: 'GUEST',
  },
  {
    id: 't1',
    contract_id: 'c1',
    contract_clause_id: null,
    content: 'TEAM reply we will revise clause 4',
    created_at: '2026-06-22T10:05:00Z',
    author_name: 'Tariq Team',
    author_role: 'TEAM',
  },
];

const renderComp = () =>
  render(
    <GuestComments
      contractId="c1"
      guestJwt="guest.jwt.token"
      guestName="Gina Guest"
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GuestComments', () => {
  it('loads and renders the persisted conversation with a guest-vs-team distinction', async () => {
    mockedGet.mockResolvedValue(CONVERSATION);
    renderComp();

    // Both the guest message and the SIGN-team reply are shown.
    await waitFor(() => {
      expect(screen.getByText('GUEST question about the payment clause')).toBeInTheDocument();
    });
    expect(screen.getByText('TEAM reply we will revise clause 4')).toBeInTheDocument();

    // Author names render.
    expect(screen.getByText('Gina Guest')).toBeInTheDocument();
    expect(screen.getByText('Tariq Team')).toBeInTheDocument();

    // The distinction: a TEAM badge AND a guest badge are both present.
    expect(screen.getByText('guest.comments.teamBadge')).toBeInTheDocument();
    expect(screen.getByText('guest.comments.badge')).toBeInTheDocument();

    // The GET was made (fetch-on-mount with the guest JWT).
    expect(mockedGet).toHaveBeenCalledWith('c1', 'guest.jwt.token');
  });

  it('appends a newly-posted guest comment to the conversation', async () => {
    mockedGet.mockResolvedValue([]);
    const created: GuestComment = {
      id: 'new1',
      contract_id: 'c1',
      user_id: 'u-guest',
      content: 'A fresh guest comment',
      created_at: '2026-06-22T11:00:00Z',
    };
    mockedPost.mockResolvedValue(created);

    renderComp();

    // Empty state first.
    await waitFor(() => {
      expect(screen.getByText('guest.comments.empty')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('guest.comments.placeholder'), {
      target: { value: 'A fresh guest comment' },
    });
    fireEvent.click(screen.getByText('guest.comments.post'));

    await waitFor(() => {
      expect(screen.getByText('A fresh guest comment')).toBeInTheDocument();
    });
    // The locally-mapped new comment carries the guest badge (poster is the guest).
    expect(screen.getByText('guest.comments.badge')).toBeInTheDocument();
    expect(mockedPost).toHaveBeenCalledWith('c1', 'guest.jwt.token', {
      content: 'A fresh guest comment',
    });
  });

  it('shows a retry affordance when the conversation fails to load', async () => {
    mockedGet.mockRejectedValueOnce(new Error('network'));
    renderComp();

    await waitFor(() => {
      expect(screen.getByText('guest.comments.loadError')).toBeInTheDocument();
    });
    expect(screen.getByText('guest.comments.retry')).toBeInTheDocument();

    // Retry re-fetches and renders the conversation.
    mockedGet.mockResolvedValueOnce(CONVERSATION);
    fireEvent.click(screen.getByText('guest.comments.retry'));

    await waitFor(() => {
      expect(screen.getByText('TEAM reply we will revise clause 4')).toBeInTheDocument();
    });
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });
});
