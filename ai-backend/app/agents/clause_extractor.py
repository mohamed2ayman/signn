"""Clause Extractor Agent -- identifies and structures clauses from contract text."""

from __future__ import annotations

import json
import logging
import re
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any

from anthropic import APIConnectionError, APIStatusError

from app.agents.base_agent import BaseAgent
from app.config.settings import get_settings
from app.utils.json_salvage import salvage_json_array

logger = logging.getLogger(__name__)

# --- Rate-limit pacing (parallel chunk extraction) -------------------------
# When the live anthropic-ratelimit-*-remaining headers fall to/below these
# floors, the gate makes ALL worker threads pause briefly so the next wave of
# parallel calls doesn't run the account into a wall of 429s. The concurrency
# cap is the primary control; this gate is the safety net.
_RL_REQUESTS_FLOOR = 1          # pause when ≤ this many requests remain in window
_RL_TOKENS_FLOOR = 32_000       # pause when ≤ this many tokens remain (≈ one big call)
_RL_LOW_REMAINING_PAUSE = 3.0   # seconds to hold off when a floor is hit
_RL_MAX_PAUSE = 30.0            # hard cap on any single pause (incl. Retry-After)

# --- Extraction quality flags (surfaced in the clause-extraction result) ----
# Set when the content-aware merge drops ≥1 clause as a true duplicate — makes
# clause loss VISIBLE (was a silent logger.debug). Value carries the count.
_DEDUP_DROPPED_FLAG_PREFIX = "clause_dedup_dropped:"
# Set when a document appears to contain BOTH General AND Particular Conditions
# (a بند numbering RESTART: a low number reappears after a higher one). Per
# policy these should be uploaded as SEPARATE files — flagged, not rerouted.
_COMBINED_CONDITIONS_FLAG = "combined_conditions_file"
# Set when adjacent partials of the SAME clause (split across a chunk boundary)
# were stitched back into one. Value carries the count of stitches performed.
_SPLIT_CLAUSE_FLAG_PREFIX = "split_clause:"
# (FIX C) Set when ≥1 chunk's response could NOT be fully parsed as a complete
# JSON array — a max_tokens truncation (even after retrying with more headroom) OR
# any other cut-off/malformed array — so the salvage parser recovered only the
# clauses that DID parse and some may be missing. Value carries the count of such
# chunks. NestJS persists this flag to document.quality_flags (it does NOT change
# the terminal status); the frontend surfaces it as an amber "extraction may be
# incomplete — please review" banner even on a completed (CLAUSES_EXTRACTED)
# document — so an incomplete extraction is flagged + reviewable, never silent.
_TRUNCATION_FLAG_PREFIX = "clause_extraction_incomplete:"

# (FIX B) max_tokens is a CEILING, billed per ACTUAL output token — a generous
# ceiling costs nothing extra, it only prevents dense-Arabic verbatim output from
# being cut off. This is the hard ceiling a truncation-retry may bump up to.
_MAX_TOKENS_CEILING = 64_000

