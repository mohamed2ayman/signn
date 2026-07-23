import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

import {
  AccountType,
  ContractComment,
  GuestContractAccess,
  GuestInvitation,
  GuestInvitationStatus,
  User,
  UserRole,
} from '../../../database/entities';
import { AuthService } from '../../auth/auth.service';
import { AccountLockoutService } from '../../auth/services/account-lockout.service';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { GuestInvitationScopedRepository } from '../../scoped-repository/guest-invitation-scoped.repository';
import { CreateGuestInvitationDto } from '../dto/create-guest-invitation.dto';
import {
  EstablishIdentityDto,
  GuestIntentKind,
} from '../dto/establish-identity.dto';
import { InvitationTokenService } from './invitation-token.service';
import { ViewerCredentialService } from './viewer-credential.service';

/**
 * Phase 7.18 bucket 1b-ii — same salt rounds as AuthService uses for
 * registration / accept-invitation / reset (default 12 in this codebase).
 * Imported here to keep guest-identity creation off the same hashing
 * contract without taking a runtime dep on AuthService internals.
 */
const BCRYPT_SALT_ROUNDS = 12;

/**
 * Scrubbed comment projection returned to an external guest. Deliberately
 * carries ONLY what the guest UI renders — never the raw author User
 * (no email / role / account_type). `author_role` is the guest-vs-team flag.
 */
export interface GuestVisibleComment {
  id: string;
  contract_id: string;
  contract_clause_id: string | null;
  content: string;
  created_at: Date;
  author_name: string;
  author_role: 'GUEST' | 'TEAM';
}

/**
 * Phase 7.18 bucket 1b-i — orchestration for the guest-invitation flow.
 *
 * Three operations:
 *
 *   create()   — authenticated managing user creates an invitation for
 *                a contract they can access. Scopes ownership via
 *                ContractAccessService.findInOrg.
 *
 *   revoke()   — authenticated managing user revokes an invitation.
 *                Idempotent: revoking an already-revoked invitation
 *                returns the same row without flipping accepted_at.
 *
 *   exchange() — PUBLIC (no JWT). Verifies the long-lived invitation
 *                token, returns a SHORT-LIVED viewer credential plus
 *                the minimum landing info (contract id + invited
 *                language). NEVER returns the invitation token back to
 *                the caller and NEVER reuses the invitation token as a
 *                contract-read credential.
 *
 * Email send is intentionally absent in 1b-i (bucket 7 owns delivery).
 * The create() return value carries the raw token so a developer can
 * paste it into a probe; a TODO marker indicates the seam where
 * EmailService will later attach.
 */
@Injectable()
export class GuestInvitationService {
  private readonly logger = new Logger(GuestInvitationService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(GuestInvitation) // lint-exempt: write-path repo (create + revoke save); the by-id READ goes through GuestInvitationScopedRepository — the chokepoint is read-only
    private readonly invitationRepo: Repository<GuestInvitation>,
    private readonly contractAccess: ContractAccessService,
    private readonly tokenService: InvitationTokenService,
    private readonly viewerService: ViewerCredentialService,
    private readonly dataSource: DataSource,
    private readonly authService: AuthService,
    // Option B chokepoint (migration 2/4) — layer 2 for the revoke by-id load.
    private readonly invitationScoped: GuestInvitationScopedRepository,
    // Shared account-level lockout — the SAME control the login path uses, so
    // the establish-identity password-verify branch (which grants cross-org
    // bindings) is not a weaker brute-force door than login.
    private readonly accountLockout: AccountLockoutService,
  ) {}

