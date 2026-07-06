# Split-Clause Stitch Misses LARGE Clauses — Investigation (findings only)

**Date:** 2026-07-03
**Scope:** ONE issue — the split-clause stitch left `البند 8` (سعر العقد من الباطن, ~2000 chars) as
two partials on Project12 because its size threshold scales with clause size while the chunk overlap
is a fixed ~200 chars. **No code, no branch** — options + a recommendation for decision.

---

## TL;DR

- The stitch requires the junction overlap to clear **`min_size = max(60, 0.2 × shorter_partial)`**.
- The chunk-boundary overlap is a **fixed 200 chars** (`_break_oversized_chunk`, `overlap = 200`).
- So the stitch works **iff `0.2 × shorter_partial ≤ 200`**, i.e. **shorter partial ≤ 1000 chars**.
  Any clause whose partials exceed ~1000 chars can't be stitched — the 200-char overlap can't clear
  the scaled bar. **On Project12, `البند 8`: `0.2 × 1927 = 385 > 200` → not stitched.**
- The **fraction requirement fights the fixed overlap** — it's the wrong shape (scaling vs constant).
- **Recommended:** **cap the fraction below the fixed overlap** (`min_size = max(60, min(0.2×shorter, 150))`).
  This preserves every clause that currently stitches (small ones keep the 0.2× floor) and *only*
  newly enables large clauses. The **junction position check is untouched** — it remains the real
  guard against merging two genuinely-different clauses.

---

## 1. The exact stitch guard logic (real code, `clause_extractor.py`)

**Where the overlap comes from — `_break_oversized_chunk` (lines 530-573):**
```python
overlap = 200
# 1. sub-article boundaries:  _group_by_boundaries(chunk, sub_bounds, _CHUNK_SIZE, overlap)
# 2. paragraph boundaries:    _group_by_boundaries(chunk, para_bounds, _CHUNK_SIZE, overlap)
# 3. hard cut:                pos = end - overlap …
```
All three split strategies add a **fixed 200-char overlap** between pieces so the AI never loses
context at the edge. So when one clause is cut across a chunk boundary, the two emitted partials
share **~200 chars** (the overlap region) — regardless of how big the clause is.

**The stitch's overlap requirement — `_content_overlap_merge` (lines 811-847):**
```python
_STITCH_MIN_OVERLAP = 60            # …at least this many chars, AND
_STITCH_MIN_OVERLAP_FRACTION = 0.2  # …at least this fraction of the shorter partial.
_STITCH_P1_END_TOLERANCE = 60
_STITCH_P2_START_TOLERANCE = 300

min_size = max(_STITCH_MIN_OVERLAP,                       # 60
               _STITCH_MIN_OVERLAP_FRACTION * min(len(p1), len(p2)))   # 0.2 × shorter
for b in SequenceMatcher(None, p1, p2).get_matching_blocks():
    if b.size < min_size:                                 # ← SIZE gate
        continue
    ends_p1 = (b.a + b.size) >= (len(p1) - 60)            # ← block ends near p1's END
    starts_p2 = b.b <= 300                                # ← block starts near p2's START
    if ends_p1 and starts_p2 and (best is None or b.size > best.size):
        best = b
if best is None: return None                              # not a split → keep both
return p1 + p2[best.b + best.size :]                      # merge, overlap deduped once
```

There are **TWO independent gates**:
- **(i) SIZE gate:** the shared block must be `≥ min_size = max(60, 0.2 × shorter)`.
- **(ii) JUNCTION gate:** the block must end within 60 chars of p1's END **and** start within 300
  chars of p2's START — i.e. it must be a genuine **suffix-of-p1 = prefix-of-p2** overlap (a real
  continuation), not a coincidental block somewhere in the middle.

The **stitch caller** (`_stitch_split_clauses`, lines 849-893) adds two more: **adjacent** in output
order **and** **same leading section number**. Only when ALL of {adjacent, same-number, junction-
overlap-≥-min_size} hold are the two folded into one.

