import { BadRequestException } from '@nestjs/common';
import { ErpAdminService } from '../services/erp-admin.service';
import {
  ErpConnection,
  ErpOperatorHoldState,
} from '../entities/erp-connection.entity';
import { SECURITY_EVENT_TYPES } from '../../../common/enums/security-event-types';

/**
 * Phase 7.28 v1.1 — ErpAdminService unit tests (no DB).
 *
 * Covers the guards (already-held / not-held / delete-without-hold) and the
 * notify-resilience invariant (a notification failure must NEVER roll back the
 * suspension). Full round-trips + real audit rows are covered by the real-DB
 * integration spec.
 */
function makeConn(overrides: Partial<ErpConnection> = {}): ErpConnection {
  return {
    id: 'conn-1',
    organization_id: 'org-1',
    vendor: 'MOCK',
    name: 'Acme ERP',
    base_url: null,
    credentials_encrypted: null,
    capabilities_snapshot: null,
    enabled: true,
    status: 'active' as any,
    operator_hold_state: ErpOperatorHoldState.NONE,
    hold_reason: null,
    hold_by_user_id: null,
    hold_at: null,
    consecutive_failures: 0,
    last_sync_at: null,
    error_message: null,
    field_mappings: [],
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  } as ErpConnection;
}

function makeService(conn: ErpConnection, deps: Partial<{
  recordAtomic: jest.Mock;
  record: jest.Mock;
  dispatch: jest.Mock;
  find: jest.Mock;
}> = {}) {
  const em = { update: jest.fn(), delete: jest.fn() };
  const recordAtomic =
    deps.recordAtomic ?? jest.fn(async (_input: any, work: any) => work(em));
  const record = deps.record ?? jest.fn();
  const dispatch = deps.dispatch ?? jest.fn();
  const find = deps.find ?? jest.fn().mockResolvedValue([]);

  const connRepo = { findOne: jest.fn().mockResolvedValue(conn) };
  const userRepo = { find };
  const queue = { add: jest.fn() };
  const securityEvents = { recordAtomic, record };
  const dispatcher = { dispatch };
  const config = { get: jest.fn((_k: string, d: any) => d) };

  const service = new ErpAdminService(
    connRepo as any,
    userRepo as any,
    queue as any,
    securityEvents as any,
    dispatcher as any,
    config as any,
  );
  return { service, connRepo, recordAtomic, record, dispatch, find, em, queue };
}

describe('ErpAdminService — guards & resilience', () => {
  it('suspend rejects when the connection is already on a hold', async () => {
    const { service } = makeService(
      makeConn({ operator_hold_state: ErpOperatorHoldState.OPERATOR_SUSPENDED }),
    );
    await expect(service.suspend('conn-1', 'admin-1', 'dupe')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('unsuspend rejects when there is no hold', async () => {
    const { service } = makeService(makeConn({ operator_hold_state: ErpOperatorHoldState.NONE }));
    await expect(service.unsuspend('conn-1', 'admin-1', 'why')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('guarded delete rejects when the connection is not suspended', async () => {
    const { service } = makeService(makeConn({ operator_hold_state: ErpOperatorHoldState.NONE }));
    await expect(service.remove('conn-1', 'admin-1', 'cleanup')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('guarded delete is allowed when the connection is held', async () => {
    const { service, recordAtomic, em } = makeService(
      makeConn({ operator_hold_state: ErpOperatorHoldState.AUTO_SUSPENDED }),
    );
    const res = await service.remove('conn-1', 'admin-1', 'cleanup');
    expect(res).toEqual({ deleted: true, id: 'conn-1' });
    expect(recordAtomic).toHaveBeenCalledTimes(1);
    expect(em.delete).toHaveBeenCalledWith(ErpConnection, 'conn-1');
  });

  it('guarded delete dispatches a distinct "removed" notification to org admins', async () => {
    const dispatch = jest.fn();
    const find = jest.fn().mockResolvedValue([{ id: 'owner-1', email: 'o@x.com' }]);
    const { service } = makeService(
      makeConn({ operator_hold_state: ErpOperatorHoldState.OPERATOR_SUSPENDED }),
      { dispatch, find },
    );
    await service.remove('conn-1', 'admin-1', 'decommission');
    expect(dispatch).toHaveBeenCalledTimes(1);
    const arg = dispatch.mock.calls[0][0];
    expect(arg.title).toBe('ERP Connection Removed');
    expect(arg.relatedEntityId).toBe('conn-1');
    expect(arg.type).toBe('BOTH');
    expect(arg.email.templateName).toBe('erp-removed');
    expect(arg.message).toContain('decommission'); // reason included
  });

  it('a delete notification failure does NOT roll back the delete', async () => {
    const dispatch = jest.fn().mockRejectedValue(new Error('smtp down'));
    const find = jest.fn().mockResolvedValue([{ id: 'owner-1', email: 'o@x.com' }]);
    const { service, em } = makeService(
      makeConn({ operator_hold_state: ErpOperatorHoldState.OPERATOR_SUSPENDED }),
      { dispatch, find },
    );
    await expect(service.remove('conn-1', 'admin-1', 'reason')).resolves.toEqual({
      deleted: true,
      id: 'conn-1',
    });
    expect(em.delete).toHaveBeenCalledWith(ErpConnection, 'conn-1');
  });

  it('suspend writes the audit event and applies the hold (work runs in the txn)', async () => {
    const { service, recordAtomic, em } = makeService(makeConn());
    await service.suspend('conn-1', 'admin-1', 'maintenance');
    const [input] = recordAtomic.mock.calls[0];
    expect(input.type).toBe(SECURITY_EVENT_TYPES.ERP_CONNECTION_SUSPENDED);
    expect(input.actor_id).toBe('admin-1');
    expect(input.organization_id).toBe('org-1');
    expect(input.entity_type).toBe('erp_connection');
    expect(input.metadata.reason).toBe('maintenance');
    expect(em.update).toHaveBeenCalledWith(
      ErpConnection,
      'conn-1',
      expect.objectContaining({
        operator_hold_state: ErpOperatorHoldState.OPERATOR_SUSPENDED,
        hold_by_user_id: 'admin-1',
      }),
    );
  });

  it('a notification failure does NOT roll back the suspension', async () => {
    const dispatch = jest.fn().mockRejectedValue(new Error('smtp down'));
    const find = jest.fn().mockResolvedValue([{ id: 'owner-1', email: 'o@x.com' }]);
    const { service, recordAtomic } = makeService(makeConn(), { dispatch, find });
    // Resolves despite dispatch throwing (notify is best-effort, post-txn).
    await expect(service.suspend('conn-1', 'admin-1', 'reason')).resolves.toBeDefined();
    expect(recordAtomic).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalled();
  });

  it('autoSuspend is a no-op when a hold already exists', async () => {
    const { service, recordAtomic } = makeService(
      makeConn({ operator_hold_state: ErpOperatorHoldState.OPERATOR_SUSPENDED }),
    );
    await service.autoSuspend('conn-1', 'breaker');
    expect(recordAtomic).not.toHaveBeenCalled();
  });
});
