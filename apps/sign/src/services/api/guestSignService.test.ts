import {
  acceptAndExecuteContract,
  classifyAcceptError,
  getGuestSignSlip,
} from './guestSignService';
import { guestHttp } from './guestHttp';

// Service-level isolation: mock the ISOLATED guest client, never global axios
// (Phase 2.2 rule — axios.ts pulls the Redux store as a side effect).
vi.mock('./guestHttp', () => ({
  guestHttp: { post: vi.fn(), get: vi.fn() },
  GUEST_API_BASE_URL: 'http://test/api/v1',
}));

const mockedPost = vi.mocked(guestHttp.post);
const mockedGet = vi.mocked(guestHttp.get);

const httpErr = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: { status },
  });
/** An axios error with NO response (request sent, none received). */
const networkErr = () =>
  Object.assign(new Error('Network Error'), {
    isAxiosError: true,
    request: {},
  });
/** A guestHttp timeout. */
const timeoutErr = () =>
  Object.assign(new Error('timeout of 15000ms exceeded'), {
    isAxiosError: true,
    code: 'ECONNABORTED',
  });

const EXECUTED = {
  slip_id: 's-1',
  status: 'EXECUTED' as const,
  granted_at: 'now',
  accepted_at: 'now',
  accepted_content_hash: 'a'.repeat(64),
};

describe('guestSignService — getGuestSignSlip render gate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the slip on 200 with the explicit Bearer JWT', async () => {
    mockedGet.mockResolvedValue({ data: { ...EXECUTED, status: 'PENDING' } });
    const slip = await getGuestSignSlip('c1', 'jwt-1');
    expect(mockedGet).toHaveBeenCalledWith('/guest/contracts/c1/sign-slip', {
      headers: { Authorization: 'Bearer jwt-1' },
    });
    expect(slip?.status).toBe('PENDING');
  });

  it('maps a uniform 404 to null (no active slip — the common viewer case)', async () => {
    mockedGet.mockRejectedValue(httpErr(404));
    await expect(getGuestSignSlip('c1', 'jwt-1')).resolves.toBeNull();
  });

  it('rethrows a non-404 failure', async () => {
    mockedGet.mockRejectedValue(httpErr(500));
    await expect(getGuestSignSlip('c1', 'jwt-1')).rejects.toBeTruthy();
  });
});

describe('guestSignService — acceptAndExecuteContract outcome classification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('posts to the accept route with the explicit Bearer JWT', async () => {
    mockedPost.mockResolvedValue({
      data: { ...EXECUTED, executed: true, already_pinned: false },
    });
    await acceptAndExecuteContract('c1', 'jwt-1');
    expect(mockedPost).toHaveBeenCalledWith(
      '/guest/contracts/c1/sign-slip/accept',
      {},
      { headers: { Authorization: 'Bearer jwt-1' } },
    );
  });

  it('200 + executed + NOT already-pinned → success', async () => {
    mockedPost.mockResolvedValue({
      data: { ...EXECUTED, executed: true, already_pinned: false },
    });
    const out = await acceptAndExecuteContract('c1', 'jwt-1');
    expect(out.kind).toBe('success');
    expect(out).toMatchObject({ result: { status: 'EXECUTED' } });
  });

  it('⭐ 200 + executed + already-pinned → already_executed (SUCCESS, never "not executed")', async () => {
    mockedPost.mockResolvedValue({
      data: { ...EXECUTED, executed: true, already_pinned: true },
    });
    const out = await acceptAndExecuteContract('c1', 'jwt-1');
    expect(out.kind).toBe('already_executed');
  });

  it('a 200 that does not report execution is generic (never a false success)', async () => {
    mockedPost.mockResolvedValue({
      data: { ...EXECUTED, executed: false, already_pinned: false },
    });
    const out = await acceptAndExecuteContract('c1', 'jwt-1');
    expect(out.kind).toBe('generic');
  });

  it('⭐ 404 → gone', async () => {
    mockedPost.mockRejectedValue(httpErr(404));
    expect((await acceptAndExecuteContract('c1', 'jwt-1')).kind).toBe('gone');
  });

  it('⭐ network error → transient', async () => {
    mockedPost.mockRejectedValue(networkErr());
    expect((await acceptAndExecuteContract('c1', 'jwt-1')).kind).toBe(
      'transient',
    );
  });

  it('⭐ timeout (ECONNABORTED) → transient', async () => {
    mockedPost.mockRejectedValue(timeoutErr());
    expect((await acceptAndExecuteContract('c1', 'jwt-1')).kind).toBe(
      'transient',
    );
  });

  it('401 folds into transient (reconnect / re-auth)', async () => {
    mockedPost.mockRejectedValue(httpErr(401));
    expect((await acceptAndExecuteContract('c1', 'jwt-1')).kind).toBe(
      'transient',
    );
  });

  it('other HTTP statuses (400 / 409 / 500) → generic', async () => {
    for (const s of [400, 409, 500]) {
      mockedPost.mockRejectedValueOnce(httpErr(s));
      expect((await acceptAndExecuteContract('c1', 'jwt-1')).kind).toBe(
        'generic',
      );
    }
  });
});

describe('classifyAcceptError — direct unit', () => {
  it('404 → gone; 401 → transient; other status → generic', () => {
    expect(classifyAcceptError(httpErr(404)).kind).toBe('gone');
    expect(classifyAcceptError(httpErr(401)).kind).toBe('transient');
    expect(classifyAcceptError(httpErr(422)).kind).toBe('generic');
  });

  it('no response (network / timeout) → transient; unknown throw → generic', () => {
    expect(classifyAcceptError(networkErr()).kind).toBe('transient');
    expect(classifyAcceptError(timeoutErr()).kind).toBe('transient');
    expect(classifyAcceptError(new Error('unexpected')).kind).toBe('generic');
  });
});