**Confirmed numbers on Project12 `البند 8`** (live): `len(p1)=2308`, `len(p2)=1927`, longest common
block **`size=200`** at `p1[2108]` (`2108+200 = 2308 = len(p1)` → **exactly p1's end**) and `p2[29]`
(right after the heading). So the **JUNCTION gate PASSES** (perfect suffix/prefix overlap). But
`min_size = max(60, 0.2×1927) = 385`, and `200 < 385` → the **SIZE gate REJECTS** → `None` → not
stitched. The overlap is a *textbook* split junction; only the scaled size bar blocked it.

---

## 2. Why 20%-of-shorter fails for large clauses but worked for Project5/Project6

The SIZE gate `0.2 × shorter` **scales with clause size**, but the overlap it's measuring is a
**constant 200 chars**. So:

> **Stitch succeeds ⟺ `200 ≥ 0.2 × shorter` ⟺ `shorter ≤ 1000 chars`.**

| Case | shorter partial | `0.2 × shorter` (= min_size) | 200-char overlap clears it? |
|---|--:|--:|:--:|
| **Project5 `البند 7`** (الملكية الفكرية) | ~351 ch | **70** | ✅ 200 ≥ 70 → stitched |
| **Project6 `البند 19`** (stitched, `split_clause:1`) | ≤ ~1000 ch | ≤ 200 | ✅ → stitched |
| **Project12 `البند 8`** (سعر العقد) | **1927 ch** | **385** | ❌ 200 < 385 → **NOT stitched** |

So yes — the earlier cases were **small** clauses (each partial well under 1000 chars), where
`0.2 × shorter` stayed at/below the 200-char overlap, so the overlap cleared the bar. `البند 8` is a
**large** clause (~2000 ch/partial), so the scaled bar (385) exceeded the fixed overlap (200). It's
not that البند 8's split was different in kind — it's the same clean 200-char junction; the bar just
moved out of reach. This is the split-clause-artifact family (Project5 `البند 7`) with a **new
trigger: clause size, not overlap quality.**

---

## 3. Options to fix (each: pros / cons / recommendation)

### Option A — Drop the fraction; rely on an absolute floor + the junction gate
`min_size = _STITCH_MIN_OVERLAP` only (drop `0.2 × shorter`), keeping/raising the flat floor
(e.g. 60 → ~100–150).
- **Pros:** Simplest — one line. Aligns the requirement with the **constant** overlap (a fixed
  overlap deserves a fixed floor, not a scaling one). Fixes `البند 8` (200 ≥ 150).
- **Cons:** **Changes the bar for SMALL clauses too.** With a flat floor of 60, a 500-char clause's
  bar drops from 100 (0.2×500) to 60; with a flat floor of 150, Project5 `البند 7` (whose overlap
  block was ~70–150) could **stop** stitching. So a *high* flat floor risks the small cases; a *low*
  flat floor (60) lowers the small-clause bar.
- **Correctness:** the junction gate still guards (see §4). Safe, but it perturbs small-clause
  behavior either up or down depending on the floor chosen.
- **Recommendation:** Viable and simplest, **but pick the floor carefully** — a flat 60 is safe for
  Project5 but lowers the small-clause bar; a flat 150 risks Project5. Less surgical than B.

### Option B — CAP the fraction below the fixed overlap  ★ PRIMARY
`min_size = max(_STITCH_MIN_OVERLAP, min(0.2 × shorter, CAP))` with **`CAP ≈ 150`** (below the
200-char chunk overlap, leaving a ~50-char margin).
- **Pros:** **Surgical.** For **small** clauses (`shorter ≤ 750`), `0.2 × shorter ≤ 150` so the cap
  is inert → **behavior is IDENTICAL to today** (Project5 keeps its 70 floor, Project6 unchanged).
  For **large** clauses (`shorter > 750`), the bar is capped at 150 < 200 → the fixed overlap always
  clears it → `البند 8` stitches. Changes **nothing** for the clauses that currently stitch; **only**
  newly enables large ones. The CAP is principled: "the required overlap can never exceed what the
  chunk-splitter actually produces (200)."
- **Cons:** One extra `min(...)` + a `CAP` constant (a second magic number, but a *justified* one —
  tied to the 200-char overlap).
- **Correctness:** the junction gate is untouched — still the real guard (see §4). The only change is
  the SIZE bar is capped so a genuine 200-char junction is never rejected purely for being small
  *relative to a big clause*.
- **Recommendation:** **Implement.** Most targeted fix; zero regression risk to existing stitches;
  the cap value is derivable from `_break_oversized_chunk`'s overlap constant.

### Option C — Make the required overlap relative to the CHUNK overlap (~200), not clause size
`min_size = round(0.5–0.75 × CHUNK_OVERLAP)` (e.g. `≈ 100–150`, where `CHUNK_OVERLAP = 200`).
- **Pros:** Conceptually the *most correct* — the threshold is derived from the mechanism that
  produces the overlap, not from clause size. If `_break_oversized_chunk`'s overlap ever changes, the
  stitch floor tracks it.
- **Cons:** Introduces a coupling between two modules (the stitch must reference/know the chunk
  overlap constant). In practice this collapses to **a flat floor of ~100–150** — i.e. it is
  effectively **Option A with a principled floor**, or the **CAP value in Option B**.
- **Recommendation:** Fold into B — use `CAP` (and, if desired, `_STITCH_MIN_OVERLAP`) **documented as
  "a fraction of the 200-char chunk overlap."** Don't ship as a separate mechanism.

### Option D — Tighten the junction gate to compensate for a looser size bar
Shrink `_STITCH_P1_END_TOLERANCE` (60 → e.g. 20) / `_STITCH_P2_START_TOLERANCE` (300 → smaller), or
require an EXACT suffix/prefix (`b.a + b.size == len(p1)`, `b.b == 0` after heading).
- **Pros:** Extra safety margin if the size bar is lowered.
- **Cons:** **Risks REJECTING real splits.** Those tolerances exist because the AI's re-emission of a
  boundary isn't byte-exact (it prepends the `بند` heading, may reflow whitespace, may include a few
  extra chars). Project12 `البند 8` already needed `p2[29]` (heading, within the 300 tolerance) and an
  end-exact block; tighten too far and real splits start failing. **Not needed** — the junction gate
  is already strong at current tolerances (see §4).
