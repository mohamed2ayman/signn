# 7.27 Stage-0 Investigation Findings

> Written: 2026-06-06
> Author: Claude (Phase B — investigation only, no code changes)
> Status: Awaiting Ayman review and open-question decisions before Phase C

---

## Summary

pgvector is installed and the extension is enabled, but **no vector column exists anywhere in the database today** — the embedding pipeline for the Knowledge Base is an in-memory development stub, not a database-backed one. The model is OpenAI `text-embedding-3-small` (1536 dims), the SDK is already installed, but no Celery task for embeddings exists. **Phase 7.27 will be the first feature to write real vectors into Postgres.** Everything needed is present (pgvector extension, pgvector Python library, OpenAI SDK, StorageService, text extractor), but the pgvector infrastructure needs to be initialised from scratch — schema, Celery task, NestJS dispatch, and retrieval service. Jurisdiction is currently free-form `varchar(10)` with no enum; 7.27 should decide whether to introduce one or stay consistent with the existing pattern. Five decisions listed in "Open questions for Ayman" must be made before Phase C starts.

---

## 1. Pgvector Setup

### 1a. Extension enablement

Confirmed enabled in **two** locations:

| Location | Line | Content |
|---|---|---|
| `docker/init-db.sql` | 2 | `CREATE EXTENSION IF NOT EXISTS vector;` |
| `backend/src/database/migrations/1710000000000-InitialSchema.ts` | 9 | `await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "vector"')` |

The Docker image is `pgvector/pgvector:pg15` (`docker-compose.yml`, line 5) — the official pgvector-enabled Postgres 15 image. Extension is guaranteed to be available at `CREATE EXTENSION` time.

### 1b. Tables with a `vector` column

**None.** A search for `vector(` across all migration files and entity files returned zero hits. The pgvector extension is installed but no table has a `vector` column. There is no pgvector-backed embedding store today — see §2 for the in-memory stub.

### 1c. pgvector index type and distance operator

**None.** No `HNSW`, `IVFFlat`, `ivfflat`, `hnsw`, `<->`, `<=>`, or `<#>` appears anywhere in the codebase (migrations, service files, or query builders). **Phase 7.27 will create the first pgvector index in this project.**

**Decision needed (see Open Questions §Q1):** For a legal corpus — read-heavy, moderate row count (~10k chunks in v1), jurisdiction-filtered — HNSW with `vector_cosine_ops` is the right default. IVFFlat requires training (nlist tuning) and is worse for small tables. Recommend: `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`.

---

## 2. Knowledge Base Embedding Pipeline

### 2a. Embedding model

**Provider:** OpenAI
**Model:** `text-embedding-3-small`
**File:** `ai-backend/app/services/embedding_service.py`, lines 12–13:

```python
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536
```

The `openai==1.58.0` SDK is already in `ai-backend/requirements.txt` (line 5). `OPENAI_API_KEY` is in `ai-backend/.env.example` (line 7) with an empty default in `ai-backend/app/config/settings.py` (line 17).

**Important:** `OPENAI_API_KEY` is **not** in the NestJS Joi schema (`backend/src/app.module.ts`) because it is an ai-backend concern, not a backend concern. The ai-backend uses Pydantic Settings with an empty-string default — missing key causes a silent API error at embed time, not a crash at startup.

### 2b. Vector dimension

**1536 dimensions** (`ai-backend/app/services/embedding_service.py`, line 13).

No mismatch risk — there is no existing pgvector column to conflict with. The 7.27 migration will declare `vector(1536)` as the dimension.

### 2c. Celery task for embeddings

**No Celery task exists.** `ai-backend/app/tasks.py` defines 10 tasks (lines 32–204):
`run_risk_analysis`, `run_summarize`, `run_diff_analysis`, `run_extract_obligations`, `run_conflict_detection`, `run_chat`, `run_research`, `run_extract_text`, `run_extract_clauses`, `run_compliance_check`.

There is no `run_embed_*` or `run_ingest_*` task.

There **is** a FastAPI endpoint at `POST /embeddings/ingest` (`ai-backend/app/routers/embeddings.py`, lines 19–35), but it:
- Is **synchronous** (not a Celery task)
- Calls the in-memory `EmbeddingService.store_embedding()` (not Postgres)
- Is not called by any NestJS service (no `AiService.triggerEmbed*` method exists)