SYSTEM_PROMPT = """\
You are an expert contract clause extraction agent for the SIGN construction \
contract management platform.

Your task is to analyse the full text of a contract document and identify every \
distinct clause and sub-clause.  For each clause you find, return a JSON object \
with the following fields:

- title          : a short descriptive title for the clause (e.g. "Definitions \
                   and Interpretation", "Payment Terms", "Force Majeure")
- content        : the EXACT original text of the clause — do NOT paraphrase, \
                   summarise, or modify the text in any way
- clause_type    : categorise the clause as one of: "general", "payment", \
                   "liability", "termination", "indemnification", \
                   "force_majeure", "dispute_resolution", "confidentiality", \
                   "compliance", "insurance", "warranty", "intellectual_property", \
                   "scope_of_work", "variations", "defects", "time", "other"
- section_number : the section/clause number as it appears in the document \
                   (e.g. "1.1", "14.3", "GC-7.2").  If the document is \
                   unstructured and has no numbering, set to null
- confidence     : your confidence that this is a correctly identified and \
                   complete clause, from 0.0 to 1.0

Important guidelines:
1. Preserve the EXACT original text — never paraphrase or rewrite.  "EXACT" \
   includes LAYOUT, not just the words: keep the original line breaks, bullet \
   markers (•, -), and numbered / lettered sub-clauses each on their own line, \
   exactly as they appear in the source.  Do NOT collapse a multi-line or \
   bulleted list into a single flat paragraph, and do NOT merge separate lines \
   into one.  This layout-preservation rule applies to EVERY clause you extract \
   (the definitions-clause formatting in guideline 12 is one specific case of \
   this general rule).
2. Handle both structured contracts (e.g. FIDIC with numbered clauses) and \
   unstructured contracts (narrative form without numbering)
3. Do not merge separate TOP-LEVEL clauses (مادة / بند) — each مادة is one \
   atomic clause.  However, sub-articles numbered N-M (e.g. "2-1", "9-3") or \
   N/M (e.g. "4/1", "4/2") are NOT separate clauses — they are sub-sections \
   that belong INSIDE their parent clause and must be kept there.
4. Do not split a single clause into multiple parts unless sub-clauses are \
   clearly distinct
5. Include ALL clauses — do not skip boilerplate, definitions, or schedules
6. For construction contracts, pay special attention to: scope of works, \
   variations, defects liability, time for completion, payment certificates, \
   retention, performance bonds, and dispute resolution
7. SKIP cover pages, logos, table of contents, headers, footers, and any \
   non-contractual preamble.  Only extract from the actual contract body. \
   For Arabic contracts the body typically starts with a phrase like \
   "إنه في يوم" or "تم الاتفاق بين كل من".  For conditions documents \
   the body starts at the first numbered article or clause (e.g. \
   "المادة 1", "البند 1", "Article 1", "Clause 1"). \
   TABLE OF CONTENTS IDENTIFICATION — A Table of Contents can appear at the \
   beginning OR appended at the end of the extracted text.  Recognise it by: \
   • مادة (N) entries followed by dotted lines and page numbers \
     (e.g. "تعريفات وتفسيرات ......... 4  4  8") \
   • Standalone page numbers (bare integers like "4", "8", "9") on their \
     own lines between article entries \
   • Multiple مادة (N) entries listed sequentially with NO body text between \
     them — just titles, dots, and numbers \
   ALL TOC entries must be completely skipped.  Do NOT extract them as \
   clauses even though they contain مادة (N) markers that look like headings.
8. Arabic clause boundary markers — recognise ALL of these as the start of \
   a new clause: \
   • "البند رقم (1):" or "البند رقم (١):" — Egyptian government / NTA format \
     where the number appears in parentheses followed by a colon. \
     This is the most common marker in Egyptian public-authority contracts \
     (National Authority for Tunnels, ministries, etc.). \
     ALWAYS treat "البند رقم" followed by any number in parentheses as a \
     clause boundary, regardless of whether Arabic or Western digits are used. \
   • "البند الأول" / "البند الثاني" / "البند الثالث" / "البند الرابع" … \
     (ordinal Arabic forms — first, second, third, fourth …) \
   • "البند رقم" followed by any numeral (general marker) \
   • "البند 1" / "البند ١" (numeral directly after البند) \
   • "مادة (1)" / "مادة (١)" — Western or Arabic-Indic digit in parentheses \
     (most common in Particular Conditions / technical specifications) \
   • "مادة رقم (1)" / "مادة رقم (١)" — with رقم before the bracketed digit \
   • "مادة 1" / "مادة ١" — numeral directly after مادة with no brackets \
   • "المادة 1" / "المادة (1)" / "المادة رقم" — same forms with definite article ال \
   • "Clause 1" / "Clause (1)" / "Article 1" / "Article (1)"
9. COMPLETENESS — you MUST include every single clause in the output JSON. \
   Do not stop early, do not summarise, do not omit any clause no matter how \
   many there are.  If the contract has 30 clauses, the JSON array must have \
   30 objects.  Partial output is not acceptable.
10. SUB-ARTICLE CONTAINMENT — ALL text from مادة (N) up to (but not including) \
   مادة (N+1) belongs to a SINGLE clause object.  Sub-articles such as \
   "9-1", "9-2", "9-3" or "9/1", "9/2", "9/3" are paragraphs INSIDE clause 9 \
   and must appear verbatim in that clause's ``content`` field. \
   The ``section_number`` for the parent clause is the top-level number only \
   (e.g. "9"), never a sub-article number.  Do NOT emit a separate clause \
   object for each sub-article.
11. REAL ARTICLE HEADINGS vs CROSS-REFERENCES — Not every مادة (N) in the \
   text is a clause boundary.  Distinguish them as follows: \
   A REAL article heading has ALL of: \
   • مادة (N) appears at the START of a line (not mid-sentence) \
   • Followed by a colon ":" and a descriptive title \
   • Followed by article body text in the next paragraph \
   • Example: "مادة (12) : الإلتزامات العامة للمقاول" \
   A CROSS-REFERENCE has these characteristics: \
   • مادة (N) appears MID-SENTENCE \
   • Preceded by words like: من / طبقا للمادة / بموجب مادة / \
     أحكام مادة / تطبيق مادة / وفقاً للمادة / تطبيق أحكام المادة \
   • Examples: "طبقا للمادة (22) من هذه الشروط العامة" \
               "يطبق أحكام المادة (23) من الشروط الحالية" \
               "مادة (48) من القانون الخاص بتنظيم التعاقدات" \
   Cross-references are NOT clause boundaries.  NEVER create a new clause \
   object from a cross-reference.  Only create clauses from real headings.
12. DEFINITIONS FORMATTING — When extracting a definitions clause \
   (تعريفات / تعريفات وتفسيرات / Definitions) that contains multiple \
   terms with explanations, format the ``content`` field so that each \
   definition is on its own single line prefixed with "- ": \
   \
   Format: "- TERM: EXPLANATION" \
   \
   Rules: \
   • Merge the term and its explanation onto ONE line even if they appear \
     on separate lines in the source text. \
   • The term comes first, followed by a colon ":", then the explanation. \
   • Each definition starts a new line beginning with "- ". \
   • Keep the article heading (e.g. "مادة (1) : تعريفات وتفسيرات :") on \
     its own line BEFORE the bullet list. \
   • Keep any introductory sentence (e.g. "تكون للكلمات والمصطلحات ...") \
     on its own line before the first "- " definition. \
   • Do NOT add "- " to non-definition content (articles, conditions, etc.). \
   \
   Example output for a definitions clause: \
   مادة (1) : تعريفات وتفسيرات : \
   تكون للكلمات والمصطلحات الواردة فيما يلي المعاني المذكورة قرين كلاً منها \
   - الهيئة أو العميل: يقصد بها الهيئة القومية للأنفاق \
   - ممثل الهيئة: يقصد به الإستشارى العام للمشروع \
   - المشروع: يقصد به كافة الأعمال التي ترغب الهيئة فى تصميمها وتنفيذها

Return your answer as a JSON array of clause objects.  Do NOT include any text \
outside the JSON array.  If the document contains no identifiable clauses, \
return an empty array [].
"""

# ---------------------------------------------------------------------------
# Article-boundary detector — matches the same patterns as Guideline 8 but
# only at the START of a line so cross-references are never treated as splits.
# ---------------------------------------------------------------------------
_ARTICLE_BOUNDARY_RE = re.compile(
    r"(?m)^(?:"
    r"(?:ال)?مادة\s*(?:رقم\s*)?[\(\[]?[١-٩\d]"   # مادة / المادة / مادة رقم
    r"|البند\s*(?:رقم\s*)?[\(\[]?[١-٩\d]"          # البند / البند رقم
    r"|(?:Article|Clause)\s+\d"                      # Article N / Clause N
    r")"
)

_CHUNK_SIZE = 15_000  # maximum characters per chunk

# Sub-article boundary — patterns like "9-1", "9/1", "٩-١" inside a parent article
_SUB_ARTICLE_RE = re.compile(
    r"(?m)^[١-٩\d]{1,3}\s*[-/]\s*[١-٩\d]{1,3}"
)


@dataclass
class _ApiResult:
    """Result of one extraction API call: the response text + whether it was cut
    off at max_tokens (stop_reason == 'max_tokens') even after retrying with more
    headroom. `truncated=True` means the JSON may be incomplete — the caller
    salvages what parsed and flags the document for review."""

    text: str
    truncated: bool


def _group_by_boundaries(
    text: str,
    boundaries: list[int],
    max_size: int,
    overlap: int,
) -> list[str]:
    """Group *text* into pieces of at most *max_size* chars, cutting only at
    the given *boundaries*.  Adds *overlap* chars from the previous piece to
    the start of each subsequent piece.
    """
    if not boundaries:
        return [text]

    pieces: list[str] = []
    start = 0
    bi = 0  # index into boundaries

    while start < len(text):
        # Find the furthest boundary that keeps piece ≤ max_size
        best_cut = None
        while bi < len(boundaries) and (boundaries[bi] - start) <= max_size:
            best_cut = boundaries[bi]
            bi += 1

        if best_cut is None or best_cut <= start:
            # No boundary fits — take up to max_size (hard cut)
            end = min(start + max_size, len(text))
            pieces.append(text[start:end])
            start = end - overlap if end < len(text) else end
        else:
            pieces.append(text[start:best_cut])
            start = max(best_cut - overlap, start + 1)

    return pieces if pieces else [text]


