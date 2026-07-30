import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { KnowledgeAsset } from '../../../database/entities';
import {
  PlaybookPosition,
  PlaybookRuleType,
  PlaybookScope,
  PlaybookThresholdDirection,
} from '../../../database/entities';
import { PlaybookResolverService } from '../../playbook/playbook-resolver.service';
import { PLAYBOOK_SEVERITY_CAP_INSTRUCTION } from '../../playbook/playbook-serializer.util';
import { ComplianceKnowledgeService } from '../services/compliance-knowledge.service';

/**
 * 7.22 Slice 2 — the compliance FEED wiring.
 *
 * The risk this spec exists to close is REGRESSION, not new-feature happy path:
 * `playbook_knowledge` already carried the org's free-text PLAYBOOK/STANDARD
 * knowledge assets, and Slice 2 must ADD to that channel without displacing it.
 * So the load-bearing assertions here are the two safeguards:
 *
 *   (a) the existing ['type:PLAYBOOK', 'type:STANDARD'] asset text still
 *       appears, and the tag query itself is unchanged;
 *   (b) the combined text never exceeds MAX_SECTION_CHARS, with the structured
 *       positions taking priority inside that budget.
 *
 * The asset repository is mocked at the QueryBuilder seam because what is under
 * test is the COMBINATION logic, not the asset SQL (which is unchanged and was
 * already covered). The resolver's own DB behaviour — the org wall and the
 * scope-precedence fold — is proven against real Postgres in
 * playbook-resolver.real-pg.spec.ts, not re-mocked here.
 */

const ORG = 'org-1';
const PROJECT = 'project-1';
const CONTRACT = 'contract-1';

/** Which asset bucket a query is for, decided by the tags it asked for. */
type Bucket = 'standard' | 'jurisdiction' | 'playbook';

/** The tag array each bucket's query was actually built with. */
let tagCalls: Partial<Record<Bucket, string[]>>;

const asset = (id: string, title: string, description: string): KnowledgeAsset =>
  ({ id, title, description, content: null }) as unknown as KnowledgeAsset;

const position = (over: Partial<PlaybookPosition>): PlaybookPosition =>
  ({
    id: 'p1',
    organization_id: ORG,
    scope: PlaybookScope.ORG,
    project_id: null,
    contract_id: null,
    clause_type: 'payment',
    is_custom_clause_type: false,
    rule_type: PlaybookRuleType.RANGE,
    value_config: { min: 28, max: 45, unit: 'days' },
    note: null,
    is_active: true,
    created_by: null,
    ...over,
  }) as PlaybookPosition;

/**
 * A QueryBuilder stub that records the tag params it was given and returns the
 * asset set the test assigned to that BUCKET.
 *
 * Routing is by TAG CONTENT, deliberately not by call order: buildContext's
 * jurisdiction query short-circuits (`if (!jurisdiction) return []`) before it
 * ever builds a QueryBuilder, so a call-index mapping silently shifts the
 * playbook bucket onto the jurisdiction slot in every test that passes a null
 * jurisdiction. Keying on the tags the query actually asked for is immune to
 * that.
 */
const bucketForTags = (tags: string[]): Bucket => {
  if (tags.includes('type:PLAYBOOK')) return 'playbook';
  if (tags.includes('type:MANDATORY_LAW')) return 'jurisdiction';
  return 'standard';
};

/**
 * Record the tag values out of one where/andWhere/orWhere call.
 *
 * The tag predicates are NOT passed directly to `andWhere` — the service wraps
 * them in `new Brackets((b) => { b.orWhere('a.tags @> :tag0::jsonb', …) })`, so
 * a stub that only inspects its own arguments sees nothing at all and every
 * query silently collapses into one bucket. The Brackets instance exposes its
 * callback as `whereFactory`; running it against a nested recorder is the only
 * way to observe what the query actually asked for.
 */
const recordInto = (tags: string[]) => {
  const recorder: Record<string, unknown> = {};
  const record = (sqlOrBrackets: unknown, params?: Record<string, unknown>) => {
    const factory = (sqlOrBrackets as { whereFactory?: (b: unknown) => void })
      ?.whereFactory;
    if (typeof factory === 'function') {
      factory(recordInto(tags));
      return recorder;
    }
    for (const [key, value] of Object.entries(params ?? {})) {
      if (typeof value !== 'string') continue;
      if (!/^(tag|tytag|jurTag)/.test(key)) continue;
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) tags.push(String(parsed[0]));
    }
    return recorder;
  };
  recorder.where = record;
  recorder.andWhere = record;
  recorder.orWhere = record;
  return recorder;
};

const makeAssetRepo = (results: Partial<Record<Bucket, KnowledgeAsset[]>>) => ({
  createQueryBuilder: () => {
    const tags: string[] = [];
    const qb = recordInto(tags) as Record<string, unknown>;
    qb.getMany = async () => {
      const bucket = bucketForTags(tags);
      tagCalls[bucket] = tags;
      return results[bucket] ?? [];
    };
    return qb;
  },
});

