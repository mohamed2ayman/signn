import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CLAUSE_TYPE_PROVIDER } from './interfaces/clause-type-provider.interface';
import { InlineExtractionProvider } from './providers/inline-extraction.provider';

/**
 * Clause-type provider seam (Step 2). `@Global()` so the write chokepoint
 * (DocumentProcessingService) can inject CLAUSE_TYPE_PROVIDER without importing
 * this module. Selected by `CLAUSE_TYPE_PROVIDER` (default 'inline') via the
 * Phase 9.1 adapter/useFactory pattern.
 *
 * With the flag at its default, this resolves to the InlineExtractionProvider — a
 * pure passthrough — so production is byte-identical. The 'dedicated' branch is the
 * documented seam for a future Haiku/self-hosted typer; it is NOT implemented yet
 * and fails LOUD if requested (so no one silently runs inline while expecting it).
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: CLAUSE_TYPE_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const which = config.get<string>('CLAUSE_TYPE_PROVIDER', 'inline');
        if (which === 'dedicated') {
          throw new Error(
            'CLAUSE_TYPE_PROVIDER=dedicated is not implemented yet — only "inline" is available. ' +
              'The dedicated typer (Haiku/self-hosted) is deferred to the future model-swap decision; ' +
              'wire a DedicatedTyperProvider here when that lands.',
          );
        }
        return new InlineExtractionProvider();
      },
    },
  ],
  exports: [CLAUSE_TYPE_PROVIDER],
})
export class ClauseTypingModule {}