  async create(
    dto: CreateGuestInvitationDto,
    creator: { id: string; organization_id: string | null },
  ): Promise<{ invitation: GuestInvitation; token: string }> {
    // Scope check — the creator MUST be able to access the contract
    // they're inviting against, under their current org. This routes
    // through the existing ContractAccessService authority (1a).
    if (!creator.organization_id) {
      throw new NotFoundException('Contract not found');
    }
    // findInOrg throws NotFoundException if the contract isn't in the
    // caller's org. We don't need the contract object itself — only the
    // assertion.
    await this.contractAccess.findInOrg(dto.contract_id, creator.organization_id);

    const ttlDays = this.inviteTtlDays();
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    const invitation = this.invitationRepo.create({
      contract_id: dto.contract_id,
      invited_email: dto.invited_email,
      invited_language: dto.invited_language ?? 'en',
      status: GuestInvitationStatus.PENDING,
      expires_at: expiresAt,
      created_by: creator.id,
    });
    const saved = await this.invitationRepo.save(invitation); // lint-exempt: write (create insert); wall-protected (findInOrg on dto.contract_id above) — chokepoint is read-only

    const token = this.tokenService.issue(saved.id, expiresAt);

    // TODO(bucket-7): hand the token to EmailService here so the
    // invited recipient receives a landing link. Until then, the
    // create endpoint logs the token (dev only) and returns it in the
    // response body so the inviter can ferry it manually.
    this.logger.log(
      `Guest invitation ${saved.id} created for ${saved.invited_email} → contract ${dto.contract_id} (ttl ${ttlDays}d)`,
    );

    return { invitation: saved, token };
  }

  async revoke(
    invitationId: string,
    actor: { id: string; organization_id: string | null },
  ): Promise<GuestInvitation> {
    // A guest invitation is a contract-scoped entity; a revoker with no org can
    // never resolve to one. Guard the org BEFORE the scoped load (which requires
    // the caller's real org as its tenancy gate). 404, never 403 — no existence
    // leak.
    if (!actor.organization_id) {
      throw new NotFoundException('Invitation not found');
    }

    // SCOPED LOAD (tenancy — Option B chokepoint 2/4, layer 2): resolve the
    // invitation through the canonical invitation → contract → project →
    // organization_id join. A cross-org invitation id yields the
    // no-existence-leak 404 ('Invitation not found') here, at the data layer,
    // INDEPENDENTLY of the wall below. The scoped row carries every GuestInvitation
    // column (the gate inner-joins for filtering, not selecting), so it is mutated
    // and saved directly — same shape as DocumentProcessingService.updateExtractedText.
    const invitation = await this.invitationScoped.scopedFindByIdOrThrow(
      invitationId,
      actor.organization_id,
    );

    // WALL (persona — bucket 1b-i, layer 1): STAYS as live defense-in-depth,
    // keyed on the scoped row's OWN contract_id. findInOrg re-proves the parent
    // contract is in the caller's org through ContractAccessService — the same
    // authority the create path uses. Two checks, two layers (CLAUDE.md Option
    // B); KEPT inline, never a swap.
    await this.contractAccess.findInOrg(
      invitation.contract_id,
      actor.organization_id,
    );

    // Idempotent: a re-revoke just returns the existing row.
    if (
      invitation.status === GuestInvitationStatus.REVOKED ||
      invitation.revoked_at !== null
    ) {
      return invitation;
    }

    invitation.status = GuestInvitationStatus.REVOKED;
    invitation.revoked_at = new Date();
    return this.invitationRepo.save(invitation); // lint-exempt: write (revoke status update) of the scoped-validated row — chokepoint is read-only
  }