**Phase 7.27 must create a new Celery task** following the exact pattern of existing tasks in `tasks.py`.

### 2d. `embedding_status` transitions

The field is a `varchar(50)` on `knowledge_assets` (`knowledge-asset.entity.ts`, line 127), default `'PENDING'`. Not a TypeORM enum. The values used by `statusToProgress()` (`knowledge-assets.service.ts`, lines 291–299):

| Value | Meaning | Progress weight |
|---|---|---|
| `PENDING` | Not yet processed | 0% |
| `PROCESSING` | In flight (not set anywhere currently) | 50% |
| `INDEXED` | Embedding stored | 100% |
| `COMPLETED` | Terminal success (alias) | 100% |
| `SKIPPED` | No file to embed | 100% |
| `FAILED` | Error | 0% |

**Critical finding:** `knowledge-assets.service.ts` sets `embedding_status: 'PENDING'` on create (line 246) and bulk-create (line 598), but **never dispatches any job** and never transitions to `PROCESSING`, `INDEXED`, or `FAILED`. The `retryOcr()` method (lines 308–327) resets both `ocr_status` and `embedding_status` to `PENDING` — but again dispatches nothing. The embedding pipeline for the Knowledge Base is **a stub**.

7.27 should define its own status field. Using the same free-form varchar pattern (for consistency with KB) or a proper TypeORM enum (for type safety) — see Open Questions §Q2.

### 2e. Text chunking before embedding

**No chunking logic exists.** `EmbeddingService.generate_embedding()` (lines 34–40) passes the entire text as a single `input` to the OpenAI API with no size check, no splitting, and no overlap. `langchain==0.1.1` is installed in `requirements.txt` (line 6) but is not used for chunking anywhere in the codebase.

For legal documents, this is a significant gap. The Egyptian Civil Code (Law 131/1948) is a long text — a single embedding of the entire law is semantically useless for retrieval. **Phase 7.27 needs a chunking strategy.** See Open Questions §Q3.

### 2f. Retry path for failed embeddings

The Knowledge Base retry is triggered via `POST /knowledge-assets/:id/retry-ocr` which calls `retryOcr()` (`knowledge-assets.service.ts`, lines 308–327) and resets both `ocr_status` and `embedding_status` to `PENDING`. Since the embedding task is never actually dispatched, this retry is also a no-op today.

For 7.27, the retry endpoint for legal documents should reset `embedding_status` to `PENDING` and re-enqueue the Celery embedding task — actually completing the cycle.

---

## 3. Existing Vector Retrieval Consumers

### 3a. Any consumer querying by vector similarity?

**No.** A search for `<->`, `<=>`, `<#>`, `findNearest`, `cosine`, `ORDER BY embedding`, and similar patterns across all TypeScript service files returned zero hits. Every Knowledge Base consumer queries by SQL:

- `knowledge-assets.service.ts` filters by `organization_id`, `jurisdiction`, `tags`, `project_id`, `review_status`, `embedding_status` (lines 90–140) — all btree conditions, no vector similarity.
- `compliance-knowledge.service.ts` queries by tags and jurisdiction using SQL `IN` / `=` conditions (per CLAUDE.md Phase 3.4).
- `conversational-agent` uses the in-memory `EmbeddingService.search_similar()` — not pgvector.

**Phase 7.27 will be the first vector-similarity consumer** against Postgres. The retrieval service it builds should be designed generically enough that the Knowledge Base can use it later.

### 3b. Existing "embed query → top-K" helper

`EmbeddingService.search_similar()` (`ai-backend/app/services/embedding_service.py`, lines 64–109) exists but searches the in-memory store only. Its signature:

```python
def search_similar(
    self,
    query: str,
    org_id: str,
    filters: dict[str, Any] | None = None,
    top_k: int = 5,
) -> list[dict[str, Any]]:
```

This cannot be reused for pgvector retrieval as-is — it walks `self._store` (a Python list). **7.27 needs to build a new pgvector-backed retrieval function** in a new service (e.g., `legal_retrieval_service.py` or `legal_search_agent.py`).

---

## 4. Phase 9.1 Integration Points

### 4a. `StorageService.uploadBuffer()` — exact signature

`backend/src/modules/storage/storage.service.ts`, lines 61–70:

