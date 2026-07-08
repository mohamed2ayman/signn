import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Contract } from '../../../database/entities/contract.entity';

/**
 * Signed-state pinning — Slice 2 (ENFORCEMENT): the single service-layer
 * mutation guard.
 *
 * Once a contract is pinned (Slice 1: pinned_version_id set the instant it
 * became FULLY_EXECUTED), every LEGAL-CONTENT mutation must be rejected with
 * the named domain error CONTRACT_PINNED (HTTP 409 — the
 * GUEST_UPLOAD_DAILY_LIMIT / EXISTING_ACCOUNT_EMAIL coded-envelope
 * precedent). The operational layer (comments, risk status/annotation,
 * obligations, claims/notices, chat, lifecycle ACTIVE→COMPLETED/TERMINATED)
 * is deliberately NOT guarded.
 *
 * Shape notes:
 *  - These are PURE transaction-aware functions taking an explicit
 *    EntityManager (pass `repo.manager` outside a transaction, the txn
 *    manager inside one) rather than an injectable service. Reason: the
 *    natural DI home (ContractPinningService) already injects
 *    ContractsService, so ContractsService injecting the guard back would
 *    be a DI cycle — and a new constructor dependency on ContractsService /
 *    DocumentProcessingService would churn every positional spec
 *    instantiation in the suite. A util is the least-invasive correct seam.
 *  - ORDERING: call AFTER the tenancy wall (findInOrg / findForGuest /
 *    scoped load). Cross-tenant must resolve as 404 FIRST — a
 *    CONTRACT_PINNED answer on a cross-org probe would leak existence.
 *  - Raw parameterized SQL (no getRepository) keeps the guard outside the
 *    no-bare-contract-repo-access rule's data-method surface; tenancy is the
 *    CALLER's responsibility (see ORDERING above).
 */

/** The machine-readable code the frontend keys on (lesson #220). */
export const CONTRACT_PINNED_ERROR = 'CONTRACT_PINNED';

export function contractPinnedException(message?: string): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: CONTRACT_PINNED_ERROR,
    message:
      message ??
      'This contract has been signed and its content is frozen. ' +
        'Clauses and contract terms can no longer be modified.',
  });
}

/** Non-throwing pin probe — for background writers that terminalize instead of throwing. */
export async function isContractPinned(
  em: EntityManager,
  contractId: string,
): Promise<boolean> {
  const rows: Array<{ pinned_version_id: string | null }> = await em.query(
    `SELECT pinned_version_id FROM contracts WHERE id = $1`,
    [contractId],
  );
  return Boolean(rows[0]?.pinned_version_id);
}

/**
 * Throw CONTRACT_PINNED (409) if the contract is pinned; no-op otherwise.
 * Accepts a loaded Contract entity (uses its pinned_version_id when the
 * field was actually selected) or a contract id. An entity whose
 * pinned_version_id is undefined (partial select) is defensively re-checked
 * against the DB — `undefined` must never silently read as "unpinned".
 */
export async function assertContractMutable(
  em: EntityManager,
  contractOrId: Contract | string,
): Promise<void> {
  if (typeof contractOrId === 'string') {
    if (await isContractPinned(em, contractOrId)) {
      throw contractPinnedException();
    }
    return;
  }
  if (contractOrId.pinned_version_id === undefined) {
    if (await isContractPinned(em, contractOrId.id)) {
      throw contractPinnedException();
    }
    return;
  }
  if (contractOrId.pinned_version_id) {
    throw contractPinnedException();
  }
}

/**
 * Clause-level guard — for writers that address a library Clause row with no
 * contract in scope (PUT /clauses/:id, review clause edits, bulk-approve).
 * A Clause row can back MULTIPLE contracts via contract_clauses, so an
 * in-place edit would silently mutate the live view of every referencing
 * contract; blocked when ANY referencing contract is pinned. Single indexed
 * join — no reference-graph traversal.
 */
export async function assertClauseMutable(
  em: EntityManager,
  clauseIdOrIds: string | string[],
): Promise<void> {
  const ids = Array.isArray(clauseIdOrIds) ? clauseIdOrIds : [clauseIdOrIds];
  if (ids.length === 0) return;
  const rows: Array<{ id: string }> = await em.query(
    `SELECT c.id
       FROM contracts c
       JOIN contract_clauses cc ON cc.contract_id = c.id
      WHERE cc.clause_id = ANY($1::uuid[])
        AND c.pinned_version_id IS NOT NULL
      LIMIT 1`,
    [ids],
  );
  if (rows.length > 0) {
    throw contractPinnedException(
      'This clause is part of a signed (pinned) contract and can no longer ' +
        'be modified. Create a new clause version instead.',
    );
  }
}
