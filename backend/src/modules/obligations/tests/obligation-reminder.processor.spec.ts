import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

import { ObligationReminderProcessor } from '../obligation-reminder.processor';
import { ObligationScopedRepository } from '../../scoped-repository/obligation-scoped.repository';
import {
  Contract,
  Obligation,
  ObligationReminderEmailStatus,
  ObligationReminderLog,
  ObligationReminderType,
  ObligationStatus,
  ObligationType,
  Project,
  User,
} from '../../../database/entities';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationDispatchService } from '../../notifications/notification-dispatch.service';
import { ObligationTokenService } from '../../compliance/services/obligation-token.service';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const CONTRACT_CREATOR: Partial<User> = {
  id: 'creator-uuid',
  email: 'creator@sign.com',
  first_name: 'Alice',
};

const ESCALATION_USER: Partial<User> = {
  id: 'escalation-user-uuid',
  email: 'escalation@sign.com',
  first_name: 'Bob',
};

const ASSIGNEE_USER: Partial<User> = {
  id: 'assignee-uuid',
  email: 'assignee@sign.com',
  first_name: 'Carol',
};

/** Builds a base obligation due in `daysFromNow` days */
function makeObligation(
  daysFromNow: number,
  overrides: Partial<Obligation> = {},
): Obligation {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + daysFromNow);

  return {
    id: 'obligation-uuid',
    contract_id: 'contract-uuid',
    description: 'Submit performance bond',
    status: daysFromNow < 0 ? ObligationStatus.OVERDUE : ObligationStatus.PENDING,
    obligation_type: ObligationType.PERFORMANCE_BOND,
    is_critical: false,
    due_date: dueDate,
    reminder_schedule: [30, 14, 7, 1],
    reminder_days_before: 7,
    last_reminder_sent_at: null,
    assignees: [],
    contract: {
      id: 'contract-uuid',
      name: 'NEC4 Main Contract',
      creator: CONTRACT_CREATOR as User,
      escalation_contact_user: null,
      escalation_contact_email: null,
    } as unknown as Contract,
    ...overrides,
  } as unknown as Obligation;
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository / service mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockObligationRepo = {
  find: jest.fn(),
  save: jest.fn().mockResolvedValue({}),
  update: jest.fn().mockResolvedValue({}),
};

const mockLogRepo = {
  findOne: jest.fn().mockResolvedValue(null), // no dedup by default
  insert: jest.fn().mockResolvedValue({}),
};

const mockUserRepo = {
  findOne: jest.fn().mockResolvedValue({ ...CONTRACT_CREATOR, email_digest_opt_out: false }),
};

const mockContractRepo = { findOne: jest.fn() };
const mockProjectRepo = { findOne: jest.fn() };

const mockNotificationsService = { create: jest.fn().mockResolvedValue({}) };

const mockDispatch = {
  enqueueEmail: jest.fn().mockResolvedValue(undefined),
  dispatchObligationReminder: jest.fn().mockResolvedValue(undefined),
};

const mockTokens = {
  issue: jest.fn().mockReturnValue({
    token: 'test-token-abc',
    nonce: 'nonce',
    expiresAt: new Date(),
  }),
};

