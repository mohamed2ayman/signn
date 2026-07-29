import { detectTextCorruption } from '../utils/text-corruption-detector.util';

// Synthetic Arabic filler — generic legal vocabulary (contract / clause / article /
// party / authority / contractor), NOT real contract text. No spaces → high Arabic ratio.
const AR = 'العقدوالبندوالمادةوالطرفوالهيئةوالمقاول';
const arabicFiller = (chars: number): string =>
  AR.repeat(Math.ceil(chars / AR.length)).slice(0, chars);

describe('detectTextCorruption (Fix #1 — post-extraction corruption detector)', () => {
  it('FIRES on Project10-shaped input (Arabic-dominant + heavy Latin garbage), score >= 25', () => {
    // ~10k Arabic chars with ~70 OCR-garbage Latin runs interleaved (Project10 ~61/10k).
    const garbage = ['BV', 'BEN', 'Sones', 'Cauda', 'ol', 'gh', 'Ip', 'hel', 'Sie', 'Gall'];
    let text = '';
    for (let i = 0; i < 70; i += 1) {
      text += arabicFiller(140) + ' ' + garbage[i % garbage.length] + ' ';
    }
    const flags = detectTextCorruption(text);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatch(/^text_corruption_suspected:/);
    const score = parseFloat(flags[0].split(':')[1]);
    expect(score).toBeGreaterThanOrEqual(25);
  });

  it('is SILENT on clean Arabic docx-shaped input (no Latin runs), score < 25', () => {
    const text = arabicFiller(20000); // pure Arabic, zero Latin runs
    expect(detectTextCorruption(text)).toEqual([]);
  });

  it('is SILENT on English / bilingual input (excluded by the Arabic-dominance gate)', () => {
    // Heavy Latin, little/no Arabic → the gate excludes it despite a huge Latin-run density.
    const english =
      'This Service Agreement is entered into between the parties for the works described herein. '.repeat(
        80,
      );
    expect(detectTextCorruption(english)).toEqual([]);
    // A bilingual doc that is still Latin-dominant is likewise excluded.
    const bilingual = arabicFiller(500) + ' ' + english;
    expect(detectTextCorruption(bilingual)).toEqual([]);
  });

  it('does NOT fire when only ALLOWLISTED Latin terms are embedded in Arabic', () => {
    // Same shape/density as the fires-case, but every Latin run is a legit allowlisted term.
    const legit = ['Aconex', 'Deliverables', 'NAT', 'Employer', 'Requirements'];
    let text = '';
    for (let i = 0; i < 70; i += 1) {
      text += arabicFiller(140) + ' ' + legit[i % legit.length] + ' ';
    }
    expect(detectTextCorruption(text)).toEqual([]);
  });

  it('returns [] on empty / whitespace input (no divide-by-zero)', () => {
    expect(detectTextCorruption('')).toEqual([]);
    expect(detectTextCorruption('     ')).toEqual([]);
  });
});
