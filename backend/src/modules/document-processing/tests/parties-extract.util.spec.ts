import {
  extractPartiesFromPreamble,
  partyScore,
  pickBetter,
  resolveParties,
  type ExtractedParties,
} from '../utils/parties-extract.util';
import { computePreambleWindow } from '../utils/cover-trim.util';

// Realistic fixtures modelled on the Phase 8.3 gold corpus preambles.
const NTA_PREAMBLE =
  'إنه في يوم الموافق / / 2025 تم الاتفاق بين كل من: الهيئة القومية للأنفاق ' +
  'ويمثلها قانوناً في التوقيع على هذا العقد السيد اللواء دكتور مهندس/ طارق حامد ' +
  'ومقرها مبني وزارة النقل ويشار إليها فيما يلي بكلمة "الهيئة" (طرف أول) ' +
  'و تحالف شركتي أوراسكوم للإنشاءات ورواد الهندسة الحديثة والكائن مقرها في ' +
  '1 ميدان محطة المعادي سرايات - القاهرة ويمثلها قانوناً السيد المهندس / ماجد';

const FARIQ_PREAMBLE =
  'تم الاتفاق بين كل من: شركة ألفا للمقاولات ويمثلها المهندس فلان (الفريق الأول) ' +
  'و شركة بيتا للتوريدات والكائن مقرها القاهرة';

const ENGLISH_PREAMBLE =
  'This Service Agreement is made and entered into BETWEEN ' +
  'Orascom Construction S.A.E (the "First Party") and ' +
  'Contrack Facilities Management [CFM] (the "Second Party"). WHEREAS the parties agree';

describe('extractPartiesFromPreamble', () => {
  it('extracts both parties from the classic Arabic NTA preamble', () => {
    const p = extractPartiesFromPreamble(NTA_PREAMBLE);
    expect(p.firstParty).toBe('الهيئة القومية للأنفاق');
    expect(p.secondParty).toBe(
      'تحالف شركتي أوراسكوم للإنشاءات ورواد الهندسة الحديثة',
    );
  });

  it('handles the الفريق الأول / الفريق الثاني variant', () => {
    const p = extractPartiesFromPreamble(FARIQ_PREAMBLE);
    expect(p.firstParty).toBe('شركة ألفا للمقاولات');
    expect(p.secondParty).toBe('شركة بيتا للتوريدات');
  });

  it('extracts both parties from an English BETWEEN … and … preamble', () => {
    const p = extractPartiesFromPreamble(ENGLISH_PREAMBLE);
    expect(p.firstParty).toBe('Orascom Construction S.A.E');
    expect(p.secondParty).toBe('Contrack Facilities Management [CFM]');
  });

  it('returns nulls for a preamble with no named party block', () => {
    const p = extractPartiesFromPreamble('البند 1: التعريفات\nالبند 2: النطاق');
    expect(p).toEqual({ firstParty: null, secondParty: null });
  });

  it('returns nulls for empty / whitespace input', () => {
    expect(extractPartiesFromPreamble('')).toEqual({ firstParty: null, secondParty: null });
    expect(extractPartiesFromPreamble('   ')).toEqual({ firstParty: null, secondParty: null });
  });
});

describe('computePreambleWindow — scoping (no body scraping)', () => {
  it('excludes body cross-references (a "between …" inside clause 1)', () => {
    const doc =
      NTA_PREAMBLE +
      '\nمادة (1): التعريفات\nيسود هذا العقد في حال وجود تعارض between the Attachments and the text.';
    const window = computePreambleWindow(doc);
    // The window stops at clause 1 — the body "between the Attachments" is gone.
    expect(window).not.toContain('Attachments');
    const p = extractPartiesFromPreamble(window);
    expect(p.firstParty).toBe('الهيئة القومية للأنفاق');
    expect(p.secondParty).toContain('أوراسكوم');
    // The body English phrase is NOT scraped into a party slot.
    expect(p.firstParty).not.toContain('Attachments');
    expect(p.secondParty).not.toContain('Attachments');
  });

  it('returns an empty window for a Conditions/TOC document that opens at clause 1', () => {
    const conditions = 'البند 1: التعريفات\nالبند 2: قواعد العمل بالموقع\nالبند 3: الموظفون';
    expect(computePreambleWindow(conditions).trim()).toBe('');
  });

  it('keeps the English preamble window that computeCoverTrim would trim away', () => {
    const doc = ENGLISH_PREAMBLE + '\nClause 1 (Definitions and Interpretation) ...';
    const window = computePreambleWindow(doc);
    expect(window).toContain('BETWEEN');
    expect(window).not.toContain('Definitions and Interpretation');
  });
});