```typescript
async uploadBuffer(
  buffer: Buffer,
  folder: string,      // e.g. 'legal-documents'
  filename: string,    // e.g. '550e8400-e29b-41d4-a716-446655440000.pdf'
  mimeType: string,    // e.g. 'application/pdf'
): Promise<StorageResult>
```

`StorageResult` (from `interfaces/storage-adapter.interface.ts`, lines 11–16):
```typescript
interface StorageResult {
  file_url: string;    // The canonical URL to store in the DB
  file_name: string;   // Human-readable name (empty for buffer uploads)
  file_size: number;   // Bytes
  mime_type: string;
}
```

For `STORAGE_DRIVER=local` (current default), the file is written under `/app/uploads/<folder>/<filename>` and `file_url` is `http://localhost:3000/uploads/<folder>/<filename>`. The `file_url` is what goes in the `legal_documents.file_url` column — same pattern as `knowledge_assets.file_url`.

The `folder` parameter is the subdirectory under `/app/uploads/`. 7.27 should use `'legal-documents'` as the folder value.

### 4b. `BaseTextExtractor.extract_pdf()` — exact signature

`ai-backend/app/services/base_text_extractor.py`, lines 23–43:

```python
@abstractmethod
def extract_pdf(self, file_path: str, page_count: int) -> str:
```

However, **callers should use `extract()` not `extract_pdf()` directly**. The concrete `TesseractTextExtractor.extract()` (`tesseract_text_extractor.py`, lines 43–52) is the actual entry point:

```python
def extract(self, file_path: str, mime_type: str) -> dict[str, Any]:
    # Returns: { text: str, page_count: int, quality_flags: list[str] }
```

This is what `run_extract_text` calls via `service.extract(file_path, mime_type)` (`tasks.py`, line 153). 7.27 should follow the same pattern: call `service.extract(file_path, 'application/pdf')`.

**Constraint:** `extract()` requires a **local filesystem path**. For `STORAGE_DRIVER=local`, `StorageService.getLocalPathOrNull(file_url)` returns the local path. This chain breaks when `STORAGE_DRIVER=s3` — same gap documented in CLAUDE.md Phase 9.1 known-gaps §3. 7.27 is not responsible for solving this; just note it inherits the same constraint.

### 4c. Knowledge Base embedding entry point — reusability

The existing embedding entry point is the synchronous `EmbeddingService.generate_embedding(text)` (in-memory, no pgvector). There is no reusable Celery task to call.

**7.27 cannot reuse the KB embedding pipeline.** It must build its own. The good news: since `openai==1.58.0` is installed and `OPENAI_API_KEY` is read via Settings, the embedding API call itself is trivial (3 lines). The work is building the Celery task + pgvector insert + NestJS dispatch — the same pattern as existing tasks but for a new vector table.

---

## 5. Jurisdiction / Country Handling

### 5a. Is there a Jurisdiction enum?

**No.** There is no `Jurisdiction`, `Country`, or equivalent TypeScript enum anywhere in `backend/src/`. The `common/enums/` directory contains only `security-event-types.ts`.

### 5b. Project entity — country/jurisdiction storage

`backend/src/database/entities/project.entity.ts`, line 35–36:
```typescript
@Column({ type: 'varchar', length: 100, nullable: true })
country: string;
```
Free-form string, no enum, nullable.

### 5c. Knowledge Base — jurisdiction scoping query

`backend/src/modules/knowledge-assets/knowledge-assets.service.ts`, lines 134–138:
```typescript
if (filters?.jurisdiction) {
  qb.andWhere('asset.jurisdiction = :jurisdiction', {
    jurisdiction: filters.jurisdiction,
  });
}
```
Simple exact-match string filter. DTO: `@MaxLength(10) jurisdiction?: string` — accepts any string up to 10 chars.

### 5d. Values in use today

From code and seeds (`compliance-knowledge.seed.ts`, `compliance.service.ts`):
- `'EG'` — Egypt (used in 5 seed assets, normalisation map)
- `'AE'` — UAE (used in 2 seed assets, normalisation map)
- `'SA'` — Saudi Arabia (in normalisation map, no seed assets yet)
- `'UK'` — UK (mentioned in comments, one seed asset)

No `'QA'` found anywhere. `'QA'` would just be a new string value.

**Can 7.27 reuse the existing varchar(10) pattern?** Yes. Adding EG, AE, SA, QA is zero-migration work with the current varchar — just use those string codes. However, see Open Questions §Q4 for the tradeoff.

---

## 6. Proposed Schema

