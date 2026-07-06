# No-Overlap Split Investigation — البند 8 mid-word chunk cut

**Status:** Investigation only. No code changed. Read-only analysis on the live
Project12 extraction (doc `d5e27857`, contract `c2ad4446`) that produced the
no-overlap split during the stitch-threshold live check.

**Scope:** the *no-overlap split* mechanism only — the phenomenon where a single
بند comes back as two clause objects that share **no** overlapping text, with the
first partial ending **mid-word** (`…وتعويضه ع`). This is a **different** cause
than the overlap-split the branch's threshold fix handles.

**Companion:** `docs/stitch-threshold-large-clause-investigation.md` (the
overlap-split threshold fix, unit-proven, on branch `fix/stitch-large-clause-threshold`).

---

## TL;DR

- **Root cause:** the sub-article boundary regex `_SUB_ARTICLE_RE` matches only
  ASCII hyphen `-` / slash `/`. This document's sub-articles use an **en-dash**
  `–` (U+2013): `8 – 7`. So in a >15,000-char article block, `_SUB_ARTICLE_RE`
  finds **1 match in 17,603 chars** instead of 56 → the sub-article split
  degenerates and `_group_by_boundaries` falls back to a **raw offset hard cut**
  at `pos + 15000`, landing **mid-word**.
- **Text IS lost — small here, unbounded in general.** The two Project12 بند 8
  partials leave a **4-char gap** (`نه. ` — the completion of `عنه.`) that appears
  in neither partial. The gap size = distance from the arbitrary 15,000-char cut
  to the next sub-article the model resumes at; here it was coincidentally 4
  chars, but it can be an entire sub-article's worth.
- **Non-determinism is the MODEL, not the chunker.** Chunking is deterministic
  given the text (the mid-word cut is stable — `p1` is byte-identical across both
  live runs, 2308 chars). What varies run-to-run is whether the model **reproduces
  the 200-char overlap** in the continuation clause (→ overlap-split, stitchable,
  no loss) or **skips to the next sub-article** (→ no-overlap split, tiny loss).
- **Recommended fix:** teach `_SUB_ARTICLE_RE` to recognize Unicode dashes
  (en-dash/em-dash). Verified on the real block: 1 → **56** matches, the hard cut
  disappears, both pieces end **cleanly** at sub-article boundaries (`…من الباطن. \n\n`),
  and the 200-char overlap is preserved. **Narrow blast radius** (the regex is used
  in exactly one place, only for >15k article blocks).
- **Interaction:** the en-dash fix and the threshold fix are **complementary, not
  redundant** — the en-dash fix removes the mid-word cut + text loss; the threshold
  fix collapses the (now clean, overlap-bearing) split into one clause when the
  model reproduces the overlap. Recommend shipping **both**.

---

## Q1 — How `_break_oversized_chunk` splits, and where the mid-word cut comes from

### The pipeline (real code)

`extract()` (`clause_extractor.py:373`) routes >30,000-char docs to
`_extract_chunked` → `_split_on_article_boundaries` (`:430`) →
`_break_oversized_chunk` (`:530`) → parallel model calls → `_merge_in_order`
(`:718`) → `_stitch_split_clauses` (`:385`).

**`_split_on_article_boundaries` Phase 1 (`:447`)** cuts **only at article-heading
boundaries** (`_ARTICLE_BOUNDARY_RE`). Each raw chunk therefore contains **whole
articles** — it never cuts mid-article here. The greedy walk (`:454`) accumulates
articles while `boundaries[j] - start <= 15000`, then ends the chunk at the **next**
boundary. Because it checks the **start** of the next article (not its end), a large
trailing article makes the chunk **overshoot** 15,000.

**Project12 concrete trace** (measured on the live text, 64,802 chars):

| Article | Offset | Size |
|---|---|---|
| البند 5 | 15,552 | (start of oversized block) |
| البند 7 (الالتزامات العامة) | 17,271 | **11,875 chars — huge** |
| البند 8 (سعر العقد من الباطن) | 29,146 | ~4,009 |
| البند 9 | 33,155 | (next boundary) |

