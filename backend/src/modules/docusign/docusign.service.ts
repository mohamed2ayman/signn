import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import {
  Contract,
  ContractStatus,
  SignatureStatus,
  AuditLog,
} from '../../database/entities';
import { ExportService } from '../export/export.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../notifications/email.service';
import { ContractAccessService } from '../contracts/services/contract-access.service';
import { ContractPinningService } from '../contracts/services/contract-pinning.service';

// DocuSign SDK — no types available
// eslint-disable-next-line @typescript-eslint/no-var-requires
const docusign = require('docusign-esign');

interface SignerInput {
  email: string;
  name: string;
}

@Injectable()
export class DocuSignService {
  private readonly logger = new Logger(DocuSignService.name);
  private readonly accountId: string;
  private readonly integrationKey: string;
  private readonly rsaPrivateKey: string;
  private readonly authServer: string;
  private readonly basePath: string;
  private readonly userId: string;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Contract) // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled
    private readonly contractRepo: Repository<Contract>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
    private readonly exportService: ExportService,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
    // INTERIM (S0): Class-C bypass-role wall for initiate-signature.
    private readonly contractAccess: ContractAccessService,
    // Signed-state pinning (Slice 1) — the completed webhook funnels through
    // the shared pin operation (snapshot + hash + executed state, atomic).
    private readonly contractPinning: ContractPinningService,
  ) {
    this.accountId = this.configService.get<string>('DOCUSIGN_ACCOUNT_ID', '');
    this.integrationKey = this.configService.get<string>(
      'DOCUSIGN_INTEGRATION_KEY',
      '',
    );
    this.rsaPrivateKey = this.configService
      .get<string>('DOCUSIGN_RSA_PRIVATE_KEY', '')
      .replace(/\\n/g, '\n');
    this.authServer = this.configService.get<string>(
      'DOCUSIGN_AUTH_SERVER',
      'account-d.docusign.com',
    );
    this.basePath = this.configService.get<string>(
      'DOCUSIGN_BASE_PATH',
      'https://demo.docusign.net/restapi',
    );
    this.userId = this.configService.get<string>('DOCUSIGN_USER_ID', '');
  }

  /**
   * Authenticate with DocuSign using JWT Grant
   */
  private async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.accessToken && now < this.tokenExpiresAt - 60) {
      return this.accessToken;
    }

    const apiClient = new docusign.ApiClient();
    apiClient.setOAuthBasePath(this.authServer);

    const results = await apiClient.requestJWTUserToken(
      this.integrationKey,
      this.userId,
      ['signature', 'impersonation'],
      Buffer.from(this.rsaPrivateKey),
      3600,
    );

    this.accessToken = results.body.access_token as string;
    this.tokenExpiresAt = now + (results.body.expires_in as number);

    this.logger.log('DocuSign JWT token obtained');
    return this.accessToken!;
  }

  private async getApiClient(): Promise<any> {
    const token = await this.getAccessToken();
    const apiClient = new docusign.ApiClient();
    apiClient.setBasePath(this.basePath);
    apiClient.addDefaultHeader('Authorization', `Bearer ${token}`);
    return apiClient;
  }

  /**
   * Create a DocuSign envelope from the contract PDF
   */
  async createEnvelope(
    contractId: string,
    signers: SignerInput[],
  ): Promise<string> {
    const contract = await this.contractRepo.findOne({ // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled
      where: { id: contractId },
    });
    if (!contract) throw new NotFoundException('Contract not found');
    if (contract.status !== ContractStatus.APPROVED) {
      throw new BadRequestException(
        'Contract must be in APPROVED status to initiate signature',
      );
    }

    // Generate PDF using existing export service
    const pdfBuffer = await this.exportService.generateContractPdf(contractId);
    const pdfBase64 = pdfBuffer.toString('base64');

    // Build the envelope definition
    const document = new docusign.Document();
    document.documentBase64 = pdfBase64;
    document.name = `${contract.name}.pdf`;
    document.fileExtension = 'pdf';
    document.documentId = '1';

    const envelopeSigners = signers.map((s, i) => {
      const signer = new docusign.Signer();
      signer.email = s.email;
      signer.name = s.name;
      signer.recipientId = String(i + 1);
      signer.routingOrder = String(i + 1);

      // Add a SignHere tab
      const signHere = new docusign.SignHere();
      signHere.anchorString = '/sn1/'; // fallback anchor
      signHere.anchorUnits = 'pixels';
      signHere.anchorYOffset = '10';
      signHere.anchorXOffset = '20';
      // If no anchor, place at bottom of last page
      signHere.documentId = '1';
      signHere.pageNumber = '1';
      signHere.recipientId = String(i + 1);
      signHere.tabLabel = `SignHere_${i + 1}`;
      signHere.xPosition = String(100 + i * 200);
      signHere.yPosition = '700';

      const tabs = new docusign.Tabs();
      tabs.signHereTabs = [signHere];
      signer.tabs = tabs;

      return signer;
    });

    const recipients = new docusign.Recipients();
    recipients.signers = envelopeSigners;

    const envelopeDef = new docusign.EnvelopeDefinition();
    envelopeDef.emailSubject = `Please sign: ${contract.name}`;
    envelopeDef.documents = [document];
    envelopeDef.recipients = recipients;
    envelopeDef.status = 'sent';

    const apiClient = await this.getApiClient();
    const envelopesApi = new docusign.EnvelopesApi(apiClient);

    const results = await envelopesApi.createEnvelope(this.accountId, {
      envelopeDefinition: envelopeDef,
    });

    const envelopeId = results.envelopeId;
    this.logger.log(
      `DocuSign envelope created: ${envelopeId} for contract ${contractId}`,
    );

    // Update contract with envelope info
    contract.docusign_envelope_id = envelopeId;
    contract.signature_status = SignatureStatus.PENDING_SIGNATURE;
    contract.signature_signers = signers.map((s) => ({
      email: s.email,
      name: s.name,
      status: 'sent',
    }));
    await this.contractRepo.save(contract); // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled

    return envelopeId;
  }

  /**
   * Generate an embedded signing URL for a specific signer
   */
  async getSigningUrl(
    envelopeId: string,
    signerEmail: string,
    signerName: string,
    returnUrl: string,
  ): Promise<string> {
    const apiClient = await this.getApiClient();
    const envelopesApi = new docusign.EnvelopesApi(apiClient);

    const viewRequest = new docusign.RecipientViewRequest();
    viewRequest.returnUrl = returnUrl;
    viewRequest.authenticationMethod = 'none';
    viewRequest.email = signerEmail;
    viewRequest.userName = signerName;
    viewRequest.clientUserId = signerEmail; // for embedded signing

    const results = await envelopesApi.createRecipientView(
      this.accountId,
      envelopeId,
      { recipientViewRequest: viewRequest },
    );

    return results.url;
  }

  /**
   * Get envelope status from DocuSign
   */
  async getEnvelopeStatus(
    envelopeId: string,
  ): Promise<{ status: string; signers: any[] }> {
    const apiClient = await this.getApiClient();
    const envelopesApi = new docusign.EnvelopesApi(apiClient);

    const envelope = await envelopesApi.getEnvelope(
      this.accountId,
      envelopeId,
    );

    const recipients = await envelopesApi.listRecipients(
      this.accountId,
      envelopeId,
    );

    const signers = (recipients.signers || []).map((s: any) => ({
      email: s.email,
      name: s.name,
      status: s.status,
      signed_at: s.signedDateTime || null,
    }));

    return {
      status: envelope.status,
      signers,
    };
  }

  /**
   * Handle DocuSign Connect webhook events.
   * Signature is verified by DocuSignWebhookController before this is called.
   *
   * Supported envelope events:
   *  - completed → shared pin operation: snapshot + canonical SHA-256 pin +
   *    FULLY_EXECUTED + executed_at + status ACTIVE (atomic; idempotent
   *    under redelivery — exactly-once pin)
   *  - declined / voided → STATUS-GUARDED revert to ACTIVE (only while the
   *    envelope is still pending; after execution the event is ignored and
   *    the pin survives)
   *  - sent / delivered → per-signer status update only
   */
  async handleWebhook(payload: any): Promise<void> {
    const envelopeId =
      payload?.envelopeId ||
      payload?.data?.envelopeId ||
      payload?.EnvelopeStatus?.EnvelopeID;
    const status = (
      payload?.status ||
      payload?.event ||
      payload?.EnvelopeStatus?.Status ||
      ''
    )
      .toString()
      .toLowerCase()
      .replace(/^envelope-/, '');

    if (!envelopeId) {
      this.logger.warn('DocuSign webhook: no envelopeId in payload');
      return;
    }

    const contract = await this.contractRepo.findOne({ // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled
      where: { docusign_envelope_id: envelopeId },
      relations: ['creator'],
    });

    if (!contract) {
      this.logger.warn(
        `DocuSign webhook: no contract found for envelope ${envelopeId}`,
      );
      return;
    }

    this.logger.log(
      `DocuSign webhook: envelope ${envelopeId} status=${status} contract=${contract.id}`,
    );

    const previousStatus = contract.status;
    const previousSignatureStatus = contract.signature_status;

    if (status === 'completed') {
      // Signed-state pinning (Slice 1): the shared pin operation performs the
      // contract-state writes atomically (snapshot → canonical hash →
      // pin pointers → signature_status=FULLY_EXECUTED + executed_at +
      // status=ACTIVE). Idempotent under DocuSign redelivery — an already-
      // pinned contract is a no-op (exactly-once pin, no second snapshot).
      const pin = await this.contractPinning.pinExecutedContract(contract.id, {
        actorUserId: null,
        door: 'DOCUSIGN_WEBHOOK',
        envelopeId,
      });

      // Per-signer bookkeeping stays webhook-owned (volatile, excluded from
      // the pinned payload). Targeted update — never a full entity save,
      // which would clobber the pin writes with this stale loaded row.
      if (contract.signature_signers) {
        await this.contractRepo.update( // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled
          { id: contract.id },
          {
            signature_signers: contract.signature_signers.map((s) => ({
              ...s,
              status: 'completed',
              signed_at: s.signed_at ?? new Date().toISOString(),
            })),
          },
        );
      }

      await this.recordAudit(contract, 'docusign.envelope.completed', {
        envelopeId,
        previousStatus,
        previousSignatureStatus,
        newStatus: ContractStatus.ACTIVE,
        newSignatureStatus: SignatureStatus.FULLY_EXECUTED,
        pinned: pin.pinned,
        pinned_version_id: pin.pinned_version_id,
        content_hash: pin.content_hash,
        payload,
      });
      // Notify only on the FIRST completion — a redelivered completed event
      // must not re-notify the owner.
      if (pin.pinned) {
        await this.notifyOwner(
          contract,
          'Contract executed',
          `Your contract "${contract.name}" has been signed by all parties and is now fully executed.`,
          ContractStatus.ACTIVE,
        );
      }
      this.logger.log(
        `Contract ${contract.id} fully executed, status → ACTIVE` +
          (pin.pinned ? ' (signed state pinned)' : ' (already pinned — redelivery no-op)'),
      );
    } else if (status === 'declined' || status === 'voided') {
      const kind = status === 'voided' ? 'void' : 'decline';
      const reason = this.extractEventReason(payload, kind);

      // Signed-state pinning (Slice 1, void-guard fix): a late / replayed
      // declined/voided event arriving AFTER completed must NEVER un-execute
      // a signed contract — the pin survives. STATUS-GUARDED conditional
      // UPDATE (lesson #149 family): only a still-pending envelope reverts.
      // The guard is race-safe against a concurrent completed webhook — the
      // pin transaction and this UPDATE serialize on the row.
      const revert = await this.contractRepo.update( // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled
        {
          id: contract.id,
          signature_status: Not(SignatureStatus.FULLY_EXECUTED),
          pinned_version_id: IsNull(),
        },
        {
          // Revert: do not progress the contract; return it to ACTIVE for re-issue.
          signature_status: null,
          status: ContractStatus.ACTIVE,
        },
      );

      if (!revert.affected) {
        // Contract already FULLY_EXECUTED / pinned — IGNORE the event (no-op,
        // logged + audited; the executed state and the pin are untouched).
        await this.recordAudit(
          contract,
          `docusign.envelope.${status}.ignored_after_execution`,
          {
            envelopeId,
            previousStatus,
            previousSignatureStatus,
            [`${kind}_reason`]: reason,
            ignored: true,
            payload,
          },
        );
        this.logger.warn(
          `Contract ${contract.id} envelope ${envelopeId} ${status} IGNORED — ` +
            `contract already fully executed/pinned; the pin survives.`,
        );
        return;
      }

      await this.recordAudit(contract, `docusign.envelope.${status}`, {
        envelopeId,
        previousStatus,
        previousSignatureStatus,
        [`${kind}_reason`]: reason,
        payload,
      });
      await this.notifyOwner(
        contract,
        kind === 'void' ? 'Contract signature voided' : 'Contract signature declined',
        kind === 'void'
          ? `The signature envelope for contract "${contract.name}" was voided. Reason: ${reason}`
          : `Signature was declined for contract "${contract.name}". Reason: ${reason}`,
        ContractStatus.ACTIVE,
      );
      this.logger.warn(
        `Contract ${contract.id} envelope ${envelopeId} ${status}: ${reason}`,
      );
    } else if (status === 'sent' || status === 'delivered') {
      const signerStatuses =
        payload?.EnvelopeStatus?.RecipientStatuses?.RecipientStatus;
      if (signerStatuses && contract.signature_signers) {
        const statusArray = Array.isArray(signerStatuses)
          ? signerStatuses
          : [signerStatuses];

        contract.signature_signers = contract.signature_signers.map((s) => {
          const match = statusArray.find(
            (rs: any) => rs.Email === s.email || rs.email === s.email,
          );
          if (match) {
            return {
              ...s,
              status: match.Status || match.status || s.status,
              signed_at:
                match.Signed || match.signedDateTime || s.signed_at,
            };
          }
          return s;
        });

        const signedCount = contract.signature_signers.filter(
          (s) => s.status === 'completed' || s.status === 'signed',
        ).length;
        if (
          signedCount > 0 &&
          signedCount < contract.signature_signers.length
        ) {
          contract.signature_status = SignatureStatus.AWAITING_COUNTERPARTY;
        }

        await this.contractRepo.save(contract); // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled
      }
    } else {
      this.logger.log(
        `DocuSign webhook: ignoring envelope status "${status}" for ${envelopeId}`,
      );
    }
  }

  private extractEventReason(payload: any, kind: 'decline' | 'void'): string {
    if (kind === 'void') {
      return (
        payload?.voidedReason ||
        payload?.data?.voidedReason ||
        payload?.EnvelopeStatus?.VoidedReason ||
        'No reason provided'
      );
    }
    const recipientStatuses =
      payload?.EnvelopeStatus?.RecipientStatuses?.RecipientStatus;
    const arr = Array.isArray(recipientStatuses)
      ? recipientStatuses
      : recipientStatuses
        ? [recipientStatuses]
        : [];
    const declined = arr.find(
      (r: any) => (r.Status || r.status || '').toLowerCase() === 'declined',
    );
    return (
      payload?.declinedReason ||
      payload?.data?.declinedReason ||
      declined?.DeclineReason ||
      declined?.declinedReason ||
      'No reason provided'
    );
  }

  private async recordAudit(
    contract: Contract,
    action: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.auditLogRepo.insert({
        user_id: undefined,
        organization_id: (contract as any).organization_id ?? undefined,
        action,
        entity_type: 'contract',
        entity_id: contract.id,
        new_values: details as any,
      });
    } catch (err) {
      this.logger.warn(`Failed to record DocuSign audit log: ${err}`);
    }
  }

  private async notifyOwner(
    contract: Contract,
    subject: string,
    message: string,
    newStatus: string,
  ): Promise<void> {
    if (!contract.created_by) return;
    try {
      await this.notificationsService.notifyContractStatusChange(
        contract.created_by,
        contract.name,
        newStatus,
        contract.id,
      );
    } catch (err) {
      this.logger.warn(`Failed to enqueue contract status notification: ${err}`);
    }

    // Best-effort email — only if we can resolve the creator's address.
    const creatorEmail = (contract as any).creator?.email;
    if (creatorEmail) {
      try {
        await this.emailService.sendGenericEmail(
          creatorEmail,
          subject,
          `<p>${message}</p>`,
        );
      } catch (err) {
        this.logger.warn(`Failed to send DocuSign notification email: ${err}`);
      }
    }
  }

  /**
   * Initiate signature flow for a contract
   */
  async initiateSignature(
    contractId: string,
    signers: SignerInput[],
    initiatorEmail: string,
    initiatorName: string,
    returnUrl: string,
    orgId: string | null,
  ): Promise<{ envelopeId: string; signingUrl: string }> {
    // INTERIM (S0): Class-C bypass-role wall. Option B will absorb this via the
    //  scoped repository chokepoint — this findInOrg is the stop-gap until then.
    // PLG bypass-roles (OWNER_ADMIN/SYSTEM_ADMIN/OPERATIONS) skip the project-
    // membership check, and createEnvelope loaded the contract unscoped — so a
    // bypass-role caller could forge a signature envelope on ANY org's contract.
    // findInOrg applies the org gate before any envelope work; cross-tenant → 404.
    if (!orgId) {
      throw new NotFoundException('Contract not found');
    }
    await this.contractAccess.findInOrg(contractId, orgId);

    const envelopeId = await this.createEnvelope(contractId, signers);

    // Generate embedded signing URL for the initiator
    const signingUrl = await this.getSigningUrl(
      envelopeId,
      initiatorEmail,
      initiatorName,
      returnUrl,
    );

    return { envelopeId, signingUrl };
  }
}
