import { Injectable } from '@nestjs/common';
import {
  ErpCapabilities,
  ErpConnectorContext,
  ErpRawCostRecord,
  ErpSyncDirection,
  ErpSyncDomain,
  IErpConnector,
} from './erp-connector.interface';

/**
 * Phase 7.28 — SAP cost connector (SKELETON, prerequisite-gated).
 *
 * Import/cost only. Mirrors the S3/SES/Textract posture: the class exists and
 * REGISTERS through the registry exactly like the working Mock adapter — proving
 * a second adapter drops in with ZERO core changes — but `importCostData()`
 * throws until the live prerequisites exist. It must NOT be wired on until ALL
 * of these are met:
 *   - SAP connection + credentials provisioned (org-side)
 *   - SAP cost/WBS extraction API/RFC confirmed for the customer's instance
 *   - the SAP client SDK added to backend deps and lazy-required INSIDE the
 *     method below (never imported at module load — keeps boot light, matches
 *     the storage/email lazy-import convention, lesson #113)
 *   - field mappings validated against the customer's cost-code / WBS scheme
 *   - integration tests against a real SAP sandbox
 *
 * `skeleton: true` surfaces "configured but not yet operational" to the UI.
 */
@Injectable()
export class SapCostConnector implements IErpConnector {
  readonly capabilities: ErpCapabilities = {
    vendor: 'SAP',
    label: 'SAP (cost import)',
    directions: [ErpSyncDirection.IMPORT],
    domains: [ErpSyncDomain.COST],
    transport: 'rest_api',
    auth: 'oauth2',
    skeleton: true,
  };

  async importCostData(_ctx: ErpConnectorContext): Promise<ErpRawCostRecord[]> {
    // PREREQUISITE-GATED. When implementing, lazy-require the SAP SDK here:
    //   const { SapClient } = await import('<sap-sdk>');
    // so the heavy dependency never loads at module init.
    throw new Error(
      'SapCostConnector is not yet operational: SAP cost import is a ' +
        'prerequisite-gated skeleton (live SAP credentials, extraction API, ' +
        'SDK, and field mappings required). See the class doc and Phase 7.28 ' +
        'known gaps before enabling.',
    );
  }

  async healthCheck(
    _ctx: ErpConnectorContext,
  ): Promise<{ ok: boolean; detail?: string }> {
    // Prerequisite-gated like importCostData — a force-check on a SAP
    // connection fails until the connector is real.
    throw new Error(
      'SapCostConnector is not yet operational: force-check is unavailable ' +
        'until the SAP connector is implemented.',
    );
  }
}