This section sketches columns and types — not a migration, not code. For Ayman's review.

### 6a. `legal_documents` table

Following the `knowledge_assets` entity conventions (`created_by` UUID, `created_at`/`updated_at` timestamptz, `file_url` varchar(1000)).

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | `uuid` PK | ✗ | `@PrimaryGeneratedColumn('uuid')` |
| `jurisdiction` | `varchar(10)` | ✗ | Consistent with KB. 'EG', 'AE', 'SA', 'QA'. See Q4 for enum alternative. |
| `source_type` | `enum` ('PRIMARY_TEXT', 'CURATED_SUMMARY') | ✗ | New enum: `legal_document_source_type_enum` |
| `title` | `varchar(500)` | ✗ | Mirror KB `title` length |
| `law_number` | `varchar(100)` | ✓ | e.g. '131', '182' |
| `law_year` | `int` | ✓ | Gregorian year of enactment |
| `gregorian_date` | `date` | ✓ | Full enactment date when known |
| `hijri_date` | `varchar(20)` | ✓ | e.g. '1368-07-10' — stored as string (Hijri calendar has no Postgres native type) |
| `status` | `enum` ('IN_FORCE', 'AMENDED', 'REPEALED', 'DRAFT') | ✗ | New enum: `legal_document_status_enum`; default `'IN_FORCE'` |
| `language` | `varchar(5)[]` or `enum` | ✓ | See Q5. Suggest `varchar(5)[]` array: `['AR']`, `['EN']`, `['AR','EN']` |
| `parent_law_id` | `uuid` | ✓ | Self-FK `ON DELETE SET NULL`. For "regulation implements law" / "decree amends" |
| `file_url` | `varchar(1000)` | ✓ | From `StorageService.uploadBuffer()`. Null if text-only entry |
| `file_name` | `varchar(500)` | ✓ | Human-readable original filename |
| `content_hash` | `varchar(64)` | ✓ | SHA-256 of raw PDF bytes. For dedup + future change-detection |
| `source_url` | `text` | ✓ | Provenance URL (e.g. eta.gov.eg PDF link) |
| `source_attribution` | `varchar(500)` | ✓ | e.g. 'Egyptian Tax Authority, eta.gov.eg' |
| `embedding_status` | `varchar(50)` | ✗ | Match KB pattern (varchar, not enum): 'PENDING' / 'PROCESSING' / 'INDEXED' / 'FAILED'. Default 'PENDING'. |
| `extracted_text` | `text` | ✓ | Full extracted text, stored after OCR. Needed for the chunking step and for admin review |
| `created_by` | `uuid` | ✓ | FK → `users.id` ON DELETE SET NULL. Convention matches KB and contracts |
| `created_at` | `timestamptz` | ✗ | `@CreateDateColumn` |
| `updated_at` | `timestamptz` | ✗ | `@UpdateDateColumn` |

**Flags on the proposed schema:**
- `extracted_text` is proposed as a new column not present in KB. KB re-reads from the file whenever text is needed. For a legal corpus, having the text available directly is valuable for the chunking step and for admin inspection. At typical legal document lengths (Civil Code ~200 pages), a text column is manageable.
- `language` as `varchar(5)[]` (Postgres array) follows the `detected_languages jsonb` pattern on KB but in a more structured way. Alternative: two boolean columns (`is_arabic`, `is_english`) — simpler but less extensible.
- `law_number` + `law_year` are separate from `gregorian_date` because many laws in Egyptian / UAE / Saudi legal tradition are cited by number+year (`Law 131 of 1948`) without a specific day being well-known.

### 6b. `legal_document_chunks` table

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | `uuid` PK | ✗ | |
| `legal_document_id` | `uuid` FK | ✗ | → `legal_documents.id` ON DELETE CASCADE |
| `jurisdiction` | `varchar(10)` | ✗ | Denormalised from `legal_documents` for index-only scans. Matches KB pattern (no KB equivalent table exists, so this sets the convention). |
| `chunk_index` | `int` | ✗ | 0-based position within the document |
| `chunk_text` | `text` | ✗ | The text slice that was embedded |
| `embedding` | `vector(1536)` | ✓ | pgvector. Null until the Celery task completes |
| `article_reference` | `varchar(100)` | ✓ | e.g. 'Article 147', 'مادة 147'. For citation surfacing in AI chat |
| `token_count` | `int` | ✓ | Approximate token count of `chunk_text`. Useful for debugging and future cost tracking |
| `created_at` | `timestamptz` | ✗ | `@CreateDateColumn` |

