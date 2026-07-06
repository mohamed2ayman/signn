# Phase 8.3 — Label Studio Annotation Setup — Plan (current-state update)

> **Status:** Investigation only (read-only). No code, no install, no execution.
> **This supplements** `docs/phase-8.3-investigation.md` (Ayman, 2026-06-28) —
> it does NOT replace it. That doc's data-field map, confidentiality stance, and
> 11 decisions still hold; this doc **updates the state** (the risk pre-labeling
> pass is now DONE), fills the gaps it left open (concrete task design, the
> labeling-config XML, the re-import path, effort hours), and adds the **cleanup
> items** surfaced during today's extraction work.
> **Date:** 2026-07-04

---

## 0. TL;DR

- **The corpus is ready.** 508 clauses across 15 contracts, **100% pre-labeled**:
  `clause_type` + `confidence_score` on every clause, and — new since the 2026-06-28
  doc — **risk pre-labels landed** (1,061 `risk_analyses` rows across **507/508**
  clauses; the 1 unlabeled is genuinely 0-risk boilerplate). Ayman's doc listed the
  risk pass as pending/optional; it's **done**.
- **8.3 is a purely-local, read-only build.** Label Studio in its own Docker
  container (port 8080), an offline read-only export script (SIGN Postgres →
  Label Studio JSON with `predictions`), human review, JSON-MIN export → JSONL gold
  for 8.4/8.5. **No AWS, no cost, no change to any production code.**
- **Two annotation projects** (clause-type + risk), pre-filled so annotators
  *accept-or-correct* rather than label from scratch.
- **Effort:** ~**15–20 hours single-annotator** for a full review of all 508
  (clause-type ~3–4h, risk ~12–15h); AI pre-labels cut it ~3–5× vs from-scratch.
- **Two state facts that change Ayman's assumptions:** (a) **all 508 are
  `PENDING_REVIEW`** — there is currently **zero "free gold"** from in-app
  `APPROVED`/`EDITED` clauses (the doc assumed some might exist); (b) **zero
  `is_proposed` clauses** — nothing to exclude, the corpus is clean.

---

## 1. What the existing doc (`phase-8.3-investigation.md`) already plans

Ayman's investigation is solid and mostly still correct. Summary:
- **Reuse stored labels, don't re-run the AI** — `clause_type`/`confidence_score`
  and risk `level`/`score` are already persisted; 8.3 is a **read-only DB export**,
  not an AI re-invocation.
- **Label vocabularies from real usage** — clause type = the **17-value** extractor
  set; risk = the AI's **4-level severity** (`low/medium/high/critical`, richer than
  the 3-level DB `RiskLevel`; `risk_score` 1–25 carries the "critical" band).
- **Two Label Studio projects** (Clause Type / Risk), tasks pre-filled via
  `predictions`.
- **Risk is finding-level (0..N per clause)** → the clause-level risk label is
  **derived** (D4: worst / max-`risk_score` finding; no-finding → `low`/`none`).
- **Confidentiality is the dominant control** — real client/government contracts;
  **anonymize on export** (reuse the 8.1 placeholder approach) + keep the instance
  **strictly local**; never commit raw exports.
- **Import** Label Studio JSON with `predictions`; **export** JSON-MIN → transform
  to JSONL `{text, label, source_clause_id, was_corrected}`.
- **Touches existing code: none** — read-only export; no entity/migration/endpoint.
- 11 decisions, each with a recommendation (reuse-vs-rerun, schemas, risk unit,
  data location, confidentiality, formats, review depth, offline-vs-ML-backend,
  source corpus, script location).

**What it left open / now needs updating:** the risk pass was pending (now done);
the "do we have ≥500 labeled clauses?" question (now answered: 508/507); the
concrete labeling-config XML; the exact re-import mechanics; effort hours; and the
**cleanup items** (§6) which surfaced *after* it was written.

---

## 2. How Label Studio runs (self-hosted Docker) — fits alongside SIGN

**Run it as a SEPARATE container, NOT in the SIGN `docker-compose.yml`** — this
keeps it fully decoupled and unable to disrupt the SIGN stack.