- **Recommendation:** **Do NOT tighten.** Keep the current junction tolerances; they are what make the
  size-bar change safe. (Optionally, if extra caution is wanted, keep the absolute `_STITCH_MIN_OVERLAP`
  at a healthy ~100 alongside B.)

---

## 4. Correctness risk — loosening SIZE must NOT start merging DISTINCT clauses

The guard the fix must preserve is: **never merge two genuinely-different clauses that happen to be
adjacent + same-number** (the GC/PC-collision the content-dedup fix protects). The critical insight:

> **The JUNCTION gate — not the size fraction — is what rejects false merges.** The shared block must
> be simultaneously the **suffix of p1** (`ends_p1`) *and* the **prefix of p2** (`starts_p2`) — i.e.
> the *same running text* continuing across the boundary. Two DISTINCT clauses do not have a long run
> of identical text positioned exactly at one's end and the other's start; at most they share short
> boilerplate phrases scattered *mid-body*, which fail `ends_p1`/`starts_p2`.

None of the options A/B/C touch the junction gate — they only change the SIZE floor. So a false
junction is rejected identically before and after:

| Scenario | Blocked by | Still blocked after the fix? |
|---|---|---|
| **GC `بند 8` vs PC `بند 8`** (different content) | No block that is p1-suffix **and** p2-prefix (their only shared text is scattered boilerplate mid-body) → **JUNCTION gate fails** | **Yes** — junction gate untouched |
| Two different same-number clauses sharing a mid-body phrase | Shared block not at the junction → `ends_p1`/`starts_p2` fail | **Yes** |
| Adjacent same-number, genuinely different, no shared run | No matching block ≥ floor at the junction | **Yes** |
| Non-adjacent GC/PC same-number | `_stitch_split_clauses` adjacency guard | **Yes** — caller guard untouched |

What the fix DOES change: a genuine 200-char continuation overlap on a **large** clause now clears the
SIZE bar (instead of being rejected for being <20% of a big clause). That is exactly the intended
behavior. The floor stays high enough (60, and CAP 150) that a **trivial** coincidental junction
(a stray 30–50-char boilerplate phrase that happens to sit at the boundary) is still rejected.

