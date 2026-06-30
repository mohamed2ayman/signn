"""Clause Extractor Agent -- identifies and structures clauses from contract text."""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from anthropic import Anthropic, APIConnectionError, APIStatusError

from app.config.settings import get_settings

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
1. Preserve the EXACT original text — never paraphrase or rewrite
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


class ClauseExtractorAgent:
    """Extracts structured clauses from contract document text."""

    def __init__(self) -> None:
        settings = get_settings()
        # max_retries=0 PINS the SDK's built-in retry layer OFF so it does not
        # MULTIPLY with our manual _call_api_with_retry loop (the old default
        # max_retries=2 stacked under 4 manual attempts = up to 12 hits/chunk).
        # Our manual layer is now the single, Retry-After-aware retry authority.
        self._client = Anthropic(api_key=settings.ANTHROPIC_API_KEY, max_retries=0)
        self._model = settings.ANTHROPIC_MODEL
        # Max concurrent chunk calls for one document (parallel chunked path).
        self._concurrency = max(1, int(settings.CLAUSE_EXTRACT_CONCURRENCY or 1))

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
        if len(full_text) <= 30_000:
            return self._extract_single(full_text, contract_type, document_label)
        return self._extract_chunked(full_text, contract_type, document_label)

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
        raw = self._call_api_with_retry(user_content)
        return self._parse_json(raw)

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

        # --- Phase 1: split at article boundaries ---
        raw_chunks: list[str] = []
        i = 0
        while i < len(boundaries):
            start = boundaries[i]

            # Advance j while the next boundary still fits within _CHUNK_SIZE
            j = i + 1
            while j < len(boundaries) and (boundaries[j] - start) <= _CHUNK_SIZE:
                j += 1

            end = boundaries[j] if j < len(boundaries) else len(text)
            raw_chunks.append(text[start:end])
            i = j

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
                raw = self._call_api_with_retry(user_content, gate=gate)
                chunk_clauses = self._parse_json(raw)
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

        # --- Phase 3: merge/dedup — UNCHANGED logic, in chunk-index order ------
        # `jobs` is already in ascending index order; reassemble results to match
        # and merge exactly as the sequential loop did → byte-identical output.
        ordered_chunk_clauses = [results.get(idx, []) for idx, _ in jobs]
        unique_clauses = self._merge_in_order(ordered_chunk_clauses)

        raw_total = sum(len(c) for c in ordered_chunk_clauses)
        logger.info(
            "Chunked extraction complete — %d unique clauses from %d chunks "
            "(%d duplicates removed)",
            len(unique_clauses),
            total,
            raw_total - len(unique_clauses),
        )
        return unique_clauses

    @staticmethod
    def _merge_in_order(
        ordered_chunk_clauses: list[list[dict[str, Any]]],
    ) -> list[dict[str, Any]]:
        """Merge per-chunk clause lists into the final deduplicated clause list.

        This is the EXACT merge/dedup the sequential loop used, factored out so
        the parallel path can call it with results reassembled in chunk-index
        order — and so it can be unit-tested directly. ``ordered_chunk_clauses``
        MUST be in chunk-index order; the output is byte-identical to processing
        the chunks one at a time (same section dedup, same null-section running
        counter, same title-dedup, same order).
        """
        all_clauses: list[dict[str, Any]] = []
        seen_sections: set[str] = set()
        for chunk_clauses in ordered_chunk_clauses:
            # Merge — deduplicate by section_number to handle any overlap
            for clause in chunk_clauses:
                sec = clause.get("section_number")
                key = (
                    str(sec)
                    if sec is not None
                    else f"__nosec_{len(all_clauses)}"
                )
                if key not in seen_sections:
                    seen_sections.add(key)
                    all_clauses.append(clause)
                else:
                    logger.debug("Duplicate section_number %s skipped", key)

        # Final deduplication pass by title (safety net for any overlap the
        # section_number key may have missed, e.g. clauses with no section_number)
        seen_titles: set[str] = set()
        unique_clauses: list[dict[str, Any]] = []
        for clause in all_clauses:
            title_key = clause.get("title", "").strip().lower()
            if title_key and title_key not in seen_titles:
                seen_titles.add(title_key)
                unique_clauses.append(clause)
            elif not title_key:
                unique_clauses.append(clause)  # keep untitled clauses as-is
            else:
                logger.debug(
                    "Duplicate title '%s' skipped in final dedup pass",
                    clause.get("title"),
                )
        return unique_clauses

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
        """Return max_tokens based on input size tier.

        Arabic JSON output is hard to estimate precisely, so we use
        conservative fixed tiers that are still 50-75 % cheaper than
        the old hard-coded 64 000:

          < 10 000 chars  →  16 000 tokens  (saves 75 %)
          < 20 000 chars  →  24 000 tokens  (saves 63 %)
          ≥ 20 000 chars  →  32 000 tokens  (saves 50 %)
        """
        if text_length < 10_000:
            return 16_000
        elif text_length < 20_000:
            return 24_000
        else:
            return 32_000

    def _call_api_with_retry(
        self, user_content: str, gate: _RateLimitGate | None = None
    ) -> str:
        """Call the Anthropic API with bounded, Retry-After-aware retry.

        The SDK's own retry layer is pinned OFF (``max_retries=0`` in __init__),
        so this is the SINGLE retry authority — the two layers no longer multiply.
        Backoff is a few seconds (4 → 8 → 16, capped), NOT the old 30/60/120, and
        honors the server's ``Retry-After`` header when present. When a ``gate``
        is supplied (the parallel chunked path) every thread paces against the
        live ``anthropic-ratelimit-*`` headers so the pool never runs the account
        into a wall of 429s.
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
                raw_response = self._client.messages.with_raw_response.create(
                    model=self._model,
                    max_tokens=max_tokens,
                    system=SYSTEM_PROMPT,
                    messages=[{"role": "user", "content": user_content}],
                )
                # Feed the live rate-limit headers to the gate BEFORE parsing so
                # peers see a low-window signal as early as possible.
                if gate is not None:
                    gate.note_headers(raw_response.headers)
                message = raw_response.parse()
                return message.content[0].text  # success
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

        # Nothing parseable found — log a warning and return empty
        logger.warning(
            "Could not extract a JSON array from API response (first 200 chars): %r",
            cleaned[:200],
        )
        return []