The greedy walk from البند 5 includes 5+6+7+8 (البند 8's *start* 29,146 ≤ 15,552+15,000)
then stops at البند 9. Raw chunk = `text[15552:33155]` = **17,603 chars > 15,000** →
oversized → `_break_oversized_chunk`.

### `_break_oversized_chunk` (`:530`) — 3 strategies, all via `_group_by_boundaries`

```
overlap = 200
1. sub-article boundaries  (_SUB_ARTICLE_RE)   -> _group_by_boundaries(..., 200)
2. paragraph boundaries    (\n\n)              -> _group_by_boundaries(..., 200)
3. LAST RESORT: hard split every 15000 with 200 overlap   (chunk[pos:pos+15000])
```

`_group_by_boundaries` (`:192`) is the shared splitter. **It always applies the
200-char overlap** — in *both* its boundary-cut path (`:222` `start = max(best_cut - overlap, …)`)
and its own internal hard-cut path (`:216` `best_cut is None` → `text[start:start+max_size]`,
`start = end - overlap`). **Overlap is never skipped mechanically.**

### The mid-word cut — measured

On the real 17,603-char block:

```
_SUB_ARTICLE_RE matches in block: 1          <-- should be ~56
strategy sub-article -> 3 piece(s)           <-- "taken", but degenerate
  piece 0: len=  1102  tail='…هذا العقد من الباطن.\n\n'   (clean)
  piece 1: len= 15000  tail='…في ذلك وتعويضه ع'          (MID-WORD)
  piece 2: len=  1901  head='ل على جميع التصاريح…'
  overlap piece0->1: 200 chars
  overlap piece1->2: 200 chars               <-- overlap IS present
```

With only **1** sub-boundary in 17,603 chars, `_group_by_boundaries` cannot cut at
a sub-article near the 15,000 mark, so it hits its **internal `best_cut is None`
hard cut** (`:216-220`) → `block[902:15902]`, slicing at raw offset **15,902**,
mid-word: `…وتعويضه ع`. The 200-char overlap is still applied (piece 2 starts at
15,702 = 200 before piece 1's end), so **the chunks themselves lose nothing**.

### Why only 1 sub-boundary? The en-dash

The sub-articles are written `8 – 7` — the separator is **`–` U+2013 (en-dash)**,
verified byte-for-byte:

```
'8 ? 7' chars: [('8',0x38), (' ',0x20), ('–',0x2013), (' ',0x20), ('7',0x37)]
```

`_SUB_ARTICLE_RE` (`:187`) = `(?m)^[١-٩\d]{1,3}\s*[-/]\s*[١-٩\d]{1,3}` — its
character class `[-/]` matches only ASCII hyphen (U+002D) and slash. It does **not**
match the en-dash, so every `N – M` sub-article heading is invisible to it. The lone
match is a coincidental ASCII `-` elsewhere in the block.

**Root cause = a dash-character mismatch in `_SUB_ARTICLE_RE`.**

---

## Q2 — Is text LOST, or just split? → LOST (small here, unbounded in general)

Definitive text-conservation check: reconstruct البند 8 from the raw extracted text
(`text[29146:33155]`, normalized len **3983**) and locate the two DB partials inside
it.

```
P1 (2308 raw) covers raw[0   : 2296]   ends  …وتعويضه ع
P2 (1691 raw) covers raw[2300: 3983]   starts 8 – 7 على المقاول…
=> GAP of 4 chars between P1 end and P2 start — TEXT LOST:  'نه. '
   (raw8 normalized 3983 == P1 2296 + gap 4 + P2 1683)
```

- `p1` ends at the mechanical cut `…وتعويضه ع`; the model faithfully reproduced its
  chunk up to the truncation.
- `p2` starts clean at `8 – 7`; the model **skipped** the prepended-heading + overlap
  continuation (per the chunk instruction — see Q3).
- The sliver **between** the cut and the next sub-article — here `نه.` completing
  `عنه.` ("…and compensating him **for it.**") — is in **neither** partial. **Lost.**

**Severity — the 4 chars were coincidental.** The lost region is
`[hard-cut offset → next sub-article the model resumes at]`. The hard cut lands at an
**arbitrary** `pos + 15000` offset; here it happened to fall 4 chars before `8 – 7`.
Had البند 7 been slightly shorter/longer, the cut would land mid-sub-article and the
loss could be **hundreds of chars** (a whole clause of a sub-article). This is
**unbounded silent text loss** — for a legal contract, a correctness bug, not cosmetic.

> Note: the chunks lose nothing (overlap present). The loss happens at the **model
> output** stage, because the model drops the mid-word remainder as "continuation."

---

## Q3 — Why different splits on different runs? → the MODEL, not the chunker

**Chunking is deterministic** given the extracted text. Evidence: `p1` is
**byte-identical (2308 chars, `…وتعويضه ع`) across both live runs.** The docx→text
extraction is deterministic (python-docx), so the text, the boundaries, and the
mid-word hard cut are all stable.

**The variable is the model's handling of piece 2.** Piece 2 =
`_add_article_context` prepends the البند 8 heading (`:614`, `:492`), then the chunk
instruction (`:617`) says *"skip continuation text after a prepended heading; only
extract clauses that START in this chunk."* The model then chooses:

| Model choice | Result | Loss? | Stitchable? |
|---|---|---|---|
| **Reproduce** the 200-char overlap in the continuation clause | overlap-split (`p2`=1927 in run 1) | none | **yes** — threshold fix collapses it |
| **Skip** to the next sub-article `8 – 7` (obey the instruction) | no-overlap split (`p2`=1691 in run 2) | tiny gap (`نه.`) | no |

So the "overlap vs no-overlap" outcome is **model-output variance on the continuation
region**, riding on top of a deterministic mid-word chunk cut. Same document, same
chunks — different model segmentation.

---

## Q4 — Options to fix the no-overlap split

### Option A — teach `_SUB_ARTICLE_RE` to recognize Unicode dashes ✅ RECOMMENDED

Change the char class `[-/]` → include U+2010–U+2015 (hyphen … horizontal bar):

```python
# current
_SUB_ARTICLE_RE = re.compile(r"(?m)^[١-٩\d]{1,3}\s*[-/]\s*[١-٩\d]{1,3}")
# proposed
_SUB_ARTICLE_RE = re.compile(r"(?m)^[١-٩\d]{1,3}\s*[-/‐-―]\s*[١-٩\d]{1,3}")
```

**Verified on the real block:**
```
current  -> 1 sub-boundary  -> hard cut  -> piece1 tail '…وتعويضه ع'  MID-WORD
FIXED    -> 56 sub-boundaries -> clean cuts -> piece tails '…من الباطن. \n\n'  CLEAN, CLEAN
```

- **Pros:** eliminates the **mid-word cut and the text loss** (the only *serious*
  part) at the root; cuts land at clean sub-article boundaries; the 200-char overlap
  is preserved → the split becomes **stitchable** by the branch's threshold fix.
  Surgical, near-zero risk.
- **Cons:** does not *guarantee* بند 8 returns as one clause — if the model still
  skips the (now clean-boundary) overlap, بند 8 stays two clauses, but **with no
  loss** (each partial captures whole sub-articles). Doesn't help a doc using some
  other exotic separator (mitigated by covering the whole U+2010–2015 dash range).
- **Blast radius:** `_SUB_ARTICLE_RE` is referenced in **exactly one place**
  (`_break_oversized_chunk:543`), which only runs for **>15,000-char single-article
  blocks**. Documents with no huge article never reach it. Line-anchored (`(?m)^`) →
  a mid-sentence range like `5 – 10 days` cannot false-match (must be at line start).

### Option B — "always apply the overlap so there's always a junction to stitch"

Not actionable as stated: **the overlap is already always applied** by
`_group_by_boundaries` (Q1). The gap is the **model skipping** it, which chunking
can't force. The only lever is a **prompt change** (instruct the model to always
reproduce the leading continuation), which is itself non-deterministic and risks new
duplication/formatting regressions across all chunked docs. **Not recommended** as a
primary fix; a prompt tweak could be explored later as a reliability nudge, gated on
the accuracy suite.

### Option C — stitch adjacent same-section partials even WITHOUT overlap ⚠️ RISKY

This is the exact **GC/PC-collision danger** the content-dedup + junction guard were
built to prevent (`_merge_in_order` keys on content, not section number; a General
`بند 8` and a Particular `بند 8` must stay separate). Without an overlap signal, the
only distinguishing evidence would be heuristic:

- `p1` ends **mid-word / no terminal punctuation** (mechanical-cut signature), AND
- `p2` starts with a sub-article number **continuing** `p1`'s sequence (p1's last
  sub-article `8 – 6` → p2 first `8 – 7`).

