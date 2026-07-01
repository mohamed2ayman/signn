import {
  computeCoverTrim,
  COVER_TRIM_CLAUSE_GUARD_FLAG,
} from '../utils/cover-trim.util';

describe('computeCoverTrim (cover-page trim clause-guard — B + C + D)', () => {
  // The Project4 failure reproduced: a Conditions document mislabeled
  // "Contract Agreement", with a body phrase "ما لم يتم الاتفاق على غير ذلك"
  // (contains "يتم الاتفاق") sitting after البند 1.
  const BUG_FIXTURE =
    'صفحة الغلاف - عقد توريد\n' +
    'جدول المحتويات\n' +
    'البند 1: التعريفات\n' +
    'يقصد بالكلمات التالية المعاني المبينة قرين كل منها.\n' +
    'البند 2: قواعد العمل بالموقع والدخول إليه\n' +
    '2-1 على المورد الالتزام بما لم يتم الاتفاق على غير ذلك.\n' +
    'البند 3: الموظفون والعمال\n';

  // A true agreement: cover page, then the preamble openers, then clauses.
  const AGREEMENT_FIXTURE =
    'الجمهورية - وزارة - صفحة غلاف\n' +
    'إنه في يوم الأحد الموافق 2025/1/1\n' +
    'تم الاتفاق بين كل من: الطرف الأول شركة أ والطرف الثاني شركة ب\n' +
    'البند 1: التعريفات\n' +
    'تعريفات عامة.\n';

  // Correctly-labeled conditions doc using مادة markers.
  const CONDITIONS_FIXTURE =
    'صفحة غلاف\nجدول المحتويات\n' +
    'مادة (1): التعريفات\nتعريفات.\nمادة (2): النطاق\n';

  // ── (B) the bug is fixed: clause 1 is never trimmed away ──────────────────

  it('preserves clause 1 (التعريفات) for a Conditions doc mislabeled "Contract Agreement"', () => {
    const r = computeCoverTrim(BUG_FIXTURE, 'Contract Agreement');
    expect(r.text.startsWith('البند 1: التعريفات')).toBe(true);
    expect(r.text).toContain('التعريفات');
    expect(r.text).toContain('قواعد العمل'); // البند 2 kept too
    // cover page + TOC were trimmed
    expect(r.text).not.toContain('صفحة الغلاف');
    expect(r.text).not.toContain('جدول المحتويات');
  });

  // ── (C) the bare "تم الاتفاق" is no longer a trim marker ──────────────────

  it('does NOT trim at a mid-body "يتم الاتفاق" phrase (bare تم الاتفاق removed)', () => {
    const r = computeCoverTrim(BUG_FIXTURE, 'Contract Agreement');
    // Old behavior cut here; new behavior must keep everything from البند 1.
    expect(r.text.indexOf('التعريفات')).toBeLessThan(
      r.text.indexOf('ما لم يتم الاتفاق'),
    );
    expect(r.flags).toEqual([]); // no agreement OPENER matched → no guard flag
    expect(r.warning).toBeNull();
  });

  // ── (D) clause-guard fires loudly when an opener sits AT/AFTER clause 1 ────

  it('flags + warns when an agreement opener occurs at/after clause 1 (guard)', () => {
    const fixture =
      'البند 1: التعريفات\n' +
      'تعريفات عامة.\n' +
      'البند 2: نطاق العمل\n' +
      'تم الاتفاق بين كل من الطرفين على تعديل النطاق لاحقاً.\n';
    const r = computeCoverTrim(fixture, 'Contract Agreement');
    // Trimmed at clause 1, NOT at the mid-body opener → clause 1 preserved.
    expect(r.text.startsWith('البند 1: التعريفات')).toBe(true);
    expect(r.flags).toContain(COVER_TRIM_CLAUSE_GUARD_FLAG);
    expect(r.warning).toMatch(/clause-guard/);
  });

  // ── true agreement: preamble is kept (opener BEFORE clause 1) ─────────────

  it('keeps the preamble of a true agreement (opener precedes clause 1)', () => {
    const r = computeCoverTrim(AGREEMENT_FIXTURE, 'Contract Agreement');
    expect(r.text.startsWith('إنه في يوم')).toBe(true);
    expect(r.text).toContain('الطرف الأول'); // party block kept
    expect(r.text).toContain('البند 1'); // clauses kept
    expect(r.text).not.toContain('صفحة غلاف'); // cover trimmed
    expect(r.flags).toEqual([]);
    expect(r.warning).toBeNull();
  });

  // ── correctly-labeled conditions: unchanged (trim at first مادة) ──────────

  it('trims a correctly-labeled conditions doc at the first مادة (unchanged)', () => {
    const r = computeCoverTrim(CONDITIONS_FIXTURE, 'General Conditions');
    expect(r.text.startsWith('مادة (1): التعريفات')).toBe(true);
    expect(r.text).not.toContain('صفحة غلاف');
    expect(r.flags).toEqual([]);
    expect(r.warning).toBeNull();
  });

  // ── null / custom / missing label: safe (content-driven) ──────────────────

  it('is label-independent: null label still preserves clause 1', () => {
    const r = computeCoverTrim(BUG_FIXTURE, null);
    expect(r.text.startsWith('البند 1: التعريفات')).toBe(true);
  });

  it('is label-independent: an arbitrary custom label still preserves clause 1', () => {
    const r = computeCoverTrim(BUG_FIXTURE, 'مستند رقم 7');
    expect(r.text.startsWith('البند 1: التعريفات')).toBe(true);
  });

  // ── no numbered clause present ────────────────────────────────────────────

  it('trims at the preamble opener when there is no numbered clause', () => {
    const r = computeCoverTrim('غلاف\nإنه في يوم كذا تم توقيع المستند.\n', 'x');
    expect(r.text.startsWith('إنه في يوم')).toBe(true);
    expect(r.flags).toEqual([]);
  });

  it('returns text unchanged when neither a clause nor an opener is present', () => {
    const text = 'مجرد نص بدون أي بنود أو مواد.';
    const r = computeCoverTrim(text, 'x');
    expect(r.text).toBe(text);
    expect(r.flags).toEqual([]);
    expect(r.warning).toBeNull();
  });

  it('handles empty text safely', () => {
    const r = computeCoverTrim('', 'Contract Agreement');
    expect(r).toEqual({ text: '', flags: [], warning: null });
  });

  // ── "البند رقم (N)" heading format + spaced parens + cross-ref (Project8) ──

  it('recognizes "البند رقم (N)" headings → clause 1 preserved', () => {
    const fixture =
      'صفحة الغلاف\n' +
      'البند رقم (1) التمهيد والمرفقات والتعريفات\n' +
      'يقصد بالكلمات التالية المعاني المبينة قرين كل منها.\n' +
      'البند رقم (2) موضوع العقد - نطاق العمل\n';
    const r = computeCoverTrim(fixture, 'General Conditions');
    expect(r.text.startsWith('البند رقم (1) التمهيد')).toBe(true);
    expect(r.text).toContain('التمهيد والمرفقات والتعريفات');
    expect(r.text).not.toContain('صفحة الغلاف'); // cover trimmed
    expect(r.flags).toEqual([]);
  });

  it('recognizes spaced parens "البند رقم ( 1 )" → clause 1 preserved', () => {
    const fixture =
      'غلاف\n' +
      'البند رقم ( 1 ) التمهيد والمرفقات والتعريفات\n' +
      'تعريفات.\n' +
      'البند رقم (2) موضوع العقد\n';
    const r = computeCoverTrim(fixture, null);
    expect(r.text.startsWith('البند رقم ( 1 ) التمهيد')).toBe(true);
    expect(r.text).not.toContain('غلاف');
  });

  it('does NOT trim at a mid-body "البند (2)" cross-reference inside clause 1 (Project8)', () => {
    // Clause 1 heading "البند رقم ( 1 )" precedes a bare cross-ref "البند (2)"
    // in its definitions body. The trim MUST land at the heading, not the ref.
    const fixture =
      'صفحة الغلاف - عقد خدمات\n' +
      'البند رقم ( 1 ) التمهيد والمرفقات والتعريفات\n' +
      'التغييرات: يقصد بها ما هو محدد في البند (2) من هذا العقد على التوالي.\n' +
      'البند رقم (2) موضوع العقد - نطاق العمل\n';
    const r = computeCoverTrim(fixture, 'General Conditions');
    expect(r.text.startsWith('البند رقم ( 1 ) التمهيد')).toBe(true);
    expect(r.text).toContain('التمهيد والمرفقات والتعريفات'); // clause 1 preserved
  });

  it('a bare mid-body "البند (N)" cross-reference (no heading) is NOT a trim point', () => {
    const fixture =
      'مقدمة العقد وملاحظات عامة تشير إلى البند (2) من هذا العقد وإلى البند (8).\n';
    const r = computeCoverTrim(fixture, 'x');
    // Cross-ref is mid-line → not line-anchored → no clause marker → no trim.
    expect(r.text).toBe(fixture);
    expect(r.flags).toEqual([]);
    expect(r.warning).toBeNull();
  });
});