  /**
   * PUBLIC. Verify the long-lived token and mint a short-lived viewer
   * credential. The invitation token is NEVER returned to the caller
   * after exchange — only the viewer credential.
   */
  async exchange(token: string): Promise<{
    viewer_token: string;
    viewer_expires_at: Date;
    contract_id: string;
    invited_language: string;
  }> {
    const result = await this.tokenService.verify(token);
    if (!result.ok) {
      // Single generic 401 — never leak which axis failed.
      // (malformed | invalid_signature | expired | revoked | not_found)
      throw new UnauthorizedException('Invalid invitation token');
    }
    const { invitation } = result;

    // Stamp accepted_at on first successful exchange (idempotent —
    // subsequent exchanges within TTL leave accepted_at as the first).
    if (
      invitation.status === GuestInvitationStatus.PENDING ||
      invitation.accepted_at === null
    ) {
      invitation.status = GuestInvitationStatus.ACCEPTED;
      invitation.accepted_at = invitation.accepted_at ?? new Date();
      await this.invitationRepo.save(invitation); // lint-exempt: PUBLIC token-gated path (exchange); HMAC token is the auth, no request org to scope by — chokepoint is read-only/org-scoped
    }

    const { token: viewerToken, expires_at: viewerExpiresAt } =
      this.viewerService.issue(invitation.contract_id, invitation.id);

    return {
      viewer_token: viewerToken,
      viewer_expires_at: viewerExpiresAt,
      contract_id: invitation.contract_id,
      invited_language: invitation.invited_language,
    };
  }

  /**
   * Phase 7.18 bucket 1b-ii — the atomic viewer→guest-user transition.
   *
   * Inputs: a valid invitation token + a new password + a captured intent
   * (what the recipient was trying to do that needed identity).
   *
   * Inside ONE transaction:
   *   1. SELECT FOR UPDATE the invitation row — serializes concurrent
   *      identity-creation calls against the same invitation.
   *   2. Verify the invitation is not revoked / not expired. (Status
   *      ACCEPTED is allowed because 1b-i exchange flips it ACCEPTED on
   *      first call; the real gating axes are revoke + expiry, plus
   *      "already linked to a user?" — checked next.)
   *   3. RACE GUARD: if a guest user with the invited email already
   *      exists AND has a binding to this contract, this is a repeat
   *      identity-creation call. We do NOT create a second row. We
   *      verify the supplied password matches the stored hash (so the
   *      caller has to be the same actor, not someone else who got
   *      the token), then return the existing user.
   *   4. Otherwise: INSERT the guest user, INSERT the binding (unique
   *      constraint on (user_id, contract_id) is a belt-and-braces),
   *      UPDATE the invitation row to ACCEPTED.
   *   5. COMMIT.
   *
   * AFTER commit (NOT inside the transaction): issue the standard JWT
   * pair via AuthService.issueGuestSession so a session-tracking blip
   * cannot roll back the identity transition. Resume-intent dispatch
   * runs AFTER token issuance — if COMMENT, the comment is written via
   * the same transaction-less mutator the guest-comment endpoint uses;
   * SIGN/UPLOAD are seam markers only (see resume-intent return shape).
   *
   * On UNIQUE-key collisions inside the transaction (e.g. two concurrent
   * requests both passed the SELECT-FOR-UPDATE check on a re-tried
   * invitation), the second transaction's COMMIT throws and the caller
   * sees a 409 — they can safely retry, which will hit the race-guard
   * branch above.
   */
  async establishIdentity(
    dto: EstablishIdentityDto,
    ctx: { ip?: string | null; user_agent?: string | null } = {},
  ): Promise<{
    user: any;
    // Null when requires_login is true (MFA-enabled real account — no
    // session is minted on this endpoint; see the POST-COMMIT branch).
    access_token: string | null;
    refresh_token: string | null;
    /** Set for MFA-enabled real accounts: binding attached, sign in normally. */
    requires_login?: boolean;
    contract_id: string;
    resume: {
      kind: GuestIntentKind | null;
      // Set to the canonical route to land on after upgrade. comment →
      // null because the comment was already posted inline. sign /
      // upload → the route the frontend should navigate to.
      route: string | null;
      // For COMMENT resumption — the saved comment id (so the frontend
      // can scroll to / highlight it).
      created_comment_id?: string;
    };
  }> {
    // Verify the invitation token BEFORE opening a transaction — no
    // point holding a DB transaction open across a (rejected) HMAC check.
    const verify = await this.tokenService.verify(dto.token);
    if (!verify.ok) {
      throw new UnauthorizedException('Invalid invitation token');
    }
    const invitationId = verify.invitation.id;
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);