```
docker run -d --name sign-label-studio -p 8080:8080 \
  -v <repo>/label-studio-data:/label-studio/data \
  heartexlabs/label-studio:latest
```

- **Port 8080** — no collision with the SIGN port map (5173 sign, 5175 managex,
  3000 backend, 8000 ai-backend, 5432 postgres, 6379 redis). Clean.
- **Storage:** the mounted `label-studio-data/` volume holds Label Studio's own
  **SQLite** DB + uploaded tasks. It never touches SIGN's Postgres. **Gitignore it.**
- **Resources:** light — ~1–2 GB RAM, single container, SQLite backend (no external
  DB needed for a one-time dataset build). Runs comfortably alongside the SIGN stack
  on the same machine.
- **No coupling to SIGN:** Label Studio does not connect to SIGN's DB or services.
  The only bridge is the **offline export JSON** a human imports via the UI/API.
  This is the safest v1 shape (a live ML-backend integration is possible later but
  unnecessary for a one-off).
- **Access:** bind to localhost only (real contract data). First run creates an
  admin account in the local SQLite.

**Non-disruption guarantee:** because it's a standalone `docker run` (not a compose
service) on its own port + volume, starting/stopping it has **zero effect** on the
SIGN containers.

---

## 3. Data export — DB → Label Studio

**Shape:** a read-only export script (Python, naturally in `ai-backend/` next to the
8.1 accuracy harness, or a small `tools/` script) that JOINs the three tables and
emits **one Label Studio task per clause**, with the stored labels as `predictions`.

**The join (all read-only):**
```
contract_clauses cc            -- per-contract instance (the annotation unit)
  JOIN clauses cl ON cl.id = cc.clause_id            -- text + clause_type + confidence
  JOIN contracts ct ON ct.id = cc.contract_id        -- project/contract name
  LEFT JOIN risk_analyses ra ON ra.contract_clause_id = cc.id   -- 0..N risk findings
WHERE cc.is_proposed = false                          -- (currently 0 anyway)
```

**Fields per clause task:**

| Task field | Source | Purpose |
|---|---|---|
| `data.text` | `clauses.content` (**anonymized**) | the clause text to annotate |
| `data.title` | `clauses.title` | read-only context |
| `data.section_number` | `contract_clauses.section_number` | read-only context |
| `data.contract` | `contracts.name` | which project (context + slicing) |
| `data.language` | derived (Arabic / English / Bilingual) | RTL rendering + filtering |
| `data.ai_confidence` | `clauses.confidence_score` | confidence-routing |
| `data.clause_db_id` | `clauses.id` | re-import join key |
| `data.contract_clause_id` | `contract_clauses.id` | re-import join key (risk link) |
| `predictions[clause_type]` | `clauses.clause_type` (lowercased) | pre-filled clause-type answer |
| `predictions[risk_level]` | **derived** worst-finding `risk_level`/severity | pre-filled clause risk answer |
| `data.risk_findings[]` | the `risk_analyses` rows (category, level, L×I, description) | read-only context for the risk project |