**Residual note:** to keep even more margin, the absolute `_STITCH_MIN_OVERLAP` could be raised from
60 → ~100 alongside B — a 100-char exact suffix/prefix run between two *different* clauses is
vanishingly unlikely, while the real 200-char overlap still clears it comfortably.

---

## 5. Blast radius + how to test

**Blast radius:** confined to the `_content_overlap_merge` constants / `min_size` expression in
`clause_extractor.py` (one or two lines). No change to chunking, prompts, the junction gate, the
caller guards, the content-dedup, or the parallel path. Small clauses' stitch behavior is unchanged
(Option B) or minimally shifted (Option A).

**Deterministic unit tests (extend `test_clause_stitch.py`):**
1. **Large-clause split (the البند 8 shape):** two ~2000-char partials, same section number, sharing
   an exact ~200-char suffix/prefix overlap → **stitched into one** (all content preserved, overlap
   deduped once). *This test FAILS on today's code and PASSES after the fix.*
2. **False junction — large, same number, NO real continuation:** a GC `بند 8` (~2000 ch) and a PC
   `بند 8` (~2000 ch) with **different** content that share only a mid-body boilerplate phrase → the
   shared block is not at p1-end/p2-start → **NOT merged** (junction gate). *Must still reject.*
3. **Small-clause split unchanged (Project5 `البند 7` shape):** ~350-char partials with a shared
   sub-article overlap → still **stitched** (regression guard — Option B leaves this identical).
4. **Coincidental short junction:** a ~40–60-char boilerplate run sitting at the boundary of two
   different clauses → **NOT merged** (below the absolute floor). *Guards the floor value chosen.*
5. **Normal single-section doc** (no same-number adjacency) → unchanged.

**Live (gated — Anthropic + token):**
- Re-extract **Project12** → `البند 8 (سعر العقد من الباطن)` becomes **ONE** clause → **35 clauses,
  not 36**; every other GC clause unchanged; the 10-clause PC section (`الشروط الخاصة`) intact;
  `combined_conditions_file` still set; **no** new duplicate/near-dup.
- Spot-confirm **Project5 (35) and Project6 (35)** re-extract with their split clauses still correctly
  stitched (no regression) and no new merges.
- Confirm a GC/PC same-number pair still does **not** merge (no false stitch introduced).

(Per the established pattern, any live re-extraction stops to request a fresh token + stable-WiFi
confirmation before running.)

---

## Recommendation (summary)

| Option | Verdict | Why |
|---|---|---|
| **B — cap the fraction below the fixed overlap** (`max(60, min(0.2×shorter, 150))`) | **Do (primary)** | Surgical: identical for clauses that currently stitch, only newly enables large ones; cap is principled (< the 200-char chunk overlap) |
| A — drop the fraction, flat floor | Alternative | Simplest, but shifts the small-clause bar; floor must be chosen carefully (60 safe, 150 risks Project5) |
| C — floor relative to chunk overlap | Fold into B | Conceptually cleanest; collapses to B's CAP; document the constant as "a fraction of the 200-char overlap" |
| D — tighten the junction | **Do NOT** | The junction gate is already the guard; tightening risks rejecting real (heading-prepended, whitespace-reflowed) splits |

**Proposed package for implementation:** **Option B** — `min_size = max(_STITCH_MIN_OVERLAP,
min(_STITCH_MIN_OVERLAP_FRACTION × min(len(p1), len(p2)), _STITCH_MAX_MIN_OVERLAP))` with
`_STITCH_MAX_MIN_OVERLAP ≈ 150` (documented as "below the 200-char `_break_oversized_chunk` overlap");
optionally raise `_STITCH_MIN_OVERLAP` 60 → ~100 for extra false-junction margin. The **junction gate
stays exactly as-is**. Proven by the deterministic large-clause + false-junction unit tests above and
a gated Project12 (→ 35) + Project5/Project6 (no-regression) live re-extraction.

**Open question for you:** set the cap at **150** (50-char margin under the 200 overlap) or a touch
lower/higher? And do you want `_STITCH_MIN_OVERLAP` bumped 60 → ~100 for extra margin, or left at 60?
Those two numbers are the only tuning knobs.