**Problems:** (1) fragile — a genuine PC `بند 8` starts with its *heading*, not a
continuing sub-article, but edge cases (both start at `8 – 1`) can fool it; (2) the
mid-word signal **only exists because of the very bug Option A removes** — after
Option A, cuts are clean and this signal disappears, so C conflicts with A;
(3) reintroduces cross-clause merge risk the codebase deliberately closed.
**Not recommended.**

### Option D — don't hard-cut mid-word (back off to a word/paragraph boundary)

Make the last-resort hard split (`:567-572`, and the `best_cut is None` path in
`_group_by_boundaries:216-220`) retreat to the nearest whitespace before
`pos + 15000`.

- **Pros:** cheap defensive safety net for the *truly* boundary-less "wall of text"
  case (where even Option A finds nothing); avoids mid-word ugliness.
- **Cons:** **does not stop the loss** — the model can still skip the continuation
  region; D only makes the cut land on a space instead of mid-word. It's cosmetic
  for the cut, not a fix for the loss. Would not have fixed *this* case (Option A
  does, via sub-article boundaries).
- **Recommendation:** ship as a **complementary safety net** alongside A, not as the
  primary fix.

### Option E — prevent the oversized grouping (never overshoot 15k with a trailing article)

Change Phase 1 (`:454`) so a chunk never trails a large article past 15,000 — end at
البند 8's *start* (chunk = 5+6+7 = 13,594 ≤ 15,000) so البند 8 lands **wholly** in the
next chunk and is **never split**.