    // Account-lockout bookkeeping is captured inside the transaction but
    // applied OUTSIDE it: the failed-attempt increment must survive the
    // rollback the 401 triggers (so the counter persists), exactly as login
    // increments outside any transaction. The success reset runs post-commit.
    let wrongPasswordUser:
      | Pick<User, 'id' | 'email' | 'failed_login_attempts'>
      | null = null;
    let resetLockoutUser: Pick<User, 'id'> | null = null;

    // The atomic block. Anything that throws inside this rolls back.
    const result = await this.dataSource.transaction(async (manager) => {
      const invitationRepo = manager.getRepository(GuestInvitation); // lint-exempt: PUBLIC token-gated path (establish-identity); transactional SELECT-FOR-UPDATE by token-derived id, no request org — chokepoint is read-only/org-scoped
      const userRepo = manager.getRepository(User);
      const accessRepo = manager.getRepository(GuestContractAccess); // lint-exempt: PUBLIC token-gated path (establish-identity); transactional binding write, no request org — chokepoint is read-only/org-scoped

      // 1. SELECT FOR UPDATE — pessimistic lock on the invitation row.
      //    Two concurrent calls to establishIdentity(<same invitation>)
      //    serialize here.
      const invitation = await invitationRepo
        .createQueryBuilder('inv')
        .setLock('pessimistic_write')
        .where('inv.id = :id', { id: invitationId })
        .getOne();
      if (!invitation) {
        throw new UnauthorizedException('Invalid invitation token');
      }

      // 2. Defensive re-check of revoke / expiry under the lock.
      if (
        invitation.status === GuestInvitationStatus.REVOKED ||
        invitation.revoked_at !== null
      ) {
        throw new UnauthorizedException('Invalid invitation token');
      }
      if (
        !invitation.expires_at ||
        invitation.expires_at.getTime() <= Date.now()
      ) {
        throw new UnauthorizedException('Invalid invitation token');
      }

      // 3. UNIFIED MEMBERSHIP — one identity per email (UQ_users_email).
      //    Look up ANY existing account with the invited email — GUEST or
      //    real (MANAGING/FREE). Whatever row exists is the ONE identity the
      //    invitation attaches to; we never create a second row for the same
      //    email (that was Slice 0's 500) and never fork a parallel guest
      //    identity for a real customer.
      //
      //    Branch matrix:
      //      (i)   no row            → create GUEST user + binding (step 4).
      //      (ii)  GUEST row         → verify password against the EXISTING
      //                                hash; attach a binding for THIS
      //                                contract if missing (multi-contract
      //                                guests — the schema always allowed it).
      //      (iii) MANAGING/FREE row → REAL-ACCOUNT VERIFY: the password is
      //                                checked against their EXISTING hash
      //                                (never set, never overwritten — no
      //                                auth clobber; org / sessions
      //                                untouched); the binding attaches to
      //                                their EXISTING row. Replaces Slice 0's
      //                                EXISTING_ACCOUNT_EMAIL 409 dead-end.
      //      wrong password          → 401 (anti-impersonation: a stolen
      //                                invitation token cannot hijack the
      //                                account or bind onto it).
      //    The old "identity exists without a binding — operator
      //    intervention" 409 is gone: that state is now simply branch
      //    (ii)/(iii) — verify, then attach the missing binding.
      const existingUser = await userRepo.findOne({
        where: { email: invitation.invited_email },
      });
      if (existingUser) {
        // Deactivated accounts are refused here exactly as login refuses them
        // (auth.service.ts login(): 403 'Account has been deactivated', checked
        // BEFORE lockout and the password compare). A stolen invitation token
        // must not reactivate access to — or bind onto — a disabled account.
        // Inside the txn: nothing has been written, so the rollback is a no-op.
        if (!existingUser.is_active) {
          throw new ForbiddenException('Account has been deactivated');
        }

        // Account-level lockout — the SAME control login uses (shared
        // AccountLockoutService). A locked account is refused BEFORE the
        // password is checked (403), so this cross-org-binding door is not a
        // weaker brute-force path than login. Runs inside the txn: on a locked
        // account nothing has been written, so the rollback is a no-op.
        this.accountLockout.assertNotLocked(existingUser);

        // Verify the caller owns the account BEFORE any state change. The
        // stored hash is the existing account's password (guest or real
        // alike) — it is never modified here.
        const passwordOk = await bcrypt.compare(
          dto.password,
          existingUser.password_hash,
        );
        if (!passwordOk) {
          // Capture the target so the durable failed-attempt increment can run
          // AFTER this transaction rolls back (see the .catch below) — the
          // counter must persist even though the 401 undoes the txn.
          wrongPasswordUser = existingUser;
          throw new UnauthorizedException('Invalid password');
        }

        // Correct password → clear any prior failed attempts on success (the
        // login-parity reset), applied post-commit.
        if (existingUser.failed_login_attempts > 0 || existingUser.locked_until) {
          resetLockoutUser = existingUser;
        }

        const existingBinding = await accessRepo.findOne({
          where: {
            user_id: existingUser.id,
            contract_id: invitation.contract_id,
          },
        });
        if (!existingBinding) {
          const newBinding = accessRepo.create({
            user_id: existingUser.id,
            contract_id: invitation.contract_id,
            granted_by: invitation.created_by, // audit chain: inviter → grantor
          });
          await accessRepo.save(newBinding);
        }

        // Idempotent ACCEPTED flip (exchange() usually did this already).
        invitation.status = GuestInvitationStatus.ACCEPTED;
        invitation.accepted_at = invitation.accepted_at ?? new Date();
        await invitationRepo.save(invitation);

        return {
          user: existingUser,
          contract_id: invitation.contract_id,
          wasExisting: true,
        };
      }

      // 4. Insert user + binding + flip invitation status.
      const guestUser = userRepo.create({
        email: invitation.invited_email,
        password_hash: passwordHash,
        first_name: dto.first_name?.trim() || 'Guest',
        last_name: dto.last_name?.trim() || invitation.invited_email.split('@')[0],
        role: UserRole.GUEST,
        account_type: AccountType.GUEST,
        organization_id: null as any, // guests have NO organization
        is_active: true,
        is_email_verified: true, // verified-by-token-possession
        password_changed_at: new Date(),
        preferred_language: invitation.invited_language || 'en',
      });
      const savedUser = await userRepo.save(guestUser);

      const binding = accessRepo.create({
        user_id: savedUser.id,
        contract_id: invitation.contract_id,
        granted_by: invitation.created_by, // audit chain: inviter → grantor
      });
      await accessRepo.save(binding);

      invitation.status = GuestInvitationStatus.ACCEPTED;
      invitation.accepted_at = invitation.accepted_at ?? new Date();
      await invitationRepo.save(invitation);

      return {
        user: savedUser,
        contract_id: invitation.contract_id,
        wasExisting: false,
      };
    }).catch(async (err) => {
      // Durable lockout increment AFTER the transaction has rolled the 401
      // back, so the failed-attempt counter persists (mirrors login, which
      // increments outside any transaction). Best-effort — a lockout-bookkeeping
      // hiccup must never mask the original auth error.
      if (wrongPasswordUser) {
        await this.accountLockout
          .recordFailedAttempt(wrongPasswordUser, {
            ip: ctx.ip ?? null,
            user_agent: ctx.user_agent ?? null,
          })
          .catch((e) =>
            this.logger.warn(
              `[establish-identity] lockout record failed: ${(e as Error).message}`,
            ),
          );
      }
      throw err;
    });