**Flag:** `embedding` nullable is deliberate — the row is inserted synchronously (during text splitting), and the vector is filled asynchronously by the Celery embedding task. This allows the NestJS controller to return immediately after creating the document and chunks, while the background task fills in embeddings. Mirrors the way `document_uploads.processing_status` advances.

### 6c. Proposed indexes

```sql
-- legal_documents
CREATE INDEX idx_legal_documents_jurisdiction_status
  ON legal_documents (jurisdiction, status);

CREATE INDEX idx_legal_documents_parent_law_id
  ON legal_documents (parent_law_id)
  WHERE parent_law_id IS NOT NULL;   -- partial: most rows have no parent

CREATE UNIQUE INDEX uq_legal_documents_content_hash
  ON legal_documents (content_hash)
  WHERE content_hash IS NOT NULL;    -- dedup guard

-- legal_document_chunks
CREATE INDEX idx_legal_document_chunks_document_id
  ON legal_document_chunks (legal_document_id);

CREATE INDEX idx_legal_document_chunks_jurisdiction_status
  ON legal_document_chunks (jurisdiction);   -- for WHERE jurisdiction = 'EG' pre-filter

-- pgvector HNSW index (created separately — HNSW build is slow for large tables,
-- best done after bulk insert is complete in Phase D)
CREATE INDEX idx_legal_document_chunks_embedding
  ON legal_document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

**Flag on denormalised `jurisdiction` in chunks:** The compliance KB service adds `jurisdiction` to query filters frequently. Pre-filtering `WHERE jurisdiction = 'EG'` before the pgvector ANN scan is significantly faster than scanning all chunks and post-filtering. This is a standard pgvector pattern for multi-tenant or multi-jurisdiction corpora. The cost is one extra varchar(10) column per chunk row — negligible.

**Flag on HNSW parameters:** `m=16, ef_construction=64` are the pgvector defaults and appropriate for a corpus of ~10k chunks (v1 Civil Code). These can be tuned upward later when the corpus grows. Do NOT set `ef_search` globally — leave it at the default (40) and tune per-query if needed.

---

## 7. Enum Conventions

TypeORM enum columns generate PostgreSQL enum types following this pattern: `<snake_case_column_name>_enum` where the prefix comes from the **column name** (sometimes also influenced by the entity table name, depending on TypeORM version and config).

**Canonical example to mirror — `ObligationStatus`:**

TypeScript entity (`obligation.entity.ts`, lines 23–50):
```typescript
export enum ObligationStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  OVERDUE = 'OVERDUE',
  MET = 'MET',
  WAIVED = 'WAIVED',
}

@Column({ type: 'enum', enum: ObligationStatus })
status: ObligationStatus;
```

Migration (`InitialSchema.ts`, lines ~80–86) creates the type as:
```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'obligation_status') THEN
    CREATE TYPE "obligation_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE');
  END IF;
END $$;
```

**Lesson #143 applies:** Later migrations that need to `ALTER TYPE` must use the actual PostgreSQL type name returned by:
```sql
SELECT typname FROM pg_type WHERE typname LIKE '%obligation%';
-- → obligation_status  (NOT obligation_status_enum in this case)
```

For 7.27 we create new types from scratch. We control the name. Recommendation: use `legal_document_source_type_enum` and `legal_document_status_enum` (explicit `_enum` suffix) — avoids ambiguity with any future TypeORM auto-generation and makes the lesson #143 check a no-op (we already know our type name).

---

## 8. Async / Celery Flow

### 8a. How existing ingestion pipelines chain

The canonical flow for document processing (`document-processing.service.ts`):

1. **NestJS** receives file upload → saves to StorageService → creates `document_uploads` row with status `UPLOADED`
2. **NestJS** calls `this.aiService.triggerExtractText({ file_path, mime_type })` → `POST http://ai-backend:8000/agents/extract-text`
3. **FastAPI** router receives POST → dispatches `tasks.run_extract_text.delay(data)` → returns `{ job_id, status: 'queued' }`
4. **Celery worker** runs `run_extract_text` → calls `service.extract(file_path, mime_type)` → returns `{ text, page_count, quality_flags }`
5. **NestJS** polls `GET /agents/job/:job_id` → when complete, calls `pollAndAdvance()` → updates DB row, enqueues next task (clause extraction)

