import { NotFoundException } from '@nestjs/common';

import { DocuSignService } from '../docusign.service';

/**
 * S0 — INTERIM Class-C bypass-role wall on DocuSign initiate-signature
 * (`POST /contracts/:id/initiate-signature` → DocuSignService.initiateSignature).
 *
 * Pre-fix, `initiateSignature` → `createEnvelope` loaded the contract by id
 * with no org filter. Because PermissionLevelGuard lets bypass-roles
 * (OWNER_ADMIN/SYSTEM_ADMIN/OPERATIONS) through, a bypass-role caller in org A
 * could forge a signature envelope on ANY org's contract.
 *
 * The wall (findInOrg) runs BEFORE any envelope work and is keyed on the
 * caller's org, not role. Option B will absorb this via the scoped repository
 * chokepoint.
 */
describe('DocuSignService.initiateSignature — Class-C wall (S0)', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const CONTRACT_OWNED_BY_B = '11111111-1111-1111-1111-1111111111b1';
  const CONTRACT_IN_A = '22222222-2222-2222-2222-22222222222a';
  const noop = {} as any;
  const signers = [{ email: 's@x.com', name: 'S' }];

  function build(contractAccess: any): DocuSignService {
    const configService = { get: jest.fn().mockReturnValue('') };
    return new DocuSignService(
      configService as any, // configService
      noop, // contractRepo
      noop, // auditLogRepo
      noop, // exportService
      noop, // notificationsService
      noop, // emailService
      contractAccess, // contractAccess
    );
  }

  it('BYPASS-ROLE PROBE: cross-tenant initiate → 404 BEFORE any envelope is created', async () => {
    const contractAccess = {
      findInOrg: jest
        .fn()
        .mockRejectedValue(new NotFoundException('Contract not found')),
    };
    const svc = build(contractAccess);
    // Spy the envelope path so we can prove it is never reached.
    const createEnvelopeSpy = jest.fn();
    (svc as any).createEnvelope = createEnvelopeSpy;

    await expect(
      svc.initiateSignature(
        CONTRACT_OWNED_BY_B,
        signers,
        'initiator@a.com',
        'Initiator',
        'https://return',
        ORG_A,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(contractAccess.findInOrg).toHaveBeenCalledWith(
      CONTRACT_OWNED_BY_B,
      ORG_A,
    );
    // CRITICAL: no envelope was created on the cross-tenant path.
    expect(createEnvelopeSpy).not.toHaveBeenCalled();
  });

  it('no-org caller (orgId null) → 404, findInOrg NEVER called', async () => {
    const contractAccess = { findInOrg: jest.fn() };
    const svc = build(contractAccess);
    const createEnvelopeSpy = jest.fn();
    (svc as any).createEnvelope = createEnvelopeSpy;

    await expect(
      svc.initiateSignature(
        CONTRACT_OWNED_BY_B,
        signers,
        'initiator@a.com',
        'Initiator',
        'https://return',
        null,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(contractAccess.findInOrg).not.toHaveBeenCalled();
    expect(createEnvelopeSpy).not.toHaveBeenCalled();
  });

  it('happy path: in-org caller → envelope created and signing URL returned', async () => {
    const contractAccess = { findInOrg: jest.fn().mockResolvedValue({}) };
    const svc = build(contractAccess);
    (svc as any).createEnvelope = jest.fn().mockResolvedValue('envelope-1');
    (svc as any).getSigningUrl = jest.fn().mockResolvedValue('https://sign');

    const result = await svc.initiateSignature(
      CONTRACT_IN_A,
      signers,
      'initiator@a.com',
      'Initiator',
      'https://return',
      ORG_A,
    );

    expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_A, ORG_A);
    expect((svc as any).createEnvelope).toHaveBeenCalledWith(
      CONTRACT_IN_A,
      signers,
    );
    expect(result).toEqual({
      envelopeId: 'envelope-1',
      signingUrl: 'https://sign',
    });
  });
});