describe('partyScore / pickBetter', () => {
  it('scores populated slots', () => {
    expect(partyScore({ firstParty: null, secondParty: null })).toBe(0);
    expect(partyScore({ firstParty: 'A', secondParty: null })).toBe(1);
    expect(partyScore({ firstParty: 'A', secondParty: 'B' })).toBe(2);
  });

  it('pickBetter keeps the higher score, ties keep the first arg', () => {
    const one: ExtractedParties = { firstParty: 'A', secondParty: null };
    const two: ExtractedParties = { firstParty: 'A', secondParty: 'B' };
    expect(pickBetter(one, two)).toBe(two);
    expect(pickBetter(two, one)).toBe(two);
    const otherOne: ExtractedParties = { firstParty: 'X', secondParty: null };
    expect(pickBetter(one, otherOne)).toBe(one); // tie → first arg
  });
});

describe('resolveParties — orchestration (first-writer-wins, human-edit, Haiku fallback)', () => {
  const empty = { firstParty: null, secondParty: null, edited: false };

  it('regex full result → does NOT call the AI fallback, and writes', async () => {
    const ai = jest.fn<Promise<ExtractedParties>, [string]>();
    const res = await resolveParties(NTA_PREAMBLE, empty, ai);
    expect(ai).not.toHaveBeenCalled();
    expect(res.usedAi).toBe(false);
    expect(res.write).toBe(true);
    expect(partyScore(res.parties)).toBe(2);
  });

  it('regex partial → calls the AI fallback and uses it when strictly better', async () => {
    const partialArabic = 'تم الاتفاق بين كل من: الهيئة القومية للأنفاق ويمثلها فلان'; // no second party
    const ai = jest.fn(async () => ({
      firstParty: 'الهيئة القومية للأنفاق',
      secondParty: 'تحالف أوراسكوم',
    }));
    const res = await resolveParties(partialArabic, empty, ai);
    expect(ai).toHaveBeenCalledTimes(1);
    expect(res.usedAi).toBe(true);
    expect(res.write).toBe(true);
    expect(res.parties.secondParty).toBe('تحالف أوراسكوم');
  });

  it('AI fallback throwing → keeps the regex result, never crashes', async () => {
    const partialArabic = 'تم الاتفاق بين كل من: الهيئة القومية للأنفاق ويمثلها فلان';
    const ai = jest.fn(async () => {
      throw new Error('ai-backend 503');
    });
    const res = await resolveParties(partialArabic, empty, ai);
    expect(ai).toHaveBeenCalledTimes(1);
    expect(res.usedAi).toBe(false);
    expect(res.parties.firstParty).toBe('الهيئة القومية للأنفاق');
    expect(res.write).toBe(true); // one party is still better than nothing
  });

  it('human-edited contract → never writes, never calls AI', async () => {
    const ai = jest.fn<Promise<ExtractedParties>, [string]>();
    const partialArabic = 'تم الاتفاق بين كل من: الهيئة القومية للأنفاق ويمثلها فلان';
    const res = await resolveParties(
      partialArabic,
      { firstParty: 'human first', secondParty: 'human second', edited: true },
      ai,
    );
    expect(res.write).toBe(false);
    expect(ai).not.toHaveBeenCalled();
  });

  it('first-writer-wins: a later full result UPGRADES an earlier partial', async () => {
    const ai = jest.fn<Promise<ExtractedParties>, [string]>();
    const currentPartial = { firstParty: null, secondParty: 'أوراسكوم', edited: false };
    const res = await resolveParties(NTA_PREAMBLE, currentPartial, ai);
    expect(res.write).toBe(true);
    expect(partyScore(res.parties)).toBe(2);
  });

  it('first-writer-wins: a later partial does NOT downgrade a stored full result', async () => {
    const ai = jest.fn(async () => ({ firstParty: null, secondParty: null }));
    const partialArabic = 'تم الاتفاق بين كل من: الهيئة القومية للأنفاق ويمثلها فلان';
    const currentFull = { firstParty: 'الهيئة', secondParty: 'تحالف', edited: false };
    const res = await resolveParties(partialArabic, currentFull, ai);
    expect(res.write).toBe(false);
  });

  it('equal score does not rewrite (idempotent re-run)', async () => {
    const ai = jest.fn<Promise<ExtractedParties>, [string]>();
    const currentFull = {
      firstParty: 'الهيئة القومية للأنفاق',
      secondParty: 'تحالف شركتي أوراسكوم للإنشاءات ورواد الهندسة الحديثة',
      edited: false,
    };
    const res = await resolveParties(NTA_PREAMBLE, currentFull, ai);
    expect(res.write).toBe(false);
    expect(ai).not.toHaveBeenCalled();
  });
});