def _safe_int(value: Any) -> int | None:
    """Parse an int from a header value, returning None on absence/garbage."""
    if value is None:
        return None
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _min_tokens_remaining(headers: Any) -> int | None:
    """Smallest of the token-remaining headers present (combined / input / output).

    Different API versions expose ``anthropic-ratelimit-tokens-remaining`` and/or
    the split ``-input-tokens-remaining`` / ``-output-tokens-remaining``. We take
    the minimum of whatever is present so the gate reacts to the tightest budget.
    """
    candidates = [
        _safe_int(headers.get("anthropic-ratelimit-tokens-remaining")),
        _safe_int(headers.get("anthropic-ratelimit-input-tokens-remaining")),
        _safe_int(headers.get("anthropic-ratelimit-output-tokens-remaining")),
    ]
    present = [c for c in candidates if c is not None]
    return min(present) if present else None


class _RateLimitGate:
    """Thread-safe pacing gate driven by the live ``anthropic-ratelimit-*`` headers.

    The concurrency cap is the PRIMARY control on parallel chunk calls; this gate
    is a safety net. It holds a single shared "blocked until" instant (monotonic
    clock). When the API signals the window is nearly spent (a remaining-header at
    or below a floor) or explicitly tells us to wait (429 ``Retry-After``), every
    worker thread pauses until that instant — so the pool never trades sequential
    slowness for a wall of 429s. It NEVER lets the manual retry layer exceed the
    limit because all threads consult the same gate before each attempt.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._blocked_until = 0.0  # monotonic seconds

    def wait_if_needed(self) -> None:
        """Block the calling thread until any active pause has elapsed."""
        while True:
            with self._lock:
                remaining = self._blocked_until - time.monotonic()
            if remaining <= 0:
                return
            time.sleep(min(remaining, _RL_MAX_PAUSE))

    def _block_for(self, seconds: float) -> None:
        seconds = max(0.0, min(seconds, _RL_MAX_PAUSE))
        if seconds <= 0:
            return
        with self._lock:
            target = time.monotonic() + seconds
            if target > self._blocked_until:
                self._blocked_until = target

    def note_headers(self, headers: Any) -> None:
        """Inspect a successful response's headers; pause if the window is low."""
        if headers is None:
            return
        try:
            req_rem = _safe_int(headers.get("anthropic-ratelimit-requests-remaining"))
            tok_rem = _min_tokens_remaining(headers)
        except Exception:  # noqa: BLE001 — header shapes vary; never crash the call
            return
        if (req_rem is not None and req_rem <= _RL_REQUESTS_FLOOR) or (
            tok_rem is not None and tok_rem <= _RL_TOKENS_FLOOR
        ):
            logger.info(
                "Rate-limit window low (requests_remaining=%s, tokens_remaining=%s) "
                "— pausing parallel chunk calls for %.1fs",
                req_rem, tok_rem, _RL_LOW_REMAINING_PAUSE,
            )
            self._block_for(_RL_LOW_REMAINING_PAUSE)

    def note_retry_after(self, seconds: float) -> None:
        """Honor an explicit Retry-After: pause all threads for that long."""
        self._block_for(seconds)


def _retry_after_seconds(exc: APIStatusError) -> float | None:
    """Read the Retry-After header (seconds) off a 429/5xx, if present."""
    response = getattr(exc, "response", None)
    if response is None:
        return None
    try:
        raw = response.headers.get("retry-after")
    except Exception:  # noqa: BLE001
        return None
    return _safe_int(raw) if raw is not None else None


