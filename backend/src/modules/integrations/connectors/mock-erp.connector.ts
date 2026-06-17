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
 * Phase 7.28 — MOCK ERP connector (fully working, fixture-driven).
 *
 * This is the reference adapter that proves the WHOLE pipeline end-to-end on
 * the dev DB with NO credentials and NO external system: registry resolution →
 * capability gate → worker → field mapping → neutral cost rows → dashboard.
 *
 * It emits ERP-NATIVE field names (cost_center / wbs / value / curr / period /
 * desc) on purpose, so the engine's field-mapping layer is genuinely exercised
 * (a customer-configured mapping projects these onto SIGN's neutral cost
 * shape). The values are deterministic so tests can assert exact rows.
 */
@Injectable()
export class MockErpConnector implements IErpConnector {
  readonly capabilities: ErpCapabilities = {
    vendor: 'MOCK',
    label: 'Mock ERP (fixture data)',
    directions: [ErpSyncDirection.IMPORT],
    domains: [ErpSyncDomain.COST],
    transport: 'mock',
    auth: 'none',
    skeleton: false,
  };

  async importCostData(_ctx: ErpConnectorContext): Promise<ErpRawCostRecord[]> {
    // Deterministic fixture cost lines in ERP-native field names. No network,
    // no credentials. The connection's field mappings translate these keys
    // onto the neutral shape inside the engine.
    return [
      {
        externalRef: 'MOCK-COST-0001',
        fields: {
          cost_center: 'CC-100',
          wbs: 'WBS-1.1',
          period: '2026-05',
          value: 125000.5,
          curr: 'EGP',
          desc: 'Earthworks — bulk excavation',
        },
      },
      {
        externalRef: 'MOCK-COST-0002',
        fields: {
          cost_center: 'CC-200',
          wbs: 'WBS-2.3',
          period: '2026-05',
          value: 48250.0,
          curr: 'EGP',
          desc: 'Reinforcement steel supply',
        },
      },
      {
        externalRef: 'MOCK-COST-0003',
        fields: {
          cost_center: 'CC-300',
          wbs: 'WBS-3.0',
          period: '2026-06',
          value: 9900.75,
          curr: 'EGP',
          desc: 'Site supervision — June',
        },
      },
    ];
  }
}