For 7.27 (legal document ingestion), the equivalent chain would be:

1. **NestJS admin endpoint** receives PDF → `StorageService.uploadBuffer()` → creates `legal_documents` row (status `PENDING`) → calls `AiService.triggerExtractLegalText()`
2. **FastAPI** dispatches `tasks.run_extract_legal_text` → returns job_id
3. **Celery** runs extraction → NestJS polls → on text ready, creates `legal_document_chunks` rows with `embedding = null`
4. **NestJS** calls `AiService.triggerEmbedLegalChunks(documentId)`
5. **FastAPI** dispatches `tasks.run_embed_legal_chunks` → for each chunk, calls OpenAI embeddings API → writes `vector(1536)` back via DB update
6. NestJS polls → on complete, sets `legal_documents.embedding_status = 'INDEXED'`

**Alternative simpler chain:** Since text extraction for a legal PDF is fast (few pages, digital PDF — no OCR needed for the Civil Code), steps 1–3 can be collapsed: NestJS extracts text synchronously (the text extractor for digital PDFs is fast and synchronous), creates chunks, then dispatches one Celery task for bulk embedding. This is simpler and avoids two polling rounds for a document type that doesn't need async OCR.

See Open Questions §Q3 — the chunking strategy decision affects which chain is correct.

### 8b. Queue names

The Celery app (`ai-backend/app/tasks.py`, lines 14–18) uses the default Celery queue (no explicit `queue=` parameter on any task). The broker and result backend are both Redis (`settings.REDIS_URL`). No named queues are used in this project — all tasks go to the default queue.

7.27 tasks should follow the same convention: no `queue=` parameter.

---

## 9. Admin-Only Endpoint Pattern

**Canonical example — `AdminOrganizationsController`:**

```typescript
// backend/src/modules/admin-organizations/admin-organizations.controller.ts
@Controller('admin/organizations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SYSTEM_ADMIN)
export class AdminOrganizationsController {
  @Get()
  list(@Query() query: ListOrganizationsQueryDto) { ... }

  @Put(':id/suspend')
  suspend(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SuspendOrganizationDto,
    @CurrentUser() user: { id: string },
  ) { ... }
}
```

**Key elements 7.27 must replicate:**
- `@Controller('admin/legal-documents')` — route prefix under `/admin/`
- `@UseGuards(JwtAuthGuard, RolesGuard)` — both guards at controller level
- `@Roles(UserRole.SYSTEM_ADMIN)` — SYSTEM_ADMIN is the correct role for admin upload (same as waitlist admin endpoint in `waitlist.controller.ts`)
- `@CurrentUser()` decorator to get the uploader's user ID for `created_by`
- `@UploadedFile()` + `FileInterceptor` with `limits: { fileSize: 50 * 1024 * 1024 }` (Phase 3.4 hard rule — every FileInterceptor must have a size limit)

---

## 10. Other Observations

### 10a. Migration numbering convention

The last 5 migrations:
```
1751000000004-AddKnowledgeAssetProjectScope.ts
1751000000005-AddHumanReviewQualityFlags.ts
1752000000001-AddGuestAuthzSpine.ts
1752000000002-AddGuestInvitations.ts
1753000000001-AddMeteringPrimitive.ts
1754000000001-AddReservationIdToComplianceChecks.ts
```

Pattern: `<prefix><sequence>-DescriptiveName.ts` where prefix is ~10 digits. The prefix appears to be a loose Unix-timestamp approximation (1754 ≈ early June 2026 in whatever epoch is being used). For 7.27, use `1755000000001` through `1755000000003` (depending on how many migrations are needed — likely 2: one for tables + extension setup, one for the HNSW index created after bulk seed).

**Hard rule from lesson #143:** Any `ALTER TYPE` migration targeting a 7.27 enum must use the exact PostgreSQL type name — run `SELECT typname FROM pg_type WHERE typname LIKE '%legal%'` to verify before writing the migration.

### 10b. Knowledge Assets module structure

