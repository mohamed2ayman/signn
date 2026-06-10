"""Phase 7.27 — Hybrid legal-document chunker (Python).

Ported from the original TypeScript chunker, with the two fixes surfaced by
the Phase D smoke test on the real Egyptian Civil Code PDF:

  Fix 1 — Real token counting via tiktoken.
    The TS version estimated Arabic tokens as ``chars / 4``.  Measured against
    OpenAI's cl100k_base tokenizer, Arabic is ~0.7 tokens/char — roughly 3×
    denser than the heuristic assumed.  A 5,984-char Arabic chunk the TS
    estimator called "1,496 tokens" was actually >4,000 real tokens, and with
    Unicode presentation forms it blew past OpenAI's 8,192-token embedding cap,
    producing a 400.  We now count with the real tokenizer and cap at
    ``MAX_TOKENS = 6000`` (safety margin below 8,192).

  Fix 2 — NFKC normalization.
    Some Arabic PDFs (the Egyptian Civil Code included) store text as Unicode
    *presentation forms* (U+FB50–U+FEFF) rather than standard Arabic
    (U+0600–U+06FF).  The article-boundary regex matches standard 'مادة' only,
    so article detection found zero articles and every chunk fell into the
    NULL-article preamble path.  ``unicodedata.normalize('NFKC', text)`` folds
    presentation forms to standard Arabic, making the regex match — and, as a
    bonus, cuts token density ~2.6× because presentation-form codepoints
    tokenize far worse than standard ones.

    Note on bidi: NFKC does NOT reorder visual-order text to logical order.
    For embedding and round-trip retrieval that is fine (OpenAI is
    direction-agnostic and chunk_text stores byte-identically).  If retrieval
    quality looks wrong we will add bidi reordering as a follow-up.

Strategy (unchanged from the TS version):
  1. Split on article boundary markers (Arabic مادة / البند, English Article N).
  2. If an article exceeds MAX_TOKENS, split further at sentence boundaries.
  3. All sub-chunks of one article share the SAME article_reference.
  4. Preamble / trailing text with no detected marker → article_reference = None.

This module is pure Python — no I/O, no external API calls.  Tested by
tests/test_legal_document_chunker.py.
"""

from __future__ import annotations

import re
import unicodedata
from functools import lru_cache
from typing import Optional, TypedDict

# ─── Configuration ──────────────────────────────────────────────────────────

# Maximum real tokens per chunk before sentence-boundary splitting.
# OpenAI text-embedding-3-small hard limit is 8192; 6000 leaves margin for any
# inline metadata and for tokenizer drift between models.
MAX_TOKENS = 6000

# The encoding used by text-embedding-3-small.  tiktoken 0.5.2 has no model
# mapping for that name, so we request the encoding directly.
_ENCODING_NAME = "cl100k_base"

# Combined regex for Arabic and English article boundary markers.
#   Arabic:  مادة 1 / مادة (1) / مادة رقم (1) / مادة (١) / البند (1) / البند رقم 1
#   English: Article 1 / ARTICLE 1   (case-insensitive)
# Arabic-Indic numerals U+0660–U+0669 are included alongside ASCII digits.
_ARTICLE_MARKER_REGEX = re.compile(
    r"(?:مادة|البند)\s*(?:رقم\s*)?\(?\s*(?:\d+|[٠-٩]+)\s*\)?"
    r"|Article\s+\d+",
    re.IGNORECASE,
)

# Arabic sentence terminators / paragraph breaks: . ؟ ! or a blank line.
_ARABIC_SENTENCE_SPLIT = re.compile(r"(?<=[.؟!])\s+|(?:\r?\n){2,}")

# English sentence split: end punctuation + whitespace + capital, or blank line.
_ENGLISH_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z])|(?:\r?\n){2,}")

# Detects the presence of any Arabic-script character (standard block).
_ARABIC_CHAR = re.compile(r"[؀-ۿ]")

