import * as fs from 'fs';
import * as path from 'path';

/**
 * Option B — processor-sweep bucket: ESCAPE-HATCH FENCE for findAcrossAllOrgs.
 *
 * `ScopedContractRepository.findAcrossAllOrgs` is the ONE deliberate, named
 * tenancy bypass — it returns rows across ALL organizations with NO org filter.
 * That is correct for legitimately org-blind background work (the
 * ObligationReminderProcessor sweeper). The danger is the inverse of every
 * other Option B probe: not "can a cross-org row leak through a scoped read?"
 * but "can this all-orgs method be reached from a REQUEST-scoped (per-user)
 * caller — turning it into an org-escape hatch?".
 *
 * The ESLint allowlist that fences this method to specific files at lint-time
 * is a later bucket. Until it lands, THIS spec is the structural guard: a pure
 * source scan (no DB, runs in CI) proving the bypass has exactly one production
 * caller and that caller is a system/background BullMQ @Processor, never a
 * request handler.
 *
 * If a future change adds a second caller, this spec FAILS loudly — forcing the
 * "is this new call site genuinely org-blind, and is it request-unreachable?"
 * conversation before the escape hatch silently widens.
 */
describe('findAcrossAllOrgs — escape-hatch fence (request-unreachable)', () => {
  // backend/src — three levels up from this test file's directory
  // (modules/scoped-repository/tests).
  const SRC_ROOT = path.resolve(__dirname, '../../..');

  const DEFINITION = path.join(
    SRC_ROOT,
    'modules/scoped-repository/scoped-contract.repository.ts',
  );
  const PROCESSOR_REL =
    'modules/obligations/obligation-reminder.processor.ts';

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...walk(full));
      } else if (entry.name.endsWith('.ts')) {
        out.push(full);
      }
    }
    return out;
  }

  // Every .ts file that CALLS the method (`.findAcrossAllOrgs(`), excluding the
  // method definition itself and excluding test specs (specs may mock/exercise
  // it freely — they are not production reach).
  const callerFiles = walk(SRC_ROOT).filter((f) => {
    if (f === DEFINITION) return false;
    if (f.endsWith('.spec.ts')) return false;
    return /\.findAcrossAllOrgs\s*\(/.test(fs.readFileSync(f, 'utf8'));
  });

  it('has exactly ONE production caller — the ObligationReminderProcessor', () => {
    const rel = callerFiles
      .map((f) => path.relative(SRC_ROOT, f).split(path.sep).join('/'))
      .sort();
    expect(rel).toEqual([PROCESSOR_REL]);
  });

  it('is NOT called from any request-scoped controller', () => {
    const controllers = callerFiles.filter((f) => f.endsWith('.controller.ts'));
    expect(controllers).toEqual([]);
  });

  it('its sole caller is a system/background BullMQ @Processor, not a @Controller', () => {
    const processorSrc = fs.readFileSync(
      path.join(SRC_ROOT, PROCESSOR_REL),
      'utf8',
    );
    // System sweeper: decorated @Processor (queue/scheduler driven, no JWT in
    // scope), and explicitly NOT a request handler.
    expect(processorSrc).toMatch(/@Processor\(/);
    expect(processorSrc).not.toMatch(/@Controller\(/);
    // The reads it routes through the bypass are the queue @Process handlers,
    // not anything reachable from an HTTP request.
    expect(processorSrc).toMatch(/@Process\(['"]check-reminders['"]\)/);
    expect(processorSrc).toMatch(/@Process\(['"]weekly-digest['"]\)/);
  });
});