```
backend/src/modules/knowledge-assets/
  knowledge-assets.controller.ts     -- HTTP endpoints (upload, list, update, retry, versions, usages)
  knowledge-assets.service.ts        -- Business logic (1 file, ~600 lines)
  knowledge-assets.module.ts         -- Module definition (no Bull queue!)
  dto/
    bulk-create-knowledge-asset.dto.ts
    check-duplicate.dto.ts
    create-knowledge-asset.dto.ts
    update-knowledge-asset.dto.ts
  services/
    risk-methodology-reader.service.ts   -- Phase 7.17 sub-service
  *.spec.ts                              -- Test files
```

**Notable:** No Bull queue, no processor, no queue injection. The module imports only `TypeOrmModule` + `StorageModule`. This confirms the finding that embedding is a stub.

7.27's legal-documents module will have a similar shape but with the addition of `AiModule` (for HTTP dispatch to ai-backend) — mirroring `DocumentProcessingModule`'s structure.

### 10c. `OPENAI_API_KEY` scope

The key lives only in the ai-backend (`ai-backend/.env.example`, `ai-backend/app/config/settings.py`). The NestJS Joi schema does not validate it. This is correct architecture: NestJS calls ai-backend via HTTP; the ai-backend calls OpenAI. 7.27 follows the same pattern — no changes to the NestJS Joi schema needed for OpenAI.

**Warning:** The OpenAI key defaults to empty string in `settings.py`. An empty key causes a silent `401 Unauthorized` from OpenAI at embed time — not a crash at startup. Consider adding a startup assertion in the embedding Celery task or FastAPI router (similar to `MeteringService.onModuleInit()` for READ COMMITTED) to fail loudly if the key is empty when an embed task is attempted. This is not a blocker for Phase C but should be noted.

### 10d. `langchain` is installed but unused for chunking

`langchain==0.1.1` + `langchain-community==0.0.13` + `langchain-openai==0.0.3` are in `requirements.txt` (lines 6–8). None are used for chunking or text splitting anywhere in the codebase. They appear to be aspirational dependencies. 7.27 can use `langchain`'s `RecursiveCharacterTextSplitter` for chunking without adding any new dependency.

### 10e. `pgvector==0.2.4` Python library already installed

`requirements.txt`, line 11. The psycopg2/SQLAlchemy pgvector adapter is ready. The 7.27 embedding Celery task can use it to do bulk `INSERT INTO legal_document_chunks (embedding) VALUES (...)` using pgvector's Python binding. No new `pip install` needed.

### 10f. `init-db.sql` uses the old `EXCEPTION WHEN` anti-pattern (lesson #111)

`docker/init-db.sql` (lines 5–55) uses `EXCEPTION WHEN duplicate_object THEN NULL` for all its `CREATE TYPE` blocks — the anti-pattern from lesson #111 that was corrected across all migrations in Phase 7.9. This file is not a TypeORM migration and runs only on fresh DB init (not on existing envs). It is out of scope for 7.27 but is flagged here as a known hygiene debt.

### 10g. The AI Chat agent could immediately benefit from 7.27's retrieval

`run_chat` task calls `ConversationalAgent.chat()` which already accepts a `knowledge_context` parameter (`tasks.py`, line 114). The NestJS chat service currently injects Knowledge Base content as `knowledge_context`. Once 7.27 builds the pgvector retrieval service, the chat endpoint can also retrieve relevant legal chunks and pass them as additional context — without changing the Celery task signature. This is the "wire AI Chat as first consumer" that Phase E specifies.

---

## Open Questions for Ayman

These must be decided before Phase C (implementation) starts. No implementation decision is blocked on each other — each can be answered independently.

**Q1 — HNSW vs IVFFlat?**
For v1 (~10k chunks), HNSW is the better choice: faster queries, no training step, better accuracy at small-to-medium scale. IVFFlat is better above ~1M rows. Recommend HNSW. Do you want to override this?

**Q2 — `embedding_status` as varchar (consistent with KB) or TypeORM enum (type-safe)?**
The Knowledge Base uses `varchar(50)` for `embedding_status` — it's a stub pattern that was never finished. For `legal_documents`, we can do it properly with a TypeORM enum from the start (`PENDING | PROCESSING | INDEXED | FAILED`). This is slightly inconsistent with the KB but is the right pattern. My recommendation: **use a proper TypeORM enum on `legal_documents`** (model the correct pattern; KB can be aligned later). Agree?