# Arabic blocks used for the predominance test in visual→logical reordering:
#   U+0600–U+06FF  Arabic
#   U+0750–U+077F  Arabic Supplement
_ARABIC_RANGES = (("؀", "ۿ"), ("ݐ", "ݿ"))


class ChunkResult(TypedDict):
    """One chunk ready for bulk-insert into legal_document_chunks."""

    chunk_index: int
    chunk_text: str
    article_reference: Optional[str]
    token_count: int


# ─── Tokenizer ──────────────────────────────────────────────────────────────


@lru_cache(maxsize=1)
def _get_encoder():
    """Return the cached cl100k_base tokenizer (loaded once per process)."""
    import tiktoken

    return tiktoken.get_encoding(_ENCODING_NAME)


def count_tokens(text: str) -> int:
    """Count real OpenAI tokens for *text* using cl100k_base."""
    if not text:
        return 0
    return len(_get_encoder().encode(text))


# ─── Helpers ────────────────────────────────────────────────────────────────


def _contains_arabic(text: str) -> bool:
    return bool(_ARABIC_CHAR.search(text))


def _is_predominantly_arabic(s: str) -> bool:
    """True when more than half the *letters* on a line are Arabic-script.

    Used to decide whether a line is RTL (needs word-order reversal) or LTR
    (left as-is).  Counts only alphabetic characters so digits, punctuation,
    and whitespace don't skew the ratio.
    """
    arabic_chars = sum(
        1
        for c in s
        if any(lo <= c <= hi for lo, hi in _ARABIC_RANGES)
    )
    total_letters = sum(1 for c in s if c.isalpha())
    return total_letters > 0 and arabic_chars / total_letters > 0.5


def visual_to_logical_arabic(text: str) -> str:
    """Convert visual-order Arabic text to logical order via line word-reversal.

    Some Arabic PDFs (the Egyptian Civil Code among them) store text in *visual*
    order — each line's words laid out right-to-left as rendered, which when read
    left-to-right comes out reversed.  python-bidi's ``get_display`` does
    LOGICAL→VISUAL; the inverse has no canonical algorithm, but for
    RTL-predominant legal prose a per-line word-order reversal restores logical
    order.  Verified against مادة 217 of the real Civil Code:
      visual  : "القاهرة والقوة المفاجئ الحادث تبعة المدين يتحمل أن على الاتفاق يجوز"
      logical : "يجوز الاتفاق على أن يتحمل المدين تبعة الحادث المفاجئ والقوة القاهرة"

    LTR lines (predominantly English) are left untouched so mixed documents and
    English-only laws are unaffected.  Character order WITHIN each word is never
    altered — only the order of words on a line.
    """
    out: list[str] = []
    for line in text.split("\n"):
        if _is_predominantly_arabic(line):
            out.append(" ".join(reversed(line.split(" "))))
        else:
            out.append(line)
    return "\n".join(out)


def _split_into_sentences(text: str) -> list[str]:
    """Split text into sentences, picking the Arabic or English splitter.

    Falls back to the whole text as a single sentence if no split is found.
    """
    splitter = _ARABIC_SENTENCE_SPLIT if _contains_arabic(text) else _ENGLISH_SENTENCE_SPLIT
    parts = [s for s in splitter.split(text) if s and s.strip()]
    return parts if parts else [text]