class ClauseExtractorAgent(BaseAgent):
    """Extracts structured clauses from contract document text."""

    def __init__(self) -> None:
        # max_retries=0 PINS the SDK's built-in retry layer OFF so it does not
        # MULTIPLY with our manual _call_api_with_retry loop (the old default
        # max_retries=2 stacked under 4 manual attempts = up to 12 hits/chunk).
        # Our manual layer is now the single, Retry-After-aware retry authority.
        super().__init__(max_retries=0)
        settings = get_settings()
        # Max concurrent chunk calls for one document (parallel chunked path).
        self._concurrency = max(1, int(settings.CLAUSE_EXTRACT_CONCURRENCY or 1))
        # Quality flags produced by the LAST extract() call (dedup-dropped /
        # combined-conditions). Read by the Celery task into the result so the
        # signals are visible downstream. Reset at the start of every extract().
        self.last_quality_flags: list[str] = []
        # (FIX C) Count of chunks whose response was TRUNCATED at max_tokens and
        # could not be recovered by retrying. Appended to across the parallel
        # chunk threads (list.append is atomic under the GIL); read by extract()
        # to raise the `clause_extraction_incomplete` flag. Reset per extract().
        self._truncated_chunks = 0
        self._truncation_lock = threading.Lock()

    def _note_truncation(self) -> None:
        """Thread-safe increment of the incomplete-chunk counter (FIX C).

        Called from `_parse_json` whenever a chunk's response could not be fully
        parsed as a complete JSON array (a max_tokens truncation OR any other
        cut-off/malformed array) — keyed on the EFFECT (parse failure), so it
        also catches non-max_tokens malformations, not just truncation. Guarded by
        the lock because chunk parsing runs across the parallel `_run_chunk`
        threads. Lazily tolerant of an instance built via `__new__` (no __init__),
        used by a couple of pure-parser unit tests.
        """
        lock = getattr(self, "_truncation_lock", None)
        if lock is None:
            self._truncated_chunks = getattr(self, "_truncated_chunks", 0) + 1
            return
        with lock:
            self._truncated_chunks += 1

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def extract(
        self,
        full_text: str,
        contract_type: str | None = None,
        document_label: str | None = None,
    ) -> list[dict[str, Any]]:
        """Extract clauses from *full_text*.

        For documents ≤ 30,000 characters the existing single-call path is
        used.  Larger documents are split on article (مادة) boundaries and
        processed in chunks of up to 15,000 characters each, then merged.

        Parameters
        ----------
        full_text:
            The complete text content of the contract document.
        contract_type:
            Optional hint about the contract type (e.g. "FIDIC_RED").
        document_label:
            Optional document label (e.g. "Contract Agreement",
            "General Conditions") so the AI can tailor its extraction.

        Returns
        -------
        list[dict[str, Any]]
            A list of clause dicts matching the ``ExtractedClauseItem`` schema.
        """
        self.last_quality_flags = []
        self._truncated_chunks = 0
        if len(full_text) <= 30_000:
            clauses = self._extract_single(full_text, contract_type, document_label)
        else:
            # _extract_chunked appends a dedup-dropped flag when the content-aware
            # merge removes duplicates.
            clauses = self._extract_chunked(full_text, contract_type, document_label)

        # (A) Stitch adjacent partials of ONE clause that was cut across a chunk
        # boundary (overshoot split OR a genuinely-huge single بند). Strict guards
        # (adjacent + same leading section + junction content overlap) mean this
        # can NEVER re-merge the distinct GC/PC clauses the content-dedup keeps
        # apart. (D/C) A stitch is surfaced loudly (per-stitch warning) + a flag.
        clauses, n_stitched = self._stitch_split_clauses(clauses)
        if n_stitched:
            self.last_quality_flags.append(f"{_SPLIT_CLAUSE_FLAG_PREFIX}{n_stitched}")

        # (E) Combined General + Particular Conditions detection — a بند numbering
        # RESTART (a low number reappears after a higher one) usually means both
        # sections are in ONE file. Per policy they should be SEPARATE uploads;
        # we flag + warn loudly rather than reroute. Runs on the final clause set,
        # so it also covers the small-document single-call path.
        if self._detect_numbering_restart(clauses):
            self.last_quality_flags.append(_COMBINED_CONDITIONS_FLAG)
            logger.warning(
                "Combined-conditions file detected: clause numbering RESTARTS "
                "(a low number reappears after a higher one) — General + "
                "Particular Conditions are likely in ONE file. Policy: upload as "
                "SEPARATE files. Extracted %d clause(s).",
                len(clauses),
            )

        # (FIX C) If any chunk's response could not be fully parsed (max_tokens
        # truncation or other malformation), the salvage parser kept the clauses
        # that DID parse but some may be missing. Raise a LOUD flag so the
        # incompleteness is SURFACED to the user (a review banner) downstream —
        # never let an incomplete extraction complete silently.
        if self._truncated_chunks > 0:
            self.last_quality_flags.append(
                f"{_TRUNCATION_FLAG_PREFIX}{self._truncated_chunks}"
            )
            logger.warning(
                "Extraction INCOMPLETE: %d chunk response(s) could not be fully "
                "parsed (truncated / malformed) — some clauses may be missing. "
                "Document flagged for review. Extracted %d clause(s).",
                self._truncated_chunks,
                len(clauses),
            )
        return clauses

    # ------------------------------------------------------------------
    # Single-call path (small documents)
    # ------------------------------------------------------------------

    def _extract_single(
        self,
        full_text: str,
        contract_type: str | None,
        document_label: str | None,
    ) -> list[dict[str, Any]]:
        """Process the entire document in one API call."""
        user_content = self._build_user_prefix(contract_type, document_label)
        user_content += (
            "Extract all clauses from the following contract document:\n\n"
            "---BEGIN DOCUMENT---\n"
            f"{full_text}\n"
            "---END DOCUMENT---"
        )
        result = self._call_api_with_retry(user_content)
        # Incompleteness is flagged inside _parse_json (effect-based) — it fires on
        # a truncated OR otherwise-unparseable array, so no separate note here.
        return self._parse_json(result.text)

    # ------------------------------------------------------------------
    # Chunked path (large documents)
    # ------------------------------------------------------------------

    def _split_on_article_boundaries(self, text: str) -> list[str]:
        """Split *text* at article-heading boundaries into ≤ _CHUNK_SIZE chunks.

        Each chunk starts at a مادة / البند / Article heading so Claude never
        receives a fragment that starts mid-clause.

        If a single article exceeds _CHUNK_SIZE (e.g. a huge Definitions
        article), it is further split at sub-article boundaries (N-M / N/M),
        then at paragraph boundaries (\n\n), with a 200-char overlap to
        preserve context at split edges.
        """
        boundaries = [m.start() for m in _ARTICLE_BOUNDARY_RE.finditer(text)]

        if not boundaries:
            logger.info("No article boundaries found — returning text as single chunk")
            return [text]

        # --- Phase 1: pack COMPLETE articles into ≤ _CHUNK_SIZE chunks ---
        # Issue 1 (Defect B) fix — chunk-boundary tail loss.
        # The previous packing set the chunk end to the FIRST boundary that
        # OVERSHOOTS _CHUNK_SIZE, so the chunk INCLUDED that overshooting article
        # whole and Phase 2 then hard-split the chunk mid-body — cutting the last
        # article. The per-chunk "skip continuations" note then made the model
        # drop the orphaned tail (no second partial → nothing for
        # _stitch_split_clauses to rejoin), deterministically losing long clauses
        # at the chunk edge (e.g. a GC section truncated at "… for example:" with
        # its enumerated list dropped).
        # We now cut BEFORE an article that would overshoot, so every
        # multi-article chunk holds only COMPLETE articles that fit; the
        # overshooting article moves WHOLE into the next chunk and is never
        # orphaned. The ONLY chunk allowed to exceed _CHUNK_SIZE is a SINGLE
        # article larger than the limit — that genuinely-oversized case is handed
        # to Phase 2 (_break_oversized_chunk + 200-char overlap + _stitch),
        # exactly as before. Large docs still chunk (>30k), the method hierarchy /
        # overlap / PR #117 stitch+dedup guards are all untouched.
        bounds = boundaries + [len(text)]  # article k spans bounds[k]:bounds[k+1]
        n_articles = len(boundaries)
        raw_chunks: list[str] = []
        i = 0
        while i < n_articles:
            start = bounds[i]
            # Grow one COMPLETE article at a time while the chunk still fits.
            k = i
            while k + 1 < len(bounds) and (bounds[k + 1] - start) <= _CHUNK_SIZE:
                k += 1
            if k == i:
                # A single article is itself larger than _CHUNK_SIZE — emit it
                # alone; Phase 2 breaks it (the only genuinely-oversized case).
                end = bounds[i + 1]
                next_i = i + 1
            else:
                # Articles i..k-1 fit and end at bounds[k]; article k (if any)
                # would overshoot, so it starts the NEXT chunk whole.
                end = bounds[k]
                next_i = k
            raw_chunks.append(text[start:end])
            i = next_i

        # --- Phase 2: break oversized chunks further ---
        final_chunks: list[str] = []
        for chunk in raw_chunks:
            if len(chunk) <= _CHUNK_SIZE:
                final_chunks.append(chunk)
            else:
                final_chunks.extend(self._break_oversized_chunk(chunk))

        return final_chunks

    @staticmethod
    def _merge_small_chunks(chunks: list[str], min_size: int = 500) -> list[str]:
        """Merge any chunk smaller than *min_size* chars into the previous chunk.

        Prevents tiny orphan fragments (e.g. 202-char leftovers from hard-split
        overlaps) from being sent to Claude, which causes prose-only responses.
        """
        if not chunks:
            return chunks
        merged: list[str] = []
        for chunk in chunks:
            if merged and len(chunk.strip()) < min_size:
                logger.info(
                    "Merging tiny chunk (%d chars) into previous chunk", len(chunk)
                )
                merged[-1] = merged[-1] + "\n\n" + chunk
            else:
                merged.append(chunk)
        return merged

    def _add_article_context(
        self,
        chunk: str,
        chunk_index: int,
        all_chunks: list[str],
    ) -> str:
        """Prepend the last مادة heading from the previous chunk if this chunk
        starts mid-article (i.e. does not begin with a مادة boundary marker).

        This gives Claude enough context to know which article the continuation
        belongs to, so it does NOT create a new spurious clause object for it.
        """
        stripped = chunk.strip()

        # If chunk already starts at an article boundary — nothing to do
        if _ARTICLE_BOUNDARY_RE.match(stripped):
            return chunk

        # Chunk starts mid-article — find the last مادة heading in prev chunk
        if chunk_index > 0:
            prev = all_chunks[chunk_index - 1]
            matches = list(_ARTICLE_BOUNDARY_RE.finditer(prev))
            if matches:
                last_match = matches[-1]
                heading_end = prev.find("\n", last_match.start())
                if heading_end == -1:
                    heading_end = last_match.start() + 150
                heading = prev[last_match.start():heading_end].strip()
                logger.info(
                    "Chunk %d starts mid-article — prepending heading: %r",
                    chunk_index + 1,
                    heading[:80],
                )
                return f"{heading}\n{chunk}"

        return chunk

    @staticmethod
    def _break_oversized_chunk(chunk: str) -> list[str]:
        """Split an oversized single-article chunk into ≤ _CHUNK_SIZE pieces.

        Strategy (in order of preference):
        1. Split at sub-article boundaries (N-M or N/M patterns)
        2. Fall back to paragraph boundaries (\\n\\n)

        A 200-char overlap is added between pieces so the AI never loses
        context at a split edge.

        NOTE (deferred FIX A): a sentence-boundary tier + a smaller safe target
        were prototyped here but REVERTED — for a boundary-less oversized article
        the resulting ~12k pieces are far larger than the PR #117 stitcher's
        junction-overlap threshold (~0.2 × piece length), so they cannot be
        rejoined; the fixed 200-char overlap is nowhere near enough. That would
        trade a truncation (now caught by FIX B headroom + FIX C salvage/flag) for
        UNFLAGGED over-fragmentation / tail-drop on the exact path it targets. Any
        future re-introduction MUST scale the overlap with the stitch threshold
        (and/or count a still-un-stitched multi-piece single-article split toward
        the incomplete flag). See docs/oversized-chunk-truncation-investigation.md
        + docs/stitch-threshold-large-clause-investigation.md.
        """
        overlap = 200

        # --- Try sub-article boundaries first ---
        sub_bounds = [m.start() for m in _SUB_ARTICLE_RE.finditer(chunk)]
        pieces = _group_by_boundaries(chunk, sub_bounds, _CHUNK_SIZE, overlap)
        if len(pieces) > 1:
            logger.info(
                "Oversized chunk (%d chars) split into %d pieces at sub-article boundaries",
                len(chunk), len(pieces),
            )
            return pieces

        # --- Fall back to paragraph boundaries (\n\n) ---
        para_bounds = [m.start() for m in re.finditer(r"\n\n", chunk)]
        pieces = _group_by_boundaries(chunk, para_bounds, _CHUNK_SIZE, overlap)
        if len(pieces) > 1:
            logger.info(
                "Oversized chunk (%d chars) split into %d pieces at paragraph boundaries",
                len(chunk), len(pieces),
            )
            return pieces

        # --- Last resort: hard split every _CHUNK_SIZE with overlap ---
        logger.warning(
            "Oversized chunk (%d chars) has no internal boundaries — hard splitting",
            len(chunk),
        )
        pieces = []
        pos = 0
        while pos < len(chunk):
            end = min(pos + _CHUNK_SIZE, len(chunk))
            pieces.append(chunk[pos:end])
            pos = end - overlap if end < len(chunk) else end
        return pieces

    def _extract_chunked(
        self,
        full_text: str,
        contract_type: str | None,
        document_label: str | None,
    ) -> list[dict[str, Any]]:
        """Split a large document on article boundaries and process each chunk.

        The per-chunk Anthropic calls run in PARALLEL (capped at
        ``self._concurrency``, default 3), but the merge/dedup runs sequentially
        in chunk-index order via ``_merge_in_order`` — so the result is
        byte-identical to the old one-at-a-time loop, just faster. Each chunk's
        prompt depends only on the deterministic chunk list (never on another
        chunk's API result), so building the prompts up-front is safe.
        """
        chunks = self._split_on_article_boundaries(full_text)
        chunks = self._merge_small_chunks(chunks)
        total = len(chunks)
        logger.info(
            "Large document (%d chars) split into %d chunks of max %d chars each",
            len(full_text),
            total,
            _CHUNK_SIZE,
        )

        # --- Phase 1: build the per-chunk prompts (deterministic, in order) ----
        # Each job is (idx, user_content). Tiny (<500-char) fragments are skipped
        # exactly as before — they never become a job, so order is preserved.
        jobs: list[tuple[int, str]] = []
        for idx, chunk in enumerate(chunks, 1):
            if len(chunk.strip()) < 500:
                logger.info(
                    "Skipping chunk %d/%d (%d chars) — too small to contain a clause",
                    idx, total, len(chunk),
                )
                continue

            # Prepend parent article heading if this chunk starts mid-article.
            # Pure function of the chunk LIST — independent of any API result.
            ctx_chunk = self._add_article_context(chunk, idx - 1, chunks)

            prefix = self._build_user_prefix(contract_type, document_label)
            chunk_note = (
                f"NOTE: This is chunk {idx} of {total} from a larger document.\n"
                "IMPORTANT RULES FOR THIS CHUNK:\n"
                "1. Only extract clauses that START in this chunk.\n"
                "   A clause STARTS when you see a مادة marker at the "
                "beginning of a line (e.g. 'مادة (12) :').\n"
                "2. Do NOT extract content that is a CONTINUATION of a clause "
                "that started before this chunk — even if the heading is "
                "prepended for context.\n"
                "3. If this chunk begins with a prepended heading line followed "
                "by continuation text, skip that continuation entirely.\n\n"
            )
            user_content = prefix + chunk_note + (
                "Extract all clauses from the following contract chunk:\n\n"
                "---BEGIN CHUNK---\n"
                f"{ctx_chunk}\n"
                "---END CHUNK---"
            )
            jobs.append((idx, user_content))

        # --- Phase 2: run the chunk calls in PARALLEL (capped), keyed by idx ---
        # A ThreadPoolExecutor keeps `concurrency` calls in flight at once and
        # picks up the next queued chunk as each finishes. The shared gate paces
        # all threads against the live rate-limit headers.
        results: dict[int, list[dict[str, Any]]] = {}
        if jobs:
            gate = _RateLimitGate()
            concurrency = max(1, min(self._concurrency, len(jobs)))
            logger.info(
                "Dispatching %d chunk call(s) with concurrency=%d",
                len(jobs), concurrency,
            )

            def _run_chunk(job: tuple[int, str]) -> tuple[int, list[dict[str, Any]]]:
                j_idx, user_content = job
                logger.info("Processing chunk %d/%d", j_idx, total)
                result = self._call_api_with_retry(user_content, gate=gate)
                if result.truncated:
                    logger.warning(
                        "Chunk %d/%d response truncated at max_tokens even after "
                        "retrying — salvaging the parseable clauses.", j_idx, total,
                    )
                # Incompleteness (truncation OR malformation) is flagged inside
                # _parse_json (effect-based) — see _note_truncation.
                chunk_clauses = self._parse_json(result.text)
                logger.info(
                    "Chunk %d/%d returned %d clauses", j_idx, total, len(chunk_clauses)
                )
                return j_idx, chunk_clauses

            with ThreadPoolExecutor(max_workers=concurrency) as executor:
                futures = {executor.submit(_run_chunk, job): job[0] for job in jobs}
                for future in as_completed(futures):
                    idx = futures[future]
                    try:
                        ridx, chunk_clauses = future.result()
                        results[ridx] = chunk_clauses
                    except Exception as exc:  # noqa: BLE001
                        # Preserve the ORIGINAL "skip a failed chunk" behavior: a
                        # chunk that exhausts retries contributes 0 clauses and the
                        # rest still merge. (Pre-existing silent-skip — kept as-is;
                        # hardening it is a tracked follow-up, out of scope here.)
                        logger.warning(
                            "Chunk %d/%d failed — skipping. Error: %s", idx, total, exc
                        )
                        results[idx] = []

        # --- Phase 3: CONTENT-AWARE merge/dedup — in chunk-index order ---------
        # `jobs` is already in ascending index order; reassemble results to match
        # and merge. Dedup is by NORMALIZED CONTENT (a true duplicate is the SAME
        # clause re-emitted at a chunk boundary), NOT by section_number/title — so
        # distinct clauses that merely share a بند number or heading are kept.
        ordered_chunk_clauses = [results.get(idx, []) for idx, _ in jobs]
        unique_clauses = self._merge_in_order(ordered_chunk_clauses)

        raw_total = sum(len(c) for c in ordered_chunk_clauses)
        dropped = raw_total - len(unique_clauses)
        if dropped > 0:
            # (D) Make clause loss VISIBLE — a quality flag + summary warning
            # (per-drop warnings come from _merge_in_order).
            self.last_quality_flags.append(f"{_DEDUP_DROPPED_FLAG_PREFIX}{dropped}")
            logger.warning(
                "Content-dedup removed %d duplicate clause(s) across %d chunks "
                "(kept %d unique).",
                dropped, total, len(unique_clauses),
            )
        logger.info(
            "Chunked extraction complete — %d unique clauses from %d chunks "
            "(%d duplicates removed)",
            len(unique_clauses),
            total,
            dropped,
        )
        return unique_clauses

    @staticmethod
    def _normalize_for_dedup(text: str) -> str:
        """Normalize clause content for equality comparison: NFKC + collapse all
        whitespace to single spaces + strip. Two emissions of the SAME clause
        (chunk-boundary overlap) normalize to the same string; distinct clauses
        do not.
        """
        if not text:
            return ""
        t = unicodedata.normalize("NFKC", text)
        t = re.sub(r"\s+", " ", t).strip()
        return t

    @staticmethod
    def _merge_in_order(
        ordered_chunk_clauses: list[list[dict[str, Any]]],
    ) -> list[dict[str, Any]]:
        """Merge per-chunk clause lists into the final deduplicated clause list.

        CONTENT-AWARE dedup: a TRUE duplicate is the SAME clause re-emitted at a
        chunk boundary — i.e. **near-identical normalized CONTENT** — NOT merely a
        shared ``section_number`` or ``title``. This is the fix for the GC+PC
        collision: a General-Conditions ``بند 1`` and a Particular-Conditions
        ``بند 1`` share the number (and may share a title) but have DIFFERENT
        content, so BOTH are kept. A real overlap duplicate has identical content
        and is merged to one.

        Content is the dedup key (not ``(section, content)``) on purpose: the
        model can label the two copies of an overlap duplicate with DIFFERENT
        section_numbers, so keying on content alone is the robust signal. Clauses
        with empty content are never treated as duplicates (kept as-is). First
        occurrence wins; ``ordered_chunk_clauses`` MUST be in chunk-index order.

        Every drop is surfaced LOUDLY (``logger.warning``) — clause loss is no
        longer a silent ``logger.debug``.
        """
        seen_content: set[str] = set()
        unique_clauses: list[dict[str, Any]] = []
        for chunk_clauses in ordered_chunk_clauses:
            for clause in chunk_clauses:
                norm = ClauseExtractorAgent._normalize_for_dedup(
                    clause.get("content", "")
                )
                if norm and norm in seen_content:
                    # (D) LOUD — a clause is being dropped as a true duplicate.
                    logger.warning(
                        "Dropping duplicate clause (identical content) — "
                        "section_number=%r title=%r",
                        clause.get("section_number"),
                        clause.get("title"),
                    )
                    continue
                if norm:
                    seen_content.add(norm)
                unique_clauses.append(clause)
        return unique_clauses

    @staticmethod
    def _leading_int(section_number: Any) -> int | None:
        """Parse the leading integer of a section_number (Western or Arabic-Indic
        digits), ignoring optional brackets. Returns None if there is no leading
        integer (e.g. null, "" , or a non-numeric label).
        """
        if section_number is None:
            return None
        s = str(section_number).strip()
        m = re.match(r"[\(\[]?\s*([0-9]+|[٠-٩]+)", s)
        if not m:
            return None
        digits = m.group(1).translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
        try:
            return int(digits)
        except ValueError:
            return None

    @staticmethod
    def _detect_numbering_restart(clauses: list[dict[str, Any]]) -> bool:
        """(E) True when clause numbering RESTARTS — a low number (≤ 2) reappears
        after a higher one has been seen. This is the signature of a single file
        that holds both General Conditions (``بند 1…N``) and Particular Conditions
        (``بند 1…M``). Sub-article-style numbers (e.g. "4.1") reduce to their
        leading integer, so normal ascending clause lists never trigger.
        """
        max_seen = 0
        for clause in clauses:
            n = ClauseExtractorAgent._leading_int(clause.get("section_number"))
            if n is None:
                continue
            if n <= 2 and max_seen > n + 1:
                return True  # a low number reappeared well after a higher one
            if n > max_seen:
                max_seen = n
        return False

    # ------------------------------------------------------------------
    # (A) Split-clause stitching — reassemble one clause cut across a chunk edge
    # ------------------------------------------------------------------

    # A junction overlap must be a SUBSTANTIAL contiguous block…
    _STITCH_MIN_OVERLAP = 60          # …at least this many chars, AND
    _STITCH_MIN_OVERLAP_FRACTION = 0.2  # …at least this fraction of the shorter partial.
    # The overlap must sit at the JUNCTION: near the END of the first partial and
    # near the START of the second (allowing for a prepended بند heading on the 2nd).
    _STITCH_P1_END_TOLERANCE = 60
    _STITCH_P2_START_TOLERANCE = 300

    @staticmethod
    def _content_overlap_merge(p1: str, p2: str) -> str | None:
        """If ``p1``'s SUFFIX overlaps ``p2``'s PREFIX (the signature of a single
        clause cut across a chunk boundary — a shared sub-article block plus the
        200-char split overlap), return the merged content that preserves ALL of
        both sides while the overlap appears once. Return ``None`` when there is
        no such junction overlap (i.e. these are NOT two partials of one clause).

        The merge keeps ALL of ``p1`` and appends only the part of ``p2`` AFTER
        the overlap — so every sub-article on both sides is preserved (7-1…7-4)
        and only the overlapping portion (7-3) is de-duplicated. ``p2``'s
        pre-overlap prefix (the prepended heading + the truncated copy of the
        overlap) is dropped in favour of ``p1``'s complete version.
        """
        if not p1 or not p2:
            return None
        min_size = max(
            ClauseExtractorAgent._STITCH_MIN_OVERLAP,
            ClauseExtractorAgent._STITCH_MIN_OVERLAP_FRACTION * min(len(p1), len(p2)),
        )
        # Scan ALL matching blocks (not just the longest) for one that sits at the
        # JUNCTION — near p1's END and near p2's START. This deliberately ignores
        # the identical بند heading both partials carry (it matches at the START of
        # BOTH → fails the "near p1's end" test) and locks onto the real overlap
        # (the shared sub-article block) instead.
        best = None
        for b in SequenceMatcher(None, p1, p2, autojunk=False).get_matching_blocks():
            if b.size < min_size:
                continue
            ends_p1 = (b.a + b.size) >= (len(p1) - ClauseExtractorAgent._STITCH_P1_END_TOLERANCE)
            starts_p2 = b.b <= ClauseExtractorAgent._STITCH_P2_START_TOLERANCE
            if ends_p1 and starts_p2 and (best is None or b.size > best.size):
                best = b
        if best is None:
            return None
        # Keep ALL of p1, append only p2's content AFTER the shared block.
        return p1 + p2[best.b + best.size :]

    @staticmethod
    def _stitch_split_clauses(
        clauses: list[dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], int]:
        """(A) Fold adjacent partials of the SAME clause — one clause cut across a
        chunk boundary — back into a single clause.

        STRICT guards, ALL required (never section-number alone):
          1. ADJACENT in output order (consecutive),
          2. SAME leading section number, and
          3. their contents OVERLAP at the junction (``_content_overlap_merge``).

        This CANNOT re-merge the GC/PC clauses the content-dedup fix keeps apart:
        a GC ``بند 7`` and a PC ``بند 7`` are non-adjacent (other clauses sit
        between them) and their contents do not overlap — either guard rejects.
        Handles N-way splits (a huge single بند cut into 3+ pieces) by folding
        each next partial into the growing merged clause.

        Returns ``(clauses, n_stitched)``.
        """
        if len(clauses) < 2:
            return clauses, 0
        result: list[dict[str, Any]] = [dict(clauses[0])]
        stitched = 0
        for clause in clauses[1:]:
            prev = result[-1]
            s_prev = ClauseExtractorAgent._leading_int(prev.get("section_number"))
            s_cur = ClauseExtractorAgent._leading_int(clause.get("section_number"))
            merged = None
            if s_prev is not None and s_prev == s_cur:
                merged = ClauseExtractorAgent._content_overlap_merge(
                    prev.get("content", "") or "", clause.get("content", "") or ""
                )
            if merged is not None:
                prev["content"] = merged  # extend prev (keep its title/section)
                stitched += 1
                logger.warning(
                    "Stitched a split clause (chunk-boundary partials reassembled) "
                    "— section_number=%r title=%r",
                    prev.get("section_number"),
                    prev.get("title"),
                )
            else:
                result.append(dict(clause))
        return result, stitched

    # ------------------------------------------------------------------
    # Shared helpers
    # ------------------------------------------------------------------

    def _build_user_prefix(
        self,
        contract_type: str | None,
        document_label: str | None,
    ) -> str:
        """Build the contract-type / document-label preamble for the user message."""
        prefix = ""
        if contract_type:
            prefix += f"Contract type: {contract_type}\n\n"
        if document_label:
            prefix += (
                f"Document label: {document_label}\n"
                "Note: Skip any cover pages, table of contents, or headers "
                "that may remain in the text. Extract only substantive "
                "contract clauses.\n\n"
            )
        return prefix

    @staticmethod
    def _calculate_max_tokens(text_length: int) -> int:
        """Return max_tokens based on input size tier (FIX B — headroom).

        The clause `content` is the EXACT verbatim source text, and Arabic is
        token-DENSE (often ~1 token per 1-1.5 chars) — so the JSON output of a
        near-15k chunk can approach or exceed the OLD 16k/24k/32k tiers and get
        cut off mid-array (silent clause loss). max_tokens is a CEILING billed per
        ACTUAL output token, so a generous ceiling costs nothing extra when the
        response is short — it only prevents truncation. Tiers stay input-length-
        keyed but are raised to give dense Arabic real room:

          <  6 000 chars  →  24 000 tokens
          < 12 000 chars  →  40 000 tokens
          ≥ 12 000 chars  →  56 000 tokens

        A truncation-aware retry (see `_call_api_with_retry`) can bump further, up
        to `_MAX_TOKENS_CEILING`, if a response is still cut off.
        """
        if text_length < 6_000:
            return 24_000
        elif text_length < 12_000:
            return 40_000
        else:
            return 56_000

    def _call_api_with_retry(
        self, user_content: str, gate: _RateLimitGate | None = None
    ) -> _ApiResult:
        """Call the Anthropic API with bounded, Retry-After-aware retry.

        The SDK's own retry layer is pinned OFF (``max_retries=0`` in __init__),
        so this is the SINGLE retry authority — the two layers no longer multiply.
        Backoff is a few seconds (4 → 8 → 16, capped), NOT the old 30/60/120, and
        honors the server's ``Retry-After`` header when present. When a ``gate``
        is supplied (the parallel chunked path) every thread paces against the
        live ``anthropic-ratelimit-*`` headers so the pool never runs the account
        into a wall of 429s.

        (FIX C — truncation-aware.) A max_tokens truncation is an HTTP **200** with
        ``stop_reason == 'max_tokens'`` — NOT an exception — so the old code
        returned the cut-off text as "success" and its clauses were silently lost.
        Now, on a truncated response, we RETRY with doubled max_tokens (up to
        ``_MAX_TOKENS_CEILING``) within the attempt budget; if it STILL truncates,
        we return the text marked ``truncated=True`` so the caller salvages the
        partial clauses AND flags the document for review — never a silent drop.
        """
        max_attempts = 4
        base_delay = 4              # seconds — exponential 4, 8, 16 …
        max_delay = _RL_MAX_PAUSE   # cap any single backoff (and Retry-After wait)
        last_exc: Exception | None = None

        max_tokens = self._calculate_max_tokens(len(user_content))
        logger.debug("API call: %d chars input → max_tokens=%d", len(user_content), max_tokens)

        for attempt in range(1, max_attempts + 1):
            if gate is not None:
                gate.wait_if_needed()
            try:
                raw_response = self._call_model(
                    max_tokens=max_tokens,
                    system=SYSTEM_PROMPT,
                    messages=[{"role": "user", "content": user_content}],
                    raw=True,
                    # Prompt caching: the ~2.3k-tok SYSTEM_PROMPT is identical
                    # across every chunk of a large document (up to 9 calls,
                    # seconds apart) — cache it so chunks 2..N read at 0.1x.
                    cache_system=True,
                )
                # Feed the live rate-limit headers to the gate BEFORE parsing so
                # peers see a low-window signal as early as possible.
                if gate is not None:
                    gate.note_headers(raw_response.headers)
                message = raw_response.parse()
                text = message.content[0].text
                if getattr(message, "stop_reason", None) == "max_tokens":
                    # Truncated mid-array. Retry with more headroom if we still
                    # can grow max_tokens AND have attempts left; else salvage.
                    bumped = min(max_tokens * 2, _MAX_TOKENS_CEILING)
                    if bumped > max_tokens and attempt < max_attempts:
                        logger.warning(
                            "Extraction response truncated at max_tokens=%d "
                            "(attempt %d/%d) — retrying with max_tokens=%d",
                            max_tokens, attempt, max_attempts, bumped,
                        )
                        max_tokens = bumped
                        continue
                    logger.warning(
                        "Extraction response STILL truncated at max_tokens=%d "
                        "after %d attempt(s) — salvaging partial clauses and "
                        "flagging the document for review.",
                        max_tokens, attempt,
                    )
                    return _ApiResult(text=text, truncated=True)
                return _ApiResult(text=text, truncated=False)  # clean success
            except APIStatusError as exc:
                # 529 = overloaded, 500/502/503/504 = transient server errors
                if exc.status_code in (429, 500, 502, 503, 504, 529):
                    last_exc = exc
                    retry_after = _retry_after_seconds(exc)
                    if retry_after is not None and gate is not None:
                        # Make ALL parallel threads honor the server's backoff.
                        gate.note_retry_after(retry_after)
                    delay = (
                        float(retry_after)
                        if retry_after is not None
                        else base_delay * (2 ** (attempt - 1))
                    )
                    delay = min(delay, max_delay)
                    logger.warning(
                        "Anthropic API transient error %s (attempt %d/%d) — "
                        "retrying in %.1fs: %s",
                        exc.status_code,
                        attempt,
                        max_attempts,
                        delay,
                        exc,
                    )
                    if attempt < max_attempts:
                        time.sleep(delay)
                    continue
                raise  # non-retryable status code
            except APIConnectionError as exc:
                last_exc = exc
                delay = min(base_delay * (2 ** (attempt - 1)), max_delay)
                logger.warning(
                    "Anthropic API connection error (attempt %d/%d) — "
                    "retrying in %.1fs: %s",
                    attempt,
                    max_attempts,
                    delay,
                    exc,
                )
                if attempt < max_attempts:
                    time.sleep(delay)
                continue
        else:
            # All attempts exhausted
            raise RuntimeError(
                f"Clause extraction failed after {max_attempts} attempts"
            ) from last_exc

    # Matches "مادة (1)", "مادة 1", "المادة (١)", "مادة رقم (2)", etc.
    # at the very start of clause content — with optional colon/dash after the number.
    _ARTICLE_PREFIX_RE = re.compile(
        r"^(?:ال)?مادة\s*(?:رقم\s*)?[\(\[]?\s*[١-٩\d]+\s*[\)\]]?\s*[:\-–—]?\s*",
        re.UNICODE,
    )

    def _strip_article_prefix(self, clauses: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Remove leading 'مادة (N)' markers from clause content fields."""
        for clause in clauses:
            content = clause.get("content", "")
            if content:
                clause["content"] = self._ARTICLE_PREFIX_RE.sub("", content).lstrip()
        return clauses

    def _parse_json(self, raw_text: str) -> list[dict[str, Any]]:
        """Strip optional markdown code fences and parse the JSON array.

        Handles empty responses, prose explanations mixed with JSON, and
        code-fenced JSON so Claude never crashes the pipeline regardless of
        what it returns for a tiny or non-clause chunk.
        """
        cleaned = raw_text.strip()
        if not cleaned:
            logger.warning("API returned empty response — treating as 0 clauses")
            return []

        # Strip markdown code fences (```json ... ``` or ``` ... ```)
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            lines = [l for l in lines if not l.strip().startswith("```")]
            cleaned = "\n".join(lines).strip()

        if not cleaned:
            return []

        # Fast path: response is already a bare JSON array
        if cleaned.startswith("["):
            try:
                return self._strip_article_prefix(json.loads(cleaned))
            except json.JSONDecodeError:
                pass  # fall through to extraction

        # Claude sometimes wraps the array in prose ("Here are the clauses: [...]")
        # Extract the first [...] block we find in the response.
        bracket_start = cleaned.find("[")
        bracket_end = cleaned.rfind("]")
        if bracket_start != -1 and bracket_end > bracket_start:
            candidate = cleaned[bracket_start : bracket_end + 1]
            try:
                clauses: list[dict[str, Any]] = json.loads(candidate)
                return self._strip_article_prefix(clauses)
            except json.JSONDecodeError:
                pass

        # (FIX C — salvage) A response TRUNCATED at max_tokens is a valid JSON
        # PREFIX cut off mid-array — a full json.loads fails, but its LEADING
        # objects are complete. The shared util decodes objects one at a time
        # from the first '[' and keeps everything before the first incomplete
        # one (the loop previously mirrored here from risk_analyzer now lives
        # ONCE in app/utils/json_salvage.py). Turns "lose the whole chunk"
        # into "lose only the trailing partial clause".
        if bracket_start != -1:
            salvaged = salvage_json_array(cleaned)
            if salvaged:
                self._note_truncation()  # incomplete array — flag it (FIX C)
                logger.warning(
                    "Recovered %d clause(s) from a truncated/partial JSON array "
                    "(the remainder was cut off / malformed).", len(salvaged),
                )
                return self._strip_article_prefix(salvaged)
            # A '[' was present but nothing parsed AND nothing salvaged — a
            # cut-off/broken array that yielded 0 clauses. Flag the incompleteness
            # (FIX C) so a 0-clause truncated chunk is visible, not silent.
            self._note_truncation()

        # Nothing parseable found — log a warning and return empty
        logger.warning(
            "Could not extract a JSON array from API response (first 200 chars): %r",
            cleaned[:200],
        )
        return []