**Two projects, two exports** (per Ayman's D-decisions): one file for the clause-type
project, one for the risk project — same clause set, different `predictions`.

**Anonymization (mandatory, per §5 of Ayman's doc):** run each `content` through the
8.1-style placeholder pass (`[PARTY_A]`, `[PROJECT]`, `[AMOUNT]`, `[DATE]`, …) at
export time. Clause type + risk depend on *legal content*, not party names/amounts,
so anonymized labels stay valid. The raw (un-anonymized) export is never committed.

**Grounding the numbers (verified today):** 508 clauses, all `AI_EXTRACTED`, all
`PENDING_REVIEW`, all `is_proposed=false`; `clause_type` 100% populated (17-value
set, `general` 30% down to `indemnification` 0.4%); `confidence_score` 100%
populated (avg 0.96, range 0.70–0.99); risk 1,061 rows across 507 clauses
(`risk_level` MEDIUM 82% / HIGH 14% / LOW 4%).

---

## 4. Annotation task design — what annotators DO + how clauses are presented

### Project A — Clause Type (1 label per clause)
The annotator reads the clause and **confirms or corrects** the single pre-filled
`clause_type` (17-value single-select). One decision per clause. Fast, because the
AI pre-label is right most of the time — the work is catching the ~30% `general`
over-absorption (some `general` clauses belong in `liability`/`indemnification`/etc.)
and the sparse-category misses.

**Labeling config (XML):**
```xml
<View>
  <Text name="text" value="$text" />
  <Header value="$title  ·  §$section_number  ·  $contract  ·  $language" />
  <Choices name="clause_type" toName="text" choice="single" showInLine="false">
    <Choice value="general"/><Choice value="payment"/><Choice value="liability"/>
    <Choice value="termination"/><Choice value="indemnification"/>
    <Choice value="force_majeure"/><Choice value="dispute_resolution"/>
    <Choice value="confidentiality"/><Choice value="compliance"/><Choice value="insurance"/>
    <Choice value="warranty"/><Choice value="intellectual_property"/>
    <Choice value="scope_of_work"/><Choice value="variations"/><Choice value="defects"/>
    <Choice value="time"/><Choice value="other"/>
  </Choices>
</View>
```

### Project B — Risk (1 clause-level label + finding review)
Two things per clause:
1. **Confirm/correct the clause-level risk level** (the derived worst-finding
   severity: `none/low/medium/high/critical`), and
2. **Review the individual findings** shown as context — is each real? correct
   level/category? any missing? The findings are read-only context; the annotator's
   verdict is the clause-level label + (optionally) a free-text note flagging
   spurious findings (the AI is **over-eager on boilerplate** — e.g. it put 2–3
   low-severity risks on a "Definitions" clause).

**Labeling config (XML):**
```xml
<View>
  <Text name="text" value="$text" />
  <Header value="$title  ·  §$section_number  ·  $contract" />
  <Text name="findings" value="$risk_findings_pretty" />   <!-- read-only AI findings -->
  <Choices name="risk_level" toName="text" choice="single">
    <Choice value="none"/><Choice value="low"/><Choice value="medium"/>
    <Choice value="high"/><Choice value="critical"/>
  </Choices>
  <TextArea name="notes" toName="text" rows="2"
            placeholder="Flag spurious/missing findings (optional)"/>
</View>
```

### Presentation for the corpus's real variety
- **Arabic RTL (~84% of clauses):** Label Studio renders text direction from the
  content, but to be safe wrap the `<Text>`/`<View>` with `dir="rtl"` styling for
  Arabic tasks (drive it off `data.language`). Long Arabic clauses (the corpus has
  clauses up to ~16k chars) scroll within the task pane — fine; no truncation.
- **Bilingual Project13 (13 clauses):** each clause holds BOTH the English and the
  Arabic of the same article in one `content`. Present it as-is — **one label for
  the bilingual clause** (clause type + risk are properties of the *concept*, not
  the language). They're ~2× length; annotators read whichever language they prefer.
  No special handling beyond mixed-direction rendering.
- **Long clauses:** scroll; consider a max-height pane. No splitting — the label is
  for the whole clause.
- **English-only (Project_1/7/11 + Annex 7):** standard LTR.

---

## 5. Re-import — corrected labels back to DB / gold export for 8.4

Two consumers of the reviewed annotations; **the gold JSONL is the primary one**
(8.4/8.5 train from it, not from the DB).

**(a) Gold dataset for 8.4/8.5 (primary):** export Label Studio **JSON-MIN** →
a small transform to JSONL the trainer reads:
```json
{ "text": "...", "label": "payment", "source_clause_id": "<uuid>",
  "contract": "Project6", "language": "Arabic",
  "ai_label": "general", "was_corrected": true, "verified_by": "annotator" }
```
Keep **`was_corrected`** (annotation ≠ AI prediction) — it's the map of where the
current AI is weak, directly useful for 8.4/8.5. Same shape for risk
(`label` = the verified level). This JSONL is the deliverable; it's gitignored.

**(b) Optional write-back to SIGN DB (secondary, NOT required for 8.4):** if you
also want the corrections reflected in-app, a separate one-off importer could join
JSON-MIN back on `data.clause_db_id` / `data.contract_clause_id` and update
`clauses.clause_type` + `clauses.review_status = EDITED/APPROVED` (and risk statuses).
This is a **write path** — out of scope for a read-only v1; do it only if the app
should show the verified labels. The **existing in-app clause-review flow already
supports** `review_status` + `clause_type` correction, so this write-back would
target those same columns. **Recommendation: skip write-back for v1** — the gold
JSONL is what training needs; keep 8.3 read-only.

---

## 6. Cleanup items to handle during annotation (surfaced today)

These are extraction artifacts found during today's work. Annotation is exactly the
place to resolve them — the human catches what the pipeline got wrong. Current DB
state (verified):

| Item | Current DB state | How annotation handles it |
|---|---|---|
| **Project12 clause 4** (القانون — governing law) | **Fragmented into 2 GC rows**: a 41-char **heading-only** fragment + a 395-char partial body; **sub-article 4-2 was lost** at a mid-word chunk cut (documented in `no-overlap-split-investigation.md`) | Annotator sees a near-empty heading clause + a truncated body clause. **Action: flag/reject the 41-char fragment (exclude from gold) and note clause 4 is incomplete** (4-2 missing). It should NOT go into training as-is. The clean fix is a re-extract (Option A/D from the investigation, not shipped) — until then, exclude/flag it. |
| **Project12 clause 8** (سعر العقد) | **One whole clause now** (3,547 chars, 3 risks) — the current run stitched it | No action — it came back correct this run. (Historically it split; the fix is model-dependent. If a future re-extract splits it again, the same "flag the fragment" rule applies.) |
| **Project11 clause 21** (attachment fragment) | A short attachment/annex-reference clause (I could not match it by `section_number='21'` — likely a different section label or the last `order_index`; confirm at export) | Annotator marks it as boilerplate/attachment-reference — likely `other` or `general` clause type, `none`/`low` risk. If it's a pure pointer with no substance, **flag to exclude from the gold set** (a fragment, not a real clause). |
| **Project13 bilingual (13 clauses)** | 13 clauses, each EN+AR of the same article in one `content` | Handled by design (§4) — one label per bilingual clause. **No cleanup needed** — they extracted cleanly (verified earlier: 13 coherent bilingual clauses, no duplication). |
| **Project14 annexes (19 clauses across 6 docs)** | 19 real clauses (price formula, PM requirements, site offices, environmental, schedule ×9, scope, etc.), all unique, all risk-labeled | Annotate normally — these are genuine annex obligations, not junk (verified earlier). Their `clause_type` is mostly `general`/`scope_of_work`/`compliance`; annotator confirms/corrects. |

**The general rule for gold quality:** the export/annotation pass is where
extraction artifacts (heading-only fragments, truncated clauses, pure-pointer
fragments) get **flagged out** so they never enter training. A `was_excluded`/
`is_fragment` flag on the task (or a reject in Label Studio) is the mechanism — do
NOT silently train on a 41-char heading clause.

---

## 7. Scope + effort estimate

**Volume:** 508 clauses × 2 projects (clause-type + risk); risk also has 1,061
findings to eyeball.

**Single-annotator, full review (with AI pre-labels):**
- **Clause type:** pre-filled single-select, mostly *accept*. ~**15–25 s/clause**
  (faster on obvious ones, slower on the `general`-over-absorption calls). →
  **~3–4 hours** for all 508.
- **Risk:** confirm the clause-level level + scan the findings + prune boilerplate
  noise. ~**1.5 min/clause** avg (some clauses 0–1 findings are quick; dense ones
  with 5–8 findings take longer). → **~12–15 hours** for 507 clauses / 1,061 findings.
- **Total: ~15–20 hours** single annotator for a complete, verified pass.

**Does the AI pre-label meaningfully speed it up? — YES, ~3–5×.** Accept-or-correct
on a pre-filled label is far faster than reading a clause and choosing from 17
categories / assessing risk cold. The whole premise of 8.3 (and why the pre-labeling
pass was worth running) is that annotators *verify* rather than *author*.

**Confidence-routing to go faster (Ayman's D8):** sort clause-type tasks ascending
by `confidence_score` — review the low-confidence ones fully, **spot-check ~10–20%**
of the high-confidence ones (avg confidence is 0.96, so most are likely right). That
can cut clause-type time toward ~2 hours. Risk has no confidence field → review the
whole (smaller-impact) set, or route by `likelihood_source = FALLBACK`.

**Single vs multi annotator:**
- **v1 recommendation: one qualified annotator** (needs construction-contract +
  Arabic legal literacy) for the full pass — simplest, and 508 is small enough.
- **Add a second annotator on a ~10–20% overlap sample** to measure
  inter-annotator agreement (a quality signal for the gold set and for 8.4/8.5
  confidence). Not required for v1 but cheap insurance on label quality.
- The corpus is **~84% Arabic** — the annotator(s) must be Arabic-legal literate;
  the 13 bilingual + English contracts are readable by the same person.

**Gate:** 8.4/8.5 want ≥500 verified examples per project — the corpus (508/507)
**clears the gate exactly** once reviewed, with no need to ingest more contracts.

---

## 8. Options + recommendation

### Setup approach

**Option 1 — Offline export + local Label Studio (v1) ✅ RECOMMENDED**
Standalone `docker run` Label Studio; read-only Python export (DB → anonymized JSON
with predictions); import via UI; annotate; JSON-MIN out → JSONL gold. No SIGN code
change, no AWS, no live coupling.
- **Pros:** simplest, safest, fully local, read-only, matches Ayman's D9/D5; the
  corpus is already 100% pre-labeled so it's a straight export.
- **Cons:** manual import/export step (fine for a one-time build); no live sync back
  to the app (not needed).

**Option 2 — Live ML-backend integration**
Wire Label Studio's ML backend to the SIGN AI so it fetches predictions live.
- **Pros:** predictions stay fresh if the model changes.
- **Cons:** new runtime surface, more setup, unnecessary for a one-time dataset over
  an already-pre-labeled corpus. **Defer** (Ayman's D9).

**Option 3 — Skip Label Studio, annotate in-app**
Use the existing in-app clause-review flow (`review_status` + `clause_type`
correction) as the annotation surface.
- **Pros:** zero new tooling; corrections land directly in the DB.
- **Cons:** no risk-annotation UI, no bulk/confidence routing, no gold-JSONL export,
  no inter-annotator support, and it mutates production data. **Not suitable** for a
  training-dataset build — but the in-app flow remains a *supplementary* gold source
  if any clauses get reviewed there.

### Recommendation
**Option 1**, two projects (clause-type + risk), pre-filled from the DB, anonymized
on export, local-only. It's the cheapest path to a verified gold set and requires no
production change. Concretely:
1. Stand up Label Studio (standalone container, port 8080, gitignored volume).
2. Write the read-only export script (reuse the 8.1 anonymizer) → 2 import JSONs.
3. Configure the 2 projects with the XML in §4 (RTL-aware).
4. Annotate confidence-routed (full low-confidence + risk; spot-check high-confidence).
5. **Flag the cleanup fragments** (§6) out of the gold set.
6. Export JSON-MIN → JSONL gold for 8.4/8.5; keep `was_corrected`.

### Open decisions for you
- **A.** Two separate projects (clause-type + risk) vs one combined task? *(Rec: two
  — cleaner configs, independent export; Ayman's D2/D3.)*
- **B.** Risk clause-level label = worst-finding severity? *(Rec: yes — Ayman's D4.)*
- **C.** Single annotator vs single + overlap sample? *(Rec: single for v1, add a
  10–20% second-annotator overlap for agreement.)*
- **D.** Write corrections back to the SIGN DB, or gold-JSONL only? *(Rec: JSONL only
  for v1 — keep 8.3 read-only; the app doesn't need the verified labels for
  training.)*
- **E.** Handle the cleanup fragments now (flag-to-exclude) or re-extract Project12
  clause 4 first (ship the Option A/D fix)? *(Rec: flag-to-exclude for v1; the
  re-extract fix is a separate, model-dependent piece of work.)*

**Scope note:** planning only — no install, no export, no annotation performed. The
export script, labeling-config XML, and JSONL transform are all greenfield and
gitignored; **no production code is touched**. Cross-references
`docs/phase-8.3-investigation.md` (the field map + confidentiality + the 11
decisions still stand).