**Q3 — Chunking strategy for legal text?**
The Egyptian Civil Code has articles of varying lengths. Two options:
- **Option A (article-boundary chunking):** Split at مادة/article markers, keeping each article as one chunk. Articles average ~200–400 Arabic words. This preserves legal meaning but some articles are very long (definitions article can be 2000+ words).
- **Option B (fixed-size with overlap, using langchain's RecursiveCharacterTextSplitter):** `chunk_size=1000 tokens, overlap=100 tokens`. Simpler, works for any language, but splits mid-article sometimes. Langchain is already installed.

Which do you prefer? Or a hybrid (article-boundary first, then split oversized articles at sentence boundaries)?

**Q4 — Jurisdiction: stay varchar(10) or introduce a proper enum?**
- **Stay varchar(10):** Zero migration complexity, consistent with KB, adding a new country is purely data. Risk: no compile-time validation, typos are silent.
- **Introduce `legal_document_jurisdiction_enum`:** Type safety, compile-time validation, but requires a migration for every new country. For v1 with 4 countries this is manageable.

My recommendation: **stay varchar(10)** for `legal_documents.jurisdiction` (consistent with KB pattern, and new jurisdictions are data changes not code changes — better for a growing product). The DTO can use `@IsIn(['EG','AE','SA','QA'])` for runtime validation without needing a DB enum. Agree?

**Q5 — `language` field: array vs separate columns?**
- **`varchar(5)[]` array** (e.g. `['AR']`, `['AR','EN']`): Flexible, expressive, requires `ANY(language)` in queries.
- **Separate boolean columns** (`is_arabic boolean, is_english boolean`): Simpler SQL, but extends poorly beyond two languages.
- **`varchar(5)` single value** (e.g. `'AR'`): Simple but can't model bilingual documents.

Recommend `varchar(5)[]` array with btree index. Agree?

**Q6 — `extracted_text` column: store on `legal_documents` or keep ephemeral?**
The Civil Code PDF → extracted text (~500KB). Storing it on the row avoids re-extracting for admin review, debugging, or re-chunking. Cost: one large text column per document. For a corpus of ~50 laws this is ~25MB total — completely negligible. Recommend storing. Agree?

---

## Risks / Unknowns

**R1 — The embedding pipeline for Knowledge Base is a complete stub.**
Setting `embedding_status = 'PENDING'` and never dispatching — this means the KB has never actually embedded anything in production. 7.27 builds the first real embedding pipeline. There is no existing pipeline to validate against. Mitigation: the OpenAI SDK call is 3 lines; the risk is in the pgvector bulk insert + retrieval logic, which is well-documented in pgvector Python docs.

**R2 — OPENAI_API_KEY must be set for Phase D (seeding) to work.**
The key is in `ai-backend/.env.example` but is not validated on startup — a missing key produces a silent 401 at embed time. Before Phase D, verify the key is set in the local `ai-backend/.env`.

**R3 — The Civil Code PDF quality is unknown.**
If the PDF from eta.gov.eg is a scanned image (not digital text), it goes through Tesseract OCR — which is Arabic-capable but not perfect. A digital-text PDF would produce clean extracted text. This affects chunking quality. Will only be known when Ayman provides the PDF.

**R4 — HNSW index build is slow for large tables.**
HNSW construction is an O(n log n) operation. For v1 (~10k chunks from the Civil Code), build time is ~30 seconds on a dev machine — acceptable. For Phase G when many laws are added, index builds should be done during low-traffic windows. Not a v1 blocker.

**R5 — `STORAGE_DRIVER=s3` breaks the local-path requirement.**
The text extractor requires a local filesystem path (`getLocalPathOrNull()`). This is the same gap documented in CLAUDE.md Phase 9.1 known-gaps §3 for document processing. 7.27 inherits this constraint — not a new problem, but means the full pipeline only works with `STORAGE_DRIVER=local` until Phase 9.1 gap §3 is resolved.

**R6 — Single Celery queue, no priority.**
All tasks share the default Celery queue. A large embedding job (embedding 500 chunks from a long law) could back up other tasks (risk analysis, clause extraction) for minutes. For v1 with light usage this is acceptable. As the legal corpus grows, a dedicated queue or priority routing may be needed. Not a Phase C blocker.

**R7 — `langchain==0.1.1` is old.**
The installed langchain version is from early 2024. Its API is stable for `RecursiveCharacterTextSplitter` but if Q3 leads to a more complex chunking approach, the older API may be limiting. If chunking complexity grows, consider upgrading langchain (requires Docker rebuild). No action needed for Phase C.
