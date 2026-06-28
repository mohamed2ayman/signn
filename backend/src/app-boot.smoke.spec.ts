import { Test, TestingModule } from '@nestjs/testing';
import { ContractsService } from './modules/contracts/contracts.service';

/**
 * Backend-boot SMOKE test — bootstraps the FULL Nest application graph via real
 * DI (`Test.createTestingModule({ imports: [AppModule] }).compile()`), forcing
 * Nest to eagerly instantiate every provider across every module and resolve
 * each constructor dependency.
 *
 * WHY THIS EXISTS: sub-slice 2a added `@InjectRepository(Clause)` to
 * ContractsService but did NOT register `Clause` in `ContractsModule.forFeature`,
 * so the backend could not boot — `Nest can't resolve dependencies of the
 * ContractsService (... ?)` at index [17] — yet all 1182 unit/real-PG tests
 * passed because NONE of them bootstrap the app through real DI (they
 * direct-instantiate services or mock providers). This smoke test closes that
 * gap: a missing/incorrect module registration anywhere in the graph now fails
 * loudly here.
 *
 * `.compile()` (not `.init()`) is the lightest approach that genuinely exercises
 * the DI graph: it eagerly instantiates all singleton providers (where
 * unresolvable dependencies throw) without running onModuleInit/lifecycle hooks
 * (schema-check / isolation probes), keeping the test fast and side-effect-light.
 * `dataSourceOptions` is synchronize:false / no migrationsRun, so compiling does
 * not mutate the database.
 *
 * Real Postgres + Redis are required (AppModule's TypeORM + Bull connect during
 * compile). CI is unit-only, so this skips LOUDLY when DATABASE_URL is unset.
 */
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[app-boot.smoke] SKIPPING — DATABASE_URL unset. This MUST run against ' +
      'Postgres + Redis (dev/staging) to bootstrap the full Nest DI graph and ' +
      'catch missing module registrations. CI green here does NOT prove the app boots.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

// Satisfy app.module Joi for required vars that have no safe default. Real
// connections (DATABASE_URL / REDIS_URL) come from the runner env; these are
// inert placeholders only used to pass startup validation. process.env wins over
// any .env file in @nestjs/config, so this is authoritative.
const setEnvDefault = (k: string, v: string) => {
  if (!process.env[k]) process.env[k] = v;
};

describeReal('Backend boot — full Nest DI graph (real Postgres + Redis)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    setEnvDefault('REDIS_URL', 'redis://localhost:6379');
    setEnvDefault('JWT_SECRET', 'smoke-test-jwt-secret-min-16-chars');
    setEnvDefault('JWT_REFRESH_SECRET', 'smoke-test-jwt-refresh-secret-min-32-characters-xx');
    setEnvDefault('NESTJS_INTERNAL_TOKEN', 'smoke-test-internal-token');
    setEnvDefault('FRONTEND_URL', 'http://localhost:5173');
    setEnvDefault('BASE_URL', 'http://localhost:3000');

    // Lazy-require AFTER env is set so app.module's ConfigModule Joi validation
    // (and data-source.ts) see the placeholders.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppModule } = require('./app.module');
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  }, 60_000);

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('bootstraps the entire application — every provider/repository resolves', () => {
    // Reaching here means `.compile()` resolved the whole DI graph. Assert a
    // cross-module provider whose dependency was the exact thing 2a missed.
    expect(moduleRef).toBeDefined();
    const contracts = moduleRef.get(ContractsService, { strict: false });
    expect(contracts).toBeInstanceOf(ContractsService);
  });
});
