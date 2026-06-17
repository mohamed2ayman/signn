import { ErpConnectorRegistry } from '../connectors/connector-registry';
import { MockErpConnector } from '../connectors/mock-erp.connector';
import { SapCostConnector } from '../connectors/sap-cost.connector';
import {
  ErpSyncDirection,
  ErpSyncDomain,
} from '../connectors/erp-connector.interface';

/**
 * Phase 7.28 — connector registry resolution + capability gating.
 *
 * Proves the central design constraint: a second adapter (SAP) drops in and
 * resolves through the SAME registry as the working Mock, with no special-casing
 * — and the registry exposes capabilities so the core can gate on them rather
 * than on the vendor name.
 */
describe('ErpConnectorRegistry', () => {
  function makeRegistry() {
    return new ErpConnectorRegistry([
      new MockErpConnector(),
      new SapCostConnector(),
    ]);
  }

  it('resolves both registered adapters by vendor key', () => {
    const reg = makeRegistry();
    expect(reg.resolve('MOCK')).toBeInstanceOf(MockErpConnector);
    expect(reg.resolve('SAP')).toBeInstanceOf(SapCostConnector);
  });

  it('lists known vendors and exposes capability descriptors', () => {
    const reg = makeRegistry();
    expect(reg.knownVendors().sort()).toEqual(['MOCK', 'SAP']);
    expect(reg.has('MOCK')).toBe(true);
    expect(reg.has('ORACLE')).toBe(false);

    const mock = reg.capabilitiesFor('MOCK');
    expect(mock.directions).toEqual([ErpSyncDirection.IMPORT]);
    expect(mock.domains).toEqual([ErpSyncDomain.COST]);
    expect(mock.skeleton).toBe(false);

    const sap = reg.capabilitiesFor('SAP');
    expect(sap.directions).toEqual([ErpSyncDirection.IMPORT]);
    expect(sap.domains).toEqual([ErpSyncDomain.COST]);
    expect(sap.skeleton).toBe(true); // prerequisite-gated
  });

  it('capabilities express what is NOT supported (core gates on these)', () => {
    const reg = makeRegistry();
    const mock = reg.capabilitiesFor('MOCK');
    expect(mock.directions).not.toContain(ErpSyncDirection.EXPORT);
    expect(mock.domains).not.toContain(ErpSyncDomain.SCHEDULE);
  });

  it('throws for an unknown vendor', () => {
    const reg = makeRegistry();
    expect(() => reg.resolve('ORACLE')).toThrow(/No ERP connector registered/);
  });

  it('rejects duplicate adapter registration for the same vendor', () => {
    expect(
      () => new ErpConnectorRegistry([new MockErpConnector(), new MockErpConnector()]),
    ).toThrow(/duplicate adapter/i);
  });

  it('Mock adapter returns deterministic fixture cost data', async () => {
    const mock = new MockErpConnector();
    const rows = await mock.importCostData({
      connectionId: 'c1',
      organizationId: 'o1',
      baseUrl: null,
      credentials: null,
      domain: ErpSyncDomain.COST,
    });
    expect(rows).toHaveLength(3);
    expect(rows[0].externalRef).toBe('MOCK-COST-0001');
    expect(rows[0].fields.cost_center).toBe('CC-100');
  });

  it('SAP skeleton registers but throws NotImplemented until prerequisites exist', async () => {
    const sap = new SapCostConnector();
    await expect(
      sap.importCostData({
        connectionId: 'c1',
        organizationId: 'o1',
        baseUrl: null,
        credentials: null,
        domain: ErpSyncDomain.COST,
      }),
    ).rejects.toThrow(/not yet operational/i);
  });
});