    // ── POST-COMMIT ───────────────────────────────────────────────────
    // Login-parity reset: a successful verify clears any accumulated failed
    // attempts / lock on the account. Best-effort (never blocks the success).
    if (resetLockoutUser) {
      await this.accountLockout
        .clearFailedAttempts(resetLockoutUser)
        .catch((e) =>
          this.logger.warn(
            `[establish-identity] lockout reset failed: ${(e as Error).message}`,
          ),
        );
    }

    this.logger.log(
      `Guest identity ${result.wasExisting ? 're-established' : 'established'} for user ${result.user.id} → contract ${result.contract_id}`,
    );

    // Resume-intent dispatch. Comment is handled INLINE (the recipient
    // doesn't want to click through a second time) — the write was
    // password-verified above, so it is safe even when no session is
    // minted below. Sign / upload land as route hints.
    const resume = await this.dispatchIntent(
      dto.intent,
      result.contract_id,
      result.user.id,
    );

    // MFA-enabled real account: this endpoint verifies only the password —
    // minting a session here would BYPASS the account's MFA gate (login
    // withholds tokens until verifyMfa). The binding is attached (that is
    // what the invitation grants); the caller signs in through the real
    // login flow, and their normal JWT works on the guest surface via the
    // binding (Model A — one identity, one token, access-by-binding).
    if (result.user.mfa_enabled) {
      return {
        // Explicit whitelist — never spread a User row into a response.
        user: {
          id: result.user.id,
          email: result.user.email,
          first_name: result.user.first_name,
          last_name: result.user.last_name,
          account_type: result.user.account_type,
        },
        access_token: null,
        refresh_token: null,
        requires_login: true,
        contract_id: result.contract_id,
        resume,
      };
    }