- **Pros:** most complete — بند 8 is never split, never lossy, always one clause.
- **Cons:** **WIDE blast radius** — changes chunk boundaries for **every** document,
  which shifts chunk counts, per-chunk clause emission, and dedup behavior platform-
  wide. High regression risk; the overshoot may be partly intentional (keep whole
  articles together). Needs full re-verification across all docs.
- **Recommendation:** **not now.** Defer as a larger, separately-verified chunking
  refactor if the clean-boundary + stitch combination proves insufficient.

### Recommendation

**Option A (primary) + Option D (safety net).** A fixes the actual bug (mid-word cut
→ text loss) at the root with a one-line, single-call-site regex change; D backstops
the pathological no-boundary case. Skip B, C, E for now (B ineffective, C risky and
conflicts with A, E too broad).

---

## Q5 — Interaction with the branch threshold fix (combine or ship separately?)

They address **different causes** and are **complementary, not redundant**:

| | Threshold fix (branch) | En-dash fix (Option A) |
|---|---|---|
| Targets | overlap-split of a **large** clause | mid-word hard cut of a huge-article block |
| Effect | collapses an overlapping split into ONE clause | removes the mid-word cut + **text loss**, keeps overlap |
| Failure it fixes | large بند not stitched (0.2×shorter > 200) | بند silently loses chars at a mechanical cut |

- The threshold fix does **not** fix the loss (a no-overlap split has nothing to
  stitch).
- The en-dash fix does **not** guarantee one clause (model may still skip the clean
  overlap) — but guarantees **no loss** and leaves a clean, overlap-bearing split
  that the threshold fix **then** collapses when the model reproduces the overlap.
- Together: بند 8 (a) **never loses text** (A) and (b) **collapses to one clause**
  whenever the overlap is reproduced (threshold fix). When the model skips the
  overlap, بند 8 remains two clauses **with no loss** — an acceptable cosmetic
  outcome, not a correctness bug.