const mockConfig = {
  get: jest.fn((key: string, fallback?: string) => fallback ?? ''),
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build processor
// ─────────────────────────────────────────────────────────────────────────────

async function buildProcessor(): Promise<ObligationReminderProcessor> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      ObligationReminderProcessor,
      // Option B (processor-sweep bucket): the processor now reads obligations
      // through ObligationScopedRepository.findAcrossAllOrgs. Provide a REAL
      // scoped repo wrapping the SAME mockObligationRepo — findAcrossAllOrgs is
      // a pure passthrough to repo.find(options), so every existing assertion on
      // `mockObligationRepo.find` (the sweep data source) stays byte-identical.
      {
        provide: ObligationScopedRepository,
        useFactory: () =>
          new ObligationScopedRepository(
            mockObligationRepo as unknown as Repository<Obligation>,
          ),
      },
      { provide: getRepositoryToken(Obligation), useValue: mockObligationRepo },
      { provide: getRepositoryToken(ObligationReminderLog), useValue: mockLogRepo },
      { provide: getRepositoryToken(Contract), useValue: mockContractRepo },
      { provide: getRepositoryToken(Project), useValue: mockProjectRepo },
      { provide: getRepositoryToken(User), useValue: mockUserRepo },
      { provide: NotificationsService, useValue: mockNotificationsService },
      { provide: NotificationDispatchService, useValue: mockDispatch },
      { provide: ObligationTokenService, useValue: mockTokens },
      { provide: ConfigService, useValue: mockConfig },
    ],
  }).compile();

  return moduleRef.get(ObligationReminderProcessor);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('ObligationReminderProcessor — Phase 7.1', () => {
  let processor: ObligationReminderProcessor;
  const fakeJob = {} as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockLogRepo.findOne.mockResolvedValue(null); // no dedup
    processor = await buildProcessor();
  });

  // ── Recipient selection ──────────────────────────────────────────────────

  describe('check-reminders — recipient selection', () => {
    it('sends email to assignees when they are set', async () => {
      const obligation = makeObligation(7, {
        assignees: [
          { user: ASSIGNEE_USER as User, user_id: ASSIGNEE_USER.id! } as any,
        ],
      });
      mockObligationRepo.find.mockResolvedValue([obligation]);

      await processor.handleCheckReminders(fakeJob);

      expect(mockDispatch.enqueueEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: ASSIGNEE_USER.email }),
      );
    });

    it('does NOT send to contract creator when assignees exist', async () => {
      const obligation = makeObligation(7, {
        assignees: [
          { user: ASSIGNEE_USER as User, user_id: ASSIGNEE_USER.id! } as any,
        ],
      });
      mockObligationRepo.find.mockResolvedValue([obligation]);

      await processor.handleCheckReminders(fakeJob);

      const calls = mockDispatch.enqueueEmail.mock.calls.map(
        (c: any[]) => (c[0] as { to: string }).to,
      );
      expect(calls).not.toContain(CONTRACT_CREATOR.email);
    });

    it('falls back to contract creator when no assignees are set', async () => {
      const obligation = makeObligation(7); // no assignees
      mockObligationRepo.find.mockResolvedValue([obligation]);

      await processor.handleCheckReminders(fakeJob);

      expect(mockDispatch.enqueueEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: CONTRACT_CREATOR.email }),
      );
    });

    it('skips the obligation entirely when no assignees and no creator email', async () => {
      const obligation = makeObligation(7, {
        contract: {
          id: 'contract-uuid',
          name: 'Broken Contract',
          creator: { id: 'creator-id' } as User, // no email
          escalation_contact_user: null,
          escalation_contact_email: null,
        } as unknown as Contract,
      });
      mockObligationRepo.find.mockResolvedValue([obligation]);

      await processor.handleCheckReminders(fakeJob);

      expect(mockDispatch.enqueueEmail).not.toHaveBeenCalled();
    });
  });

  // ── Escalation ──────────────────────────────────────────────────────────

  describe('check-reminders — OVERDUE escalation', () => {
    it('sends escalation email to escalation_contact_user for OVERDUE obligations', async () => {
      const obligation = makeObligation(-3, {
        status: ObligationStatus.OVERDUE,
        contract: {
          id: 'contract-uuid',
          name: 'NEC4 Main Contract',
          creator: CONTRACT_CREATOR as User,
          escalation_contact_user: ESCALATION_USER as User,
          escalation_contact_email: null,
        } as unknown as Contract,
      });
      mockObligationRepo.find.mockResolvedValue([obligation]);

      await processor.handleCheckReminders(fakeJob);

      const allRecipients = mockDispatch.enqueueEmail.mock.calls.map(
        (c: any[]) => (c[0] as { to: string }).to,
      );
      expect(allRecipients).toContain(ESCALATION_USER.email);
    });

    it('sends escalation to external email when escalation_contact_user is absent', async () => {
      const EXTERNAL_EMAIL = 'external@contractor.com';
      const obligation = makeObligation(-3, {
        status: ObligationStatus.OVERDUE,
        contract: {
          id: 'contract-uuid',
          name: 'NEC4 Main Contract',
          creator: CONTRACT_CREATOR as User,
          escalation_contact_user: null,
          escalation_contact_email: EXTERNAL_EMAIL,
        } as unknown as Contract,
      });
      mockObligationRepo.find.mockResolvedValue([obligation]);

      await processor.handleCheckReminders(fakeJob);

      const allRecipients = mockDispatch.enqueueEmail.mock.calls.map(
        (c: any[]) => (c[0] as { to: string }).to,
      );
      expect(allRecipients).toContain(EXTERNAL_EMAIL);
    });

    it('does NOT escalate when no escalation contact is set', async () => {
      const obligation = makeObligation(-3, {
        status: ObligationStatus.OVERDUE,
        // contract already has no escalation_contact_* in makeObligation
      });
      mockObligationRepo.find.mockResolvedValue([obligation]);

      await processor.handleCheckReminders(fakeJob);

      // Only the primary recipient (creator) should receive the email
      expect(mockDispatch.enqueueEmail).toHaveBeenCalledTimes(1);
    });
  });

  // ── In-app notifications ─────────────────────────────────────────────────

  describe('check-reminders — in-app notifications', () => {
    it('creates an in-app notification for each platform-user recipient', async () => {
      const obligation = makeObligation(7); // creator only
      mockObligationRepo.find.mockResolvedValue([obligation]);

      await processor.handleCheckReminders(fakeJob);

      expect(mockDispatch.dispatchObligationReminder).toHaveBeenCalledWith(
        expect.objectContaining({
          obligationId: obligation.id,
          userId: CONTRACT_CREATOR.id,
          tier: ObligationReminderType.DAYS_7,
          contractName: 'NEC4 Main Contract',
        }),
      );
    });

    it('creates in-app notification for OVERDUE tier', async () => {
      const obligation = makeObligation(-3, {
        status: ObligationStatus.OVERDUE,
      });
      mockObligationRepo.find.mockResolvedValue([obligation]);

      await processor.handleCheckReminders(fakeJob);

      expect(mockDispatch.dispatchObligationReminder).toHaveBeenCalledWith(
        expect.objectContaining({
          tier: ObligationReminderType.OVERDUE,
        }),
      );
    });
  });

  // ── Per-obligation reminder_schedule ─────────────────────────────────────

  describe('check-reminders — custom reminder_schedule', () => {
    it('fires DAYS_7 tier at 5 days out with default [30, 14, 7, 1] schedule', async () => {
      const obligation = makeObligation(5); // 5 days → inside the 7-day window
      mockObligationRepo.find.mockResolvedValue([obligation]);

      await processor.handleCheckReminders(fakeJob);

      expect(mockLogRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          reminder_type: ObligationReminderType.DAYS_7,
        }),
      );
    });

    it('does NOT fire when days > all schedule thresholds (e.g. 45 days out, schedule [7, 1])', async () => {
      const obligation = makeObligation(45, {
        reminder_schedule: [7, 1], // custom: only 7-day and 1-day
      });
      mockObligationRepo.find.mockResolvedValue([obligation]);

      await processor.handleCheckReminders(fakeJob);

      expect(mockDispatch.enqueueEmail).not.toHaveBeenCalled();
    });

    it('fires DAYS_1 tier when obligation has custom [7, 1] and is 6 days out', async () => {
      // 6 days out: 6 <= 7 → matches threshold 7 → DAYS_7 tier
      const obligation = makeObligation(6, {
        reminder_schedule: [7, 1],
      });
      mockObligationRepo.find.mockResolvedValue([obligation]);

      await processor.handleCheckReminders(fakeJob);

      expect(mockLogRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          reminder_type: ObligationReminderType.DAYS_7,
        }),
      );
    });

    it('skips already-sent reminder type (dedup via log)', async () => {
      const obligation = makeObligation(5); // 5 days → DAYS_7
      mockObligationRepo.find.mockResolvedValue([obligation]);

      // Simulate existing log entry for DAYS_7
      mockLogRepo.findOne.mockResolvedValue({
        id: 'log-uuid',
        obligation_id: obligation.id,
        reminder_type: ObligationReminderType.DAYS_7,
      });

      await processor.handleCheckReminders(fakeJob);

      expect(mockDispatch.enqueueEmail).not.toHaveBeenCalled();
    });

    it('flips status to OVERDUE when days < 0', async () => {
      const obligation = makeObligation(-2, {
        status: ObligationStatus.PENDING, // not yet flipped
      });
      mockObligationRepo.find.mockResolvedValue([obligation]);

      await processor.handleCheckReminders(fakeJob);

      expect(mockObligationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ObligationStatus.OVERDUE }),
      );
    });
  });

  // ── Dedup log record ─────────────────────────────────────────────────────

  describe('check-reminders — reminder log', () => {
    it('writes a log record after successfully sending', async () => {
      const obligation = makeObligation(7);
      mockObligationRepo.find.mockResolvedValue([obligation]);

      await processor.handleCheckReminders(fakeJob);

      expect(mockLogRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          obligation_id: obligation.id,
          reminder_type: ObligationReminderType.DAYS_7,
          email_status: ObligationReminderEmailStatus.SENT,
        }),
      );
    });
  });

  // ── All-orgs sweep (escape-hatch behaviour — Option B processor bucket) ────
  // The processor reads via ObligationScopedRepository.findAcrossAllOrgs, the
  // named tenancy bypass. The REQUIRED property is that the sweep sees EVERY
  // org's obligations — a regression that imposed an org filter would silently
  // stop reminders for all but one org. (Request-unreachability of the bypass
  // is proven structurally in findacrossallorgs-escape-hatch.spec.ts.)
  describe('check-reminders — all-orgs sweep', () => {
    it('processes obligations from MULTIPLE orgs in one pass (no org filter imposed)', async () => {
      const orgAObligation = makeObligation(7, {
        id: 'obl-orgA',
        contract_id: 'contract-orgA',
        contract: {
          id: 'contract-orgA',
          name: 'Org A Contract',
          creator: {
            id: 'orgA-creator',
            email: 'orgA@sign.com',
            first_name: 'A',
          } as User,
          escalation_contact_user: null,
          escalation_contact_email: null,
        } as unknown as Contract,
      });
      const orgBObligation = makeObligation(7, {
        id: 'obl-orgB',
        contract_id: 'contract-orgB',
        contract: {
          id: 'contract-orgB',
          name: 'Org B Contract',
          creator: {
            id: 'orgB-creator',
            email: 'orgB@sign.com',
            first_name: 'B',
          } as User,
          escalation_contact_user: null,
          escalation_contact_email: null,
        } as unknown as Contract,
      });
      mockObligationRepo.find.mockResolvedValue([orgAObligation, orgBObligation]);

      await processor.handleCheckReminders(fakeJob);

      const recipients = mockDispatch.enqueueEmail.mock.calls.map(
        (c: any[]) => (c[0] as { to: string }).to,
      );
      // BOTH orgs' obligations were reminded — the sweep is genuinely all-orgs.
      expect(recipients).toContain('orgA@sign.com');
      expect(recipients).toContain('orgB@sign.com');

      // And the underlying read carried NO org filter — only the status/relations
      // sweep shape. A leaked org predicate here would be a regression.
      const findArg = mockObligationRepo.find.mock.calls[0][0];
      expect(findArg.where).toHaveProperty('status');
      expect(JSON.stringify(findArg)).not.toMatch(/organization/i);
    });
  });
});