const build = async (
  results: Partial<Record<Bucket, KnowledgeAsset[]>>,
  resolve: jest.Mock,
): Promise<ComplianceKnowledgeService> => {
  tagCalls = {};
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      ComplianceKnowledgeService,
      {
        provide: getRepositoryToken(KnowledgeAsset),
        useValue: makeAssetRepo(results),
      },
      {
        provide: PlaybookResolverService,
        useValue: { resolveEffectivePositions: resolve },
      },
    ],
  }).compile();
  return moduleRef.get(ComplianceKnowledgeService);
};

describe('ComplianceKnowledgeService — playbook feed (7.22 Slice 2)', () => {
  describe('safeguard (a): structured positions ADD to the asset text', () => {
    it('emits both the structured positions and the PLAYBOOK asset text', async () => {
      const resolve = jest
        .fn()
        .mockResolvedValue([
          position({
            clause_type: 'retention',
            rule_type: PlaybookRuleType.THRESHOLD,
            value_config: {
              direction: PlaybookThresholdDirection.AT_MOST,
              value: 10,
              unit: 'percent',
            },
          }),
        ]);
      const service = await build(
        { playbook: [asset('a1', 'Our Negotiation Playbook', 'never accept X')] },
        resolve,
      );

      const ctx = await service.buildContext({
        orgId: ORG,
        jurisdiction: null,
        contractType: null,
        projectId: PROJECT,
      });

      // Structured position present…
      expect(ctx.playbook_knowledge).toContain('- RETENTION: at most 10 percent');
      // …AND the pre-existing asset text is NOT displaced.
      expect(ctx.playbook_knowledge).toContain('Our Negotiation Playbook');
      expect(ctx.playbook_knowledge).toContain('never accept X');
      // Structured first — it is the authoritative, explicitly-authored set.
      expect(ctx.playbook_knowledge!.indexOf('RETENTION')).toBeLessThan(
        ctx.playbook_knowledge!.indexOf('Our Negotiation Playbook'),
      );
    });

    it('leaves the type:PLAYBOOK + type:STANDARD dual-bucket query untouched', async () => {
      const service = await build({}, jest.fn().mockResolvedValue([]));

      await service.buildContext({
        orgId: ORG,
        jurisdiction: null,
        contractType: null,
        projectId: PROJECT,
      });

      // The playbook asset bucket still queries BOTH tags. Slice 2 must not
      // have narrowed it to type:PLAYBOOK now that structured positions exist.
      expect(tagCalls.playbook).toEqual(['type:PLAYBOOK', 'type:STANDARD']);
    });

    it('still returns the asset text alone when the org has no positions', async () => {
      const service = await build(
        { playbook: [asset('a1', 'Legacy Playbook', 'text body')] },
        jest.fn().mockResolvedValue([]),
      );

      const ctx = await service.buildContext({
        orgId: ORG,
        jurisdiction: null,
        contractType: null,
      });

      expect(ctx.playbook_knowledge).toContain('Legacy Playbook');
      expect(ctx.playbook_knowledge).not.toContain(
        PLAYBOOK_SEVERITY_CAP_INSTRUCTION,
      );
    });

    it('returns null when the org has neither positions nor assets', async () => {
      const service = await build({}, jest.fn().mockResolvedValue([]));

      const ctx = await service.buildContext({
        orgId: ORG,
        jurisdiction: null,
        contractType: null,
      });

      expect(ctx.playbook_knowledge).toBeNull();
    });

    it('returns positions alone when the org has no playbook assets', async () => {
      const service = await build(
        {},
        jest.fn().mockResolvedValue([position({})]),
      );

      const ctx = await service.buildContext({
        orgId: ORG,
        jurisdiction: null,
        contractType: null,
      });

      expect(ctx.playbook_knowledge).toContain('- PAYMENT: preferred 28–45 days');
    });
  });

  describe('safeguard (b): the section cap is respected', () => {
    it('keeps the combined text within MAX_SECTION_CHARS', async () => {
      // 200 positions + a very large asset — together far over the 30k cap.
      const positions = Array.from({ length: 200 }, (_, i) =>
        position({ id: `p${i}`, clause_type: `clause_type_number_${i}` }),
      );
      const huge = asset('big', 'Huge Playbook', 'z'.repeat(60_000));

      const service = await build(
        { playbook: [huge] },
        jest.fn().mockResolvedValue(positions),
      );

      const ctx = await service.buildContext({
        orgId: ORG,
        jurisdiction: null,
        contractType: null,
      });

      expect(ctx.playbook_knowledge!.length).toBeLessThanOrEqual(30_000);
    });

    it('holds the cap even with many small assets, whose separators overrun formatAssets’ own accounting', async () => {
      // formatAssets counts only BLOCK lengths — not the '\n\n' it joins with,
      // nor the truncation marker it appends — so its output legitimately
      // exceeds the budget it was handed. With one huge asset that overshoot is
      // invisible (the first block trips the check and nothing is emitted); with
      // many small assets it compounds two chars at a time. The playbook section
      // must still not exceed MAX_SECTION_CHARS, so the combination step cannot
      // simply trust the number it passed down.
      const many = Array.from({ length: 900 }, (_, i) =>
        asset(`a${i}`, `Asset ${i}`, 'y'.repeat(28)),
      );
      const positions = Array.from({ length: 10 }, (_, i) =>
        position({ id: `p${i}`, clause_type: `clause_type_number_${i}` }),
      );

      const service = await build(
        { playbook: many },
        jest.fn().mockResolvedValue(positions),
      );

      const ctx = await service.buildContext({
        orgId: ORG,
        jurisdiction: null,
        contractType: null,
      });

      expect(ctx.playbook_knowledge!.length).toBeLessThanOrEqual(30_000);
    });

    it('gives the structured positions priority inside the budget', async () => {
      const positions = Array.from({ length: 30 }, (_, i) =>
        position({ id: `p${i}`, clause_type: `clause_type_number_${i}` }),
      );
      const huge = asset('big', 'Huge Playbook', 'z'.repeat(60_000));

      const service = await build(
        { playbook: [huge] },
        jest.fn().mockResolvedValue(positions),
      );

      const ctx = await service.buildContext({
        orgId: ORG,
        jurisdiction: null,
        contractType: null,
      });

      // Every structured position survives; the oversized asset is what gets
      // squeezed — not the other way round.
      for (let i = 0; i < 30; i++) {
        expect(ctx.playbook_knowledge).toContain(`CLAUSE TYPE NUMBER ${i}:`);
      }
      expect(ctx.playbook_knowledge).toContain(PLAYBOOK_SEVERITY_CAP_INSTRUCTION);
      expect(ctx.playbook_knowledge!.length).toBeLessThanOrEqual(30_000);
    });
  });

  describe('scope threading', () => {
    it('passes project and contract scope through to the resolver', async () => {
      const resolve = jest.fn().mockResolvedValue([]);
      const service = await build({}, resolve);

      await service.buildContext({
        orgId: ORG,
        jurisdiction: null,
        contractType: null,
        projectId: PROJECT,
        contractId: CONTRACT,
      });

      expect(resolve).toHaveBeenCalledWith(ORG, {
        projectId: PROJECT,
        contractId: CONTRACT,
      });
    });

    it('passes null scope when the caller omits project and contract', async () => {
      const resolve = jest.fn().mockResolvedValue([]);
      const service = await build({}, resolve);

      await service.buildContext({
        orgId: ORG,
        jurisdiction: null,
        contractType: null,
      });

      expect(resolve).toHaveBeenCalledWith(ORG, {
        projectId: null,
        contractId: null,
      });
    });

    it('never resolves a playbook without an org', async () => {
      const resolve = jest.fn().mockResolvedValue([position({})]);
      const service = await build({}, resolve);

      const ctx = await service.buildContext({
        orgId: null,
        jurisdiction: null,
        contractType: null,
      });

      expect(resolve).not.toHaveBeenCalled();
      expect(ctx.playbook_knowledge).toBeNull();
    });
  });

  describe('best-effort: a playbook failure must not fail the check', () => {
    it('degrades to asset-only text when the resolver throws', async () => {
      const resolve = jest.fn().mockRejectedValue(new Error('pg exploded'));
      const service = await build(
        { playbook: [asset('a1', 'Legacy Playbook', 'text body')] },
        resolve,
      );

      const ctx = await service.buildContext({
        orgId: ORG,
        jurisdiction: null,
        contractType: null,
      });

      expect(ctx.playbook_knowledge).toContain('Legacy Playbook');
      expect(ctx.playbook_knowledge).not.toContain(
        PLAYBOOK_SEVERITY_CAP_INSTRUCTION,
      );
    });

    it('leaves the OTHER knowledge channels intact when the resolver throws', async () => {
      const resolve = jest.fn().mockRejectedValue(new Error('pg exploded'));
      const service = await build(
        {
          standard: [asset('s1', 'FIDIC Red Book', 'standard body')],
          jurisdiction: [asset('j1', 'Egyptian Civil Code', 'law body')],
        },
        resolve,
      );

      const ctx = await service.buildContext({
        orgId: ORG,
        jurisdiction: 'EG',
        contractType: 'FIDIC_RED_BOOK_2017',
      });

      expect(ctx.standard_knowledge).toContain('FIDIC Red Book');
      expect(ctx.jurisdiction_knowledge).toContain('Egyptian Civil Code');
      expect(ctx.playbook_knowledge).toBeNull();
      expect(ctx.asset_ids.sort()).toEqual(['j1', 's1']);
    });
  });

  describe('the severity-cap instruction reaches the model', () => {
    it('carries the advisory instruction whenever positions are present', async () => {
      const service = await build(
        {},
        jest.fn().mockResolvedValue([position({})]),
      );

      const ctx = await service.buildContext({
        orgId: ORG,
        jurisdiction: null,
        contractType: null,
      });

      expect(ctx.playbook_knowledge).toContain('never CRITICAL');
    });
  });
});