    // Issue JWT via the SAME machinery login / register / acceptInvitation
    // use (account-agnostic: for a real account these are its NORMAL tokens,
    // not a parallel guest credential — Model A). If _finalizeLogin has a
    // hiccup it logs but doesn't throw — so the identity transition stays
    // committed.
    const session = await this.authService.issueGuestSession(
      result.user,
      ctx,
    );

    return {
      user: session.user,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      contract_id: result.contract_id,
      resume,
    };
  }

  /**
   * Phase 7.18 bucket 1b-ii — resume-intent dispatcher.
   *
   * Three branches:
   *   COMMENT → write the captured draft via the SAME mutator the
   *             /guest/contracts/:id/comments endpoint uses, so the
   *             recipient doesn't have to click through twice.
   *   SIGN    → no work; return a route hint. TODO(sign-bucket).
   *   UPLOAD  → no work; return a route hint. Upload depends on the
   *             metering primitive (a later bucket). TODO(upload-bucket,
   *             depends: metering).
   */
  private async dispatchIntent(
    intent: EstablishIdentityDto['intent'],
    contractId: string,
    guestUserId: string,
  ): Promise<{
    kind: GuestIntentKind | null;
    route: string | null;
    created_comment_id?: string;
  }> {
    if (!intent) {
      return { kind: null, route: `/contracts/${contractId}` };
    }
    switch (intent.kind) {
      case GuestIntentKind.COMMENT: {
        if (!intent.comment) {
          return { kind: GuestIntentKind.COMMENT, route: `/contracts/${contractId}` };
        }
        const comment = await this.writeGuestComment(
          contractId,
          guestUserId,
          intent.comment.content,
          intent.comment.contract_clause_id,
          intent.comment.parent_comment_id,
        );
        return {
          kind: GuestIntentKind.COMMENT,
          route: `/contracts/${contractId}#comment-${comment.id}`,
          created_comment_id: comment.id,
        };
      }
      case GuestIntentKind.SIGN: {
        // TODO(sign-bucket): trigger DocuSign envelope creation + return
        // the signing URL. For now, hand the recipient the route they
        // were heading to and let the (future) sign controller pick up.
        return { kind: GuestIntentKind.SIGN, route: `/contracts/${contractId}/sign` };
      }
      case GuestIntentKind.UPLOAD: {
        // Feature #4 — guest upload of a new contract version is now LIVE at
        // `POST /guest/contracts/:id/documents` (GuestUploadController +
        // GuestUploadService: magic-bytes, race-safe 5/day-per-contract cap,
        // the separate `guest_upload` billing meter, host + managing
        // notifications). The actual upload is a multipart action that the
        // establish-identity intent cannot carry (no file buffer in scope
        // here), so resumption hands the now-authenticated guest the route to
        // the viewer's upload affordance, where they pick the file and POST
        // it. No work to do inline — just the route hint.
        return { kind: GuestIntentKind.UPLOAD, route: `/contracts/${contractId}/upload` };
      }
      default:
        return { kind: null, route: `/contracts/${contractId}` };
    }
  }

  /**
   * Phase 7.18 bucket 1b-ii — guest comment write.
   *
   * Used by:
   *   • dispatchIntent (resume-intent path on first upgrade)
   *   • the POST /guest/contracts/:id/comments endpoint (subsequent
   *     comments by an already-upgraded guest)
   *
   * Authorization MUST go through ContractAccessService so the guest is
   * walled to their binding. We use the SAME caller shape ContractsController
   * builds for managing/guest users — the authority routes to findForGuest.
   */
  async writeGuestComment(
    contractId: string,
    guestUserId: string,
    content: string,
    contractClauseId?: string,
    parentCommentId?: string,
  ): Promise<ContractComment> {
    // Re-fetch the guest user to populate the caller shape — the
    // authority needs role + account_type to branch correctly.
    const userRepo = this.dataSource.getRepository(User);
    const guest = await userRepo.findOne({ where: { id: guestUserId } });
    if (!guest) {
      throw new NotFoundException('Contract not found');
    }
    // Authority check — throws 404 if guest is not bound to this contract.
    await this.contractAccess.findAccessibleContract(contractId, {
      id: guest.id,
      organization_id: guest.organization_id ?? null,
      role: guest.role,
      account_type: guest.account_type,
    });

    const commentRepo = this.dataSource.getRepository(ContractComment); // lint-exempt: guest WRITE (comment insert) walled by findAccessibleContract; guest has no org — chokepoint is read-only/org-scoped

    // Fail-closed parent check. A guest may only reply within a thread the guest
    // can actually see: the parent MUST exist, belong to THIS contract, and be
    // guest-visible (is_internal_note = false). This stops a guest from
    // threading off an INTERNAL note — which would otherwise create a
    // guest-visible reply whose lineage points at content they can never read,
    // and is the only way a guest could probe an internal comment's UUID. The
    // generic 400 is a non-oracle (no distinction between "missing", "other
    // contract", or "internal").
    if (parentCommentId) {
      const parent = await commentRepo.findOne({
        where: { id: parentCommentId },
      });
      if (
        !parent ||
        parent.contract_id !== contractId ||
        parent.is_internal_note !== false
      ) {
        throw new BadRequestException('Invalid parent comment');
      }
    }

    const comment = commentRepo.create({
      contract_id: contractId,
      contract_clause_id: contractClauseId,
      user_id: guestUserId,
      content,
      parent_comment_id: parentCommentId,
      // A guest's own comment is always guest-visible (they wrote it) — never an
      // internal note. This is what lets the guest see it again next session.
      is_internal_note: false,
    });
    return commentRepo.save(comment);
  }

  /**
   * Guest Portal comments-list (feature #1) — read the guest-VISIBLE
   * conversation on the guest's bound contract.
   *
   * Used by GET /guest/contracts/:id/comments (an upgraded guest with a
   * standard JWT carrying account_type=GUEST).
   *
   * SECURITY — two independent guards, both required:
   *   1. Tenancy: ContractAccessService.findAccessibleContract walls the guest
   *      to their binding (404 on any other contract) — identical to the write
   *      path, so a guest can ONLY read their own contract's comments.
   *   2. Visibility: a WHITELIST filter `is_internal_note = false`. Internal
   *      SIGN-team notes (the fail-closed default) are NEVER returned.
   *
   * The projection is SCRUBBED to exactly what the UI renders — author display
   * name + a guest-vs-team flag. The raw `User` (email / role / account_type)
   * is never selected, so no author PII leaks to the external counterparty.
   * Ordered chronologically (created_at ASC) so it reads as a conversation.
   */
  async readGuestVisibleComments(
    contractId: string,
    guestUserId: string,
  ): Promise<GuestVisibleComment[]> {
    const userRepo = this.dataSource.getRepository(User);
    const guest = await userRepo.findOne({ where: { id: guestUserId } });
    if (!guest) {
      throw new NotFoundException('Contract not found');
    }
    // Authority check — throws 404 if the caller is not bound to this
    // contract (for a real account, the org-first dispatch falls through to
    // the same binding check). The returned contract carries the HOST org id,
    // which the author-labeling below keys on.
    const contract = await this.contractAccess.findAccessibleContract(
      contractId,
      {
        id: guest.id,
        organization_id: guest.organization_id ?? null,
        role: guest.role,
        account_type: guest.account_type,
      },
    );
    const hostOrgId = contract?.project?.organization_id ?? null;

    const commentRepo = this.dataSource.getRepository(ContractComment); // lint-exempt: guest READ (visibility-whitelist) walled by findAccessibleContract; guest has no org — chokepoint is org-scoped
    const rows = await commentRepo
      .createQueryBuilder('comment')
      .innerJoin('comment.user', 'author')
      .select('comment.id', 'id')
      .addSelect('comment.contract_id', 'contract_id')
      .addSelect('comment.contract_clause_id', 'contract_clause_id')
      .addSelect('comment.content', 'content')
      .addSelect('comment.created_at', 'created_at')
      .addSelect('author.first_name', 'first_name')
      .addSelect('author.last_name', 'last_name')
      .addSelect('author.account_type', 'account_type')
      .addSelect('author.organization_id', 'author_org_id')
      .where('comment.contract_id = :contractId', { contractId })
      .andWhere('comment.is_internal_note = :visible', { visible: false })
      .orderBy('comment.created_at', 'ASC')
      .getRawMany<{
        id: string;
        contract_id: string;
        contract_clause_id: string | null;
        content: string;
        created_at: Date;
        first_name: string | null;
        last_name: string | null;
        account_type: AccountType;
        author_org_id: string | null;
      }>();

    // NOTE — `parent_comment_id` is deliberately NOT projected. The guest UI is
    // a flat chronological conversation, and omitting it removes the only way a
    // guest could observe the UUID of an internal note that a managing-user
    // reply happens to thread off. Re-add only with per-row parent-visibility
    // handling if threaded display is ever needed.
    return rows.map((r) => {
      // TEAM = a member of the HOST org (the contract's owning org). Unified
      // membership: a real (MANAGING) account acting via a guest binding is
      // EXTERNAL to the host org and must NOT be labeled as the host's team —
      // account_type alone no longer discriminates, org membership does.
      const isTeam =
        r.account_type !== AccountType.GUEST &&
        r.author_org_id != null &&
        r.author_org_id === hostOrgId;
      const name = [r.first_name, r.last_name].filter(Boolean).join(' ').trim();
      return {
        id: r.id,
        contract_id: r.contract_id,
        contract_clause_id: r.contract_clause_id ?? null,
        content: r.content,
        created_at: r.created_at,
        author_name: name || (isTeam ? 'SIGN Team' : 'Guest'),
        author_role: isTeam ? ('TEAM' as const) : ('GUEST' as const),
      };
    });
  }

  private inviteTtlDays(): number {
    const raw = this.config.get<number>('GUEST_INVITE_TTL_DAYS', 30);
    return Number(raw);
  }
}