**Recommendation: combine — ship Option A on the same branch/PR as the threshold
fix**, since the user's goal is to address *both* causes of بند 8 splitting together.
Each keeps its own tests. They are compatible (the threshold fix keys on overlap, not
on the mid-word signal, so removing the mid-word cut does not weaken it).

---

## Q6 — Blast radius + test plan

### Blast radius (Option A)

- **Code touched:** one regex literal (`_SUB_ARTICLE_RE`, `:187`), one call site
  (`_break_oversized_chunk:543`).
- **Runtime reach:** only documents with a **single article > 15,000 chars** (e.g.
  a huge Definitions or Obligations بند) reach `_break_oversized_chunk` at all.
  Everything else is untouched.
- **Behavior change for affected docs:** en-dash `N – M` sub-articles that were
  previously invisible now split the oversized block **cleanly** instead of at a raw
  offset. Strictly better (no mid-word, no loss). Line-anchored `(?m)^` prevents
  mid-sentence dash ranges (`5 – 10 days`) from false-matching.
- **Docs already using ASCII `-`/`/`:** unchanged (those matches still fire).

### Test plan

**Deterministic unit tests (ai-backend, mocked Anthropic):**
1. **En-dash sub-article split** — synthesize a >15,000-char single-article block
   whose sub-articles use `N – M` (en-dash). Assert `_break_oversized_chunk` returns
   >1 piece split **at sub-article boundaries**, and **no piece ends mid-word**
   (each piece ends at whitespace/terminal punctuation). Contrast: the same block
   with ASCII `-` already behaves (control).
2. **Text conservation** — assert the union of the returned pieces covers the whole
   block (consecutive pieces overlap by 200; no interior gap).
3. **Em-dash / horizontal-bar variants** — parametrize the separator across
   U+2010–U+2015; all should split cleanly.
4. **Regression** — existing `_break_oversized_chunk` behavior (ASCII hyphen,
   paragraph fallback, true no-boundary hard split) unchanged.
5. **Line-anchor guard** — a body line containing `… 5 – 10 days …` (dash NOT at line
   start) must **not** create a sub-boundary.

**Gated live re-extract (needs fresh token + WiFi):**
- **Project12** — the deterministic win: assert the two بند 8 partials **no longer
  have a gap** (text-conservation: `p1 ∪ p2` == raw بند 8, i.e. `نه.` is preserved).
  This is deterministic (chunking is deterministic) and reliably assertable, unlike
  the "one clause" outcome which still depends on model overlap-reproduction.
- **Project6** (بند 7 also huge, 11,352) and **Project5** — confirm no new mid-word
  cuts / no loss, existing clauses unchanged.

> Honest caveat (carried from the threshold-fix live check): because the
> overlap-vs-skip choice is **model-driven**, the "بند 8 becomes ONE clause" outcome
> is **not** guaranteed per run even after both fixes. What *is* deterministic and
> must be asserted is **zero text loss** (Option A) and **stitch-when-overlap-present**
> (threshold fix, unit-proven).

---

## Evidence appendix (commands were read-only)

- Live text: `document_uploads.extracted_text` for doc `d5e27857` — 64,802 chars,
  chunked path.
- Real chunker (`_split_on_article_boundaries` + `_merge_small_chunks`) → 8 chunks;
  **chunk 4 = 15,000 chars, tail `…وتعويضه ع` (mid-word)**.
- Oversized raw block `[15552:33155]` (17,603 chars, البند 5+6+7+8).
- `_SUB_ARTICLE_RE`: **1** match (current) vs **56** (en-dash-aware) on that block.
- Separator byte: `–` = **U+2013**.
- Text-conservation: raw بند 8 (3983 norm) = `p1` (2296) + gap **4** (`نه. `) + `p2`
  (1683) → **4 chars lost**.
- `_break_oversized_chunk` with the fixed regex → 3 clean pieces (`…من الباطن. \n\n`),
  no mid-word cut, 200-char overlap preserved.