def _split_oversized(
    text: str,
    article_ref: Optional[str],
    start_index: int,
) -> list[ChunkResult]:
    """Split an oversized article/preamble at sentence boundaries.

    Each emitted sub-chunk stays within MAX_TOKENS.  A single sentence that is
    itself larger than MAX_TOKENS (vanishingly rare for legal prose) is emitted
    on its own rather than cut mid-sentence — the embedding API would still
    accept it as long as it is under 8192; if a pathological sentence ever
    exceeds even that, the caller's error path records the failure rather than
    silently truncating.
    """
    sentences = _split_into_sentences(text)
    results: list[ChunkResult] = []
    current: list[str] = []
    current_tokens = 0
    idx = start_index

    for sentence in sentences:
        sentence_tokens = count_tokens(sentence)
        if current and current_tokens + sentence_tokens > MAX_TOKENS:
            chunk_text = " ".join(current).strip()
            if chunk_text:
                results.append(
                    ChunkResult(
                        chunk_index=idx,
                        chunk_text=chunk_text,
                        article_reference=article_ref,
                        token_count=count_tokens(chunk_text),
                    )
                )
                idx += 1
            current = []
            current_tokens = 0
        current.append(sentence)
        current_tokens += sentence_tokens

    if current:
        chunk_text = " ".join(current).strip()
        if chunk_text:
            results.append(
                ChunkResult(
                    chunk_index=idx,
                    chunk_text=chunk_text,
                    article_reference=article_ref,
                    token_count=count_tokens(chunk_text),
                )
            )

    return results


def _emit(
    text: str,
    article_ref: Optional[str],
    start_index: int,
) -> list[ChunkResult]:
    """Emit one chunk if within MAX_TOKENS, else sentence-split into several."""
    trimmed = text.strip()
    if not trimmed:
        return []
    tokens = count_tokens(trimmed)
    if tokens <= MAX_TOKENS:
        return [
            ChunkResult(
                chunk_index=start_index,
                chunk_text=trimmed,
                article_reference=article_ref,
                token_count=tokens,
            )
        ]
    return _split_oversized(trimmed, article_ref, start_index)


# ─── Main entry point ───────────────────────────────────────────────────────


def chunk_legal_document(
    extracted_text: str,
    is_visual_order: bool = False,
) -> list[ChunkResult]:
    """Chunk a legal document's extracted text.

    The input is NFKC-normalized first (Fix 2) so Arabic presentation forms
    fold to standard Arabic and the article regex matches.  Token counts use
    the real cl100k_base tokenizer (Fix 1).

    Parameters
    ----------
    extracted_text:
        Raw text from the extractor.
    is_visual_order:
        When True, the document's source is known to store Arabic in *visual*
        (RTL word-reversed) order, so word order is reversed back to logical
        order after NFKC and before article detection.  When False (default),
        text is treated as already-logical and only NFKC is applied — this
        preserves behavior for the common case.  The flag is sourced from the
        document's legal_source.is_visual_order column; the chunker NEVER
        auto-detects direction (unconditional reversal corrupts logical text).

    Returns a list of ChunkResult dicts with contiguous zero-based
    ``chunk_index`` across the whole document.
    """
    if not extracted_text or not extracted_text.strip():
        return []

    # Fix 2 — fold presentation forms (U+FB50–U+FEFF) to standard Arabic so
    # the article regex (standard 'مادة') can match.
    text = unicodedata.normalize("NFKC", extracted_text)

    # Visual → logical reordering is GATED on the per-source flag.  Applying it
    # unconditionally would corrupt already-logical text (the common case), so
    # it fires only when the source is catalogued as visual-order (e.g. the
    # Egyptian Tax Authority).  Verified on مادة 217 of the Civil Code.
    if is_visual_order:
        text = visual_to_logical_arabic(text)

    results: list[ChunkResult] = []
    next_index = 0

    matches = list(_ARTICLE_MARKER_REGEX.finditer(text))

    # No markers → whole document is preamble (possibly sentence-split).
    if not matches:
        return _emit(text, None, 0)

    # Preamble before the first marker.
    if matches[0].start() > 0:
        preamble = text[: matches[0].start()]
        chunks = _emit(preamble, None, next_index)
        results.extend(chunks)
        next_index += len(chunks)

    # Each article slice runs from its marker to the next marker (or EOF).
    for i, match in enumerate(matches):
        start = match.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        marker = match.group(0).strip()
        body = text[start:end]
        chunks = _emit(body, marker, next_index)
        results.extend(chunks)
        next_index += len(chunks)

    return results
