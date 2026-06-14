import { DocumentUploadScopedRepository } from '../document-upload-scoped.repository';

/**
 * Option B — S2f: DocumentUploadScopedRepository filter-KEY allowlist guard
 * (unit, no DB).
 *
 * scopedFind interpolates each filter KEY into the SQL string (VALUES are bound
 * as parameters; keys cannot be). The base guards the key structurally: a key
 * not in the subclass's allowlist throws BEFORE any interpolation. S2f's wired
 * read (getDocuments) filters on `contract_id` only — that is the sole declared
 * key. `organization_id` is DELIBERATELY excluded: it is the denormalized drift
 * column the pre-S2f gap trusted; filtering on it would reintroduce the
 * non-canonical path. Widening the allowlist is a deliberate per-bucket
 * decision, never a drive-by.
 */
describe('DocumentUploadScopedRepository — S2f filter-key allowlist (unit)', () => {
  const ORG = '00000000-0000-0000-0000-00000000000a';

  // Minimal chainable QB stub — the allowlist guard fires in the base BEFORE
  // getMany(), so no real DB is needed.
  function makeRepo(): any {
    const qb: any = {
      innerJoin: () => qb,
      andWhere: () => qb,
      leftJoinAndSelect: () => qb,
      addOrderBy: () => qb,
      getMany: async () => [],
    };
    return { createQueryBuilder: () => qb };
  }

  it('allows the declared key (contract_id) — no throw', async () => {
    const repo = new DocumentUploadScopedRepository(makeRepo());
    await expect(
      repo.scopedFind({ contract_id: 'c1' } as any, ORG),
    ).resolves.toEqual([]);
  });

  it('rejects organization_id (the denorm drift column) BEFORE it touches SQL', async () => {
    const repo = new DocumentUploadScopedRepository(makeRepo());
    await expect(
      repo.scopedFind({ organization_id: ORG } as any, ORG),
    ).rejects.toThrow(/not allowlisted/);
  });

  it('rejects an undeclared key, naming the repository', async () => {
    const repo = new DocumentUploadScopedRepository(makeRepo());
    await expect(
      repo.scopedFind({ processing_status: 'UPLOADED' } as any, ORG),
    ).rejects.toThrow(/DocumentUploadScopedRepository/);
  });
});
