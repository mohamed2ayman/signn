import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Contract,
  ContractStatus,
  SignatureStatus,
  AuditLog,
} from '../../database/entities';
import { ExportService } from '../export/export.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../notifications/email.service';

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
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
    private readonly exportService: ExportService,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
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
    const contract = await this.contractRepo.findOne({
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
    await this.contractRepo.save(contract);

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
   *  - completed → contract FULLY_EXECUTED, executed_at = now()
   *  - declined  → contract reverted to ACTIVE, decline reason logged
   *  - voided    → contract reverted to ACTIVE, void reason logged
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

    const contract = await this.contractRepo.findOne({
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
      contract.signature_status = SignatureStatus.FULLY_EXECUTED;
      contract.executed_at = new Date();
      // Per the platform status machine: a fully-signed contract becomes ACTIVE.
      contract.status = ContractStatus.ACTIVE;

      if (contract.signature_signers) {
        contract.signature_signers = contract.signature_signers.map((s) => ({
          ...s,
          status: 'completed',
          signed_at: s.signed_at ?? new Date().toISOString(),
        }));
      }

      await this.contractRepo.save(contract);
      await this.recordAudit(contract, 'docusign.envelope.completed', {
        envelopeId,
        previousStatus,
        previousSignatureStatus,
        newStatus: ContractStatus.ACTIVE,
        newSignatureStatus: SignatureStatus.FULLY_EXECUTED,
        executed_at: contract.executed_at,
        payload,
      });
      await this.notifyOwner(
        contract,
        'Contract executed',
        `Your contract "${contract.name}" has been signed by all parties and is now fully executed.`,
        ContractStatus.ACTIVE,
      );
      this.logger.log(
        `Contract ${contract.id} fully executed, status → ACTIVE`,
      );
    } else if (status === 'declined') {
      const reason = this.extractEventReason(payload, 'decline');
      contract.signature_status = null;
      // Revert: do not progress the contract; return it to ACTIVE for re-issue.
      contract.status = ContractStatus.ACTIVE;
      await this.contractRepo.save(contract);

      await this.recordAudit(contract, 'docusign.envelope.declined', {
        envelopeId,
        previousStatus,
        previousSignatureStatus,
        decline_reason: reason,
        payload,
      });
      await this.notifyOwner(
        contract,
        'Contract signature declined',
        `Signature was declined for contract "${contract.name}". Reason: ${reason}`,
        ContractStatus.ACTIVE,
      );
      this.logger.warn(
        `Contract ${contract.id} envelope ${envelopeId} declined: ${reason}`,
      );
    } else if (status === 'voided') {
      const reason = this.extractEventReason(payload, 'void');
      contract.signature_status = null;
      contract.status = ContractStatus.ACTIVE;
      await this.contractRepo.save(contract);

      await this.recordAudit(contract, 'docusign.envelope.voided', {
        envelopeId,
        previousStatus,
        previousSignatureStatus,
        void_reason: reason,
        payload,
      });
      await this.notifyOwner(
        contract,
        'Contract signature voided',
        `The signature envelope for contract "${contract.name}" was voided. Reason: ${reason}`,
        ContractStatus.ACTIVE,
      );
      this.logger.warn(
        `Contract ${contract.id} envelope ${envelopeId} voided: ${reason}`,
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

        await this.contractRepo.save(contract);
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
  ): Promise<{ envelopeId: string; signingUrl: string }> {
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
