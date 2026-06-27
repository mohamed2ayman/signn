# AI Prompt Inventory (Phase 8.1)

> Living inventory of every prompt SIGN sends to the Claude API, each tagged with
> its intended open-source replacement. Maintained as agents change. The
> point-in-time investigation that produced this lives in
> [`phase-8.1-investigation.md`](phase-8.1-investigation.md); **this file is the
> canonical inventory to keep current.**
>
> Last updated: 2026-06-22 (Phase 8.1).

## Ground facts

- **All Claude prompts live in `ai-backend/app/agents/`** (9 agents). Each prompt's
  text is an inline module-level `SYSTEM_PROMPT` constant in its agent file.
- **Model id is centralized (Phase 8.1):** every agent reads
  `settings.ANTHROPIC_MODEL` (`ai-backend/app/config/settings.py`, default
  `claude-sonnet-4-6`, overridable via the `ANTHROPIC_MODEL` env var). There is no
  longer a hardcoded model string in any agent.
- **All invocations are async** via Celery (`ai-backend/app/tasks.py`), dispatched
  from the NestJS bridge `backend/src/modules/ai/ai.service.ts`
  (`POST /agents/* → {job_id} → GET /agents/jobs/:id`). The NestJS backend has no
  Anthropic SDK.
- **Embeddings (OpenAI `text-embedding-3-small`) and OCR (Tesseract) are NOT Claude
  prompts** — excluded from this inventory (embeddings change = coordinated
  re-embedding migration; OCR = Phase 8.2).

## The 9 Claude prompts

| # | Agent file | Celery task | Purpose | `max_tokens` | Chunks? | Retry? | Arabic | Intended OSS replacement (trial in 8.4/8.5) |
|---|---|---|---|---|---|---|---|---|
| 1 | `clause_extractor.py` | `run_extract_clauses` | Structured clause extraction (verbatim) | 16k/24k/32k tiered | yes (>30k→15k boundaries) | yes (4×) | **CRITICAL** | **ContractBERT** (classify) + **LEGAL-XLM-RoBERTa** (Arabic/bilingual) — self-hosted; hardest to replace |
| 2 | `risk_analyzer.py` | `run_risk_analysis` | PMBOK 5×5 risk scoring + rationale | 4096 | no | no | HIGH | **ContractBERT fine-tuned** (risk classification) + **Mistral 7B / DeepSeek-R1-Distill-Qwen-32B** (risk explanation) |
| 3 | `compliance_checker.py` | `run_compliance_check` | Multi-layer compliance findings | 8192 | no | no | HIGH+legal | Command-R+ / Qwen2.5-72B (RAG) — leaning LEGAL-XLM-RoBERTa for Arabic legal |
| 4 | `conflict_detector.py` | `run_conflict_detection` | Cross-document conflict detection | 8192 | no | no | HIGH | Qwen2.5-72B (cross-doc reasoning) |
| 5 | `obligations_extractor.py` | `run_extract_obligations` | Obligation extraction | 4096 | no | no | HIGH | Qwen2.5-32B/72B → fine-tune (extraction is tractable) |
| 6 | `summarizer.py` | `run_summarize` | 17-element contract summary | 4096 | no (latent large-doc risk) | no | MEDIUM | Qwen2.5-32B / Command-R |
| 7 | `diff_analyzer.py` | `run_diff_analysis` | Version diff of clause sets | 4096 | no | no | MEDIUM | Qwen2.5-32B |
| 8 | `conversational_agent.py` | `run_chat` | AI chat + citations (legal context) | 4096 | no | no | HIGH | Qwen2.5-72B / Command-R+ (RAG + citations) |
| 9 | `research_agent.py` | `run_research` | Legal-asset research by keywords | 4096 | no | no | LOW | Qwen2.5-14B/32B / Llama-3.1-8B (easiest win) |

**Team's current leaning** (self-hosted, data stays inside our AWS — not yet
selected or tested; confirmed/tested in 8.4/8.5): ContractBERT (clause + risk
classification), Mistral 7B / DeepSeek-R1-Distill-Qwen-32B (risk explanation
generation), LEGAL-XLM-RoBERTa (Arabic/bilingual). See `phase-8.1-investigation.md`
§3 for the full candidate table and rationale.

## Migration rule

No prompt migrates to a replacement model unless **(a)** the Arabic accuracy suite
was run against the candidate on the baseline, **and (b)** Arabic accuracy holds or
improves vs the `claude-sonnet-4-6` baseline. **Quality is the deciding factor;
cost is recorded for awareness but is not a blocker.** Never migrate without running
the Arabic suite first; migrate one prompt at a time; embeddings excluded.

The baseline + harness live in
[`ai-backend/tests/accuracy/`](../ai-backend/tests/accuracy/README.md).
