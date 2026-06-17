import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../../../common/utils/crypto';
import { ErpConnectionService } from '../services/erp-connection.service';
import { IErpConnectorRegistry } from '../connectors/erp-connector.interface';

/**
 * Phase 7.28 — ErpConnectionService credential handling (unit, no DB).
 *
 * Proves: credentials are ENCRYPTED on save via CryptoService, the encrypted
 * payload round-trips, the API response NEVER carries the encrypted field, and
 * an unknown vendor is rejected against the registry.
 */
const ENC_KEY = 'erp-conn-test-master-key-0123456789ABCDEF';

function makeCrypto(): CryptoService {
  const config = {
    get: jest.fn((k: string) =>
      k === 'ERP_CREDENTIAL_ENC_KEY' ? ENC_KEY : undefined,
    ),
  } as unknown as ConfigService;
  return new CryptoService(config);
}

const registry: IErpConnectorRegistry = {
  has: (v: string) => v === 'MOCK',
  knownVendors: () => ['MOCK'],
  resolve: jest.fn(),
  allCapabilities: () => [],
  capabilitiesFor: () =>
    ({
      vendor: 'MOCK',
      label: 'Mock',
      directions: [],
      domains: [],
      transport: 'mock',
      auth: 'none',
      skeleton: false,
    }) as any,
};

function makeService(crypto: CryptoService) {
  // connRepo: create echoes input; save stamps id/timestamps/status.
  const connRepo = {
    create: jest.fn((x: any) => ({ ...x })),
    save: jest.fn(async (x: any) => ({
      id: '11111111-1111-1111-1111-111111111111',
      status: 'configured',
      created_at: new Date(),
      updated_at: new Date(),
      last_sync_at: null,
      error_message: null,
      ...x,
    })),
  };
  const service = new ErpConnectionService(
    connRepo as any,
    {} as any, // mappingRepo
    {} as any, // jobRepo
    {} as any, // queue
    registry,
    crypto,
    {} as any, // dataSource
  );
  return { service, connRepo };
}

describe('ErpConnectionService — credentials & validation', () => {
  it('encrypts credentials on save and the payload round-trips', async () => {
    const crypto = makeCrypto();
    const { service, connRepo } = makeService(crypto);

    await service.create('org-1', {
      vendor: 'MOCK',
      name: 'My ERP',
      credentials: { apiKey: 'super-secret-value' },
    });

    const savedArg = connRepo.save.mock.calls[0][0];
    expect(savedArg.credentials_encrypted).toMatch(/^v1\./);
    // Round-trips back to the original credential JSON.
    expect(crypto.decrypt(savedArg.credentials_encrypted)).toBe(
      JSON.stringify({ apiKey: 'super-secret-value' }),
    );
  });

  it('NEVER returns the encrypted credential field on the response', async () => {
    const { service } = makeService(makeCrypto());
    const res = await service.create('org-1', {
      vendor: 'MOCK',
      name: 'My ERP',
      credentials: { apiKey: 'secret' },
    });
    expect(res).not.toHaveProperty('credentials_encrypted');
    expect(res.has_credentials).toBe(true);
    expect(res.vendor).toBe('MOCK');
  });

  it('stores null credentials (has_credentials=false) when none supplied', async () => {
    const { service, connRepo } = makeService(makeCrypto());
    const res = await service.create('org-1', { vendor: 'MOCK', name: 'No creds' });
    expect(connRepo.save.mock.calls[0][0].credentials_encrypted).toBeNull();
    expect(res.has_credentials).toBe(false);
  });

  it('rejects an unknown vendor against the registry', async () => {
    const { service } = makeService(makeCrypto());
    await expect(
      service.create('org-1', { vendor: 'ORACLE', name: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
