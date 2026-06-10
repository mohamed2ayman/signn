"""Phase 7.27 — Tests for the Python hybrid legal-document chunker.

Ported from the original TypeScript spec, plus coverage for the two fixes
surfaced by the Phase D smoke test:
  - NFKC normalization folds Arabic presentation forms (the regex then matches)
  - tiktoken-based real token counting + MAX_TOKENS cap is respected

Cases:
  1.  Empty / whitespace input -> []
  2.  NFKC folds presentation forms (ﻣﺎدة -> مادة) at the unicode level
  3.  Arabic article detection on presentation-form text (the real-PDF case)
  4.  Arabic article detection on standard-form مادة (N) text
  5.  English Article N detection (case-insensitive)
  6.  Arabic-Indic numerals (١, ٢) detected
  7.  البند / البند رقم detection
  8.  Preamble before first marker -> article_reference = None
  9.  Oversized article split at sentence boundaries (real tiktoken count)
  10. Sub-chunks of one oversized article share the same article_reference
  11. chunk_index contiguous + zero-based across split articles
  12. No-marker document -> single preamble chunk (article_reference None)
  13. count_tokens matches a direct tiktoken count for a known Arabic string
  14. MAX_TOKENS cap respected — no returned chunk exceeds it
"""

from __future__ import annotations

import unicodedata

import pytest

from app.services.legal_document_chunker import (
    MAX_TOKENS,
    chunk_legal_document,
    count_tokens,
    visual_to_logical_arabic,
    _is_predominantly_arabic,
)


# ─── 1. Edge cases ───────────────────────────────────────────────────────────


def test_empty_string_returns_empty():
    assert chunk_legal_document("") == []


def test_whitespace_only_returns_empty():
    assert chunk_legal_document("   \n\t  ") == []


# ─── 2. NFKC folding at the unicode level ────────────────────────────────────


def test_nfkc_folds_presentation_forms_to_standard_arabic():
    pres = "ﻣﺎدة"  # presentation forms U+FEE3 U+FE8E U+062F U+0629
    std = "مادة"  # standard U+0645 U+0627 U+062F U+0629
    assert pres != std  # different codepoints before folding
    assert unicodedata.normalize("NFKC", pres) == std


# ─── 3. Arabic article detection on presentation-form text (the real bug) ────


def test_detects_articles_in_presentation_form_text():
    # This mirrors what the Egyptian Civil Code PDF actually stored.
    pres = "ﻣﺎدة1\nنص البند الأول هنا.\n\nﻣﺎدة2\nنص البند الثاني هنا."
    chunks = chunk_legal_document(pres)
    assert len(chunks) == 2
    # After NFKC the references are standard-form مادة
    assert chunks[0]["article_reference"] == "مادة1"
    assert chunks[1]["article_reference"] == "مادة2"


# ─── 4. Standard-form Arabic detection ───────────────────────────────────────


def test_detects_standard_madda_with_brackets():
    text = "مادة (1)\nنص البند الأول.\n\nمادة (2)\nنص البند الثاني."
    chunks = chunk_legal_document(text)
    assert len(chunks) == 2
    assert chunks[0]["article_reference"].startswith("مادة")
    assert "1" in chunks[0]["article_reference"]


def test_detects_madda_raqm_prefix():
    text = "مادة رقم (1)\nنص.\n\nمادة رقم (2)\nنص."
    chunks = chunk_legal_document(text)
    assert len(chunks) == 2
    assert "مادة" in chunks[0]["article_reference"]


# ─── 5. English detection ────────────────────────────────────────────────────


def test_detects_english_article_titlecase():
    text = "Article 1\nFirst body.\n\nArticle 2\nSecond body.\n\nArticle 3\nThird."
    chunks = chunk_legal_document(text)
    assert len(chunks) == 3
    for i, c in enumerate(chunks):
        assert c["article_reference"].lower() == f"article {i + 1}"


def test_detects_english_article_uppercase_case_insensitive():
    text = "ARTICLE 1\nBody one.\n\nARTICLE 2\nBody two."
    chunks = chunk_legal_document(text)
    assert len(chunks) == 2
    assert chunks[0]["article_reference"].lower() == "article 1"


# ─── 6. Arabic-Indic numerals ────────────────────────────────────────────────


def test_detects_arabic_indic_numerals():
    text = "مادة (١)\nنص الأول.\n\nمادة (٢)\nنص الثاني."
    chunks = chunk_legal_document(text)
    assert len(chunks) == 2
    assert "١" in chunks[0]["article_reference"]
    assert "٢" in chunks[1]["article_reference"]


# ─── 7. البند forms ──────────────────────────────────────────────────────────


def test_detects_band_form():
    text = "البند (1)\nنص الأول.\n\nالبند (2)\nنص الثاني."
    chunks = chunk_legal_document(text)
    assert len(chunks) == 2
    assert "البند" in chunks[0]["article_reference"]


def test_detects_band_raqm_form():
    text = "البند رقم (1)\nنص.\n\nالبند رقم (2)\nنص."
    chunks = chunk_legal_document(text)
    assert len(chunks) == 2
    assert "البند" in chunks[0]["article_reference"]


# ─── 8. Preamble before first marker ─────────────────────────────────────────


def test_preamble_before_first_marker_is_null_reference():
    text = "This is the preamble.\nMultiple sentences here.\n\nArticle 1\nFirst body."
    chunks = chunk_legal_document(text)
    assert chunks[0]["article_reference"] is None
    assert "preamble" in chunks[0]["chunk_text"]
    assert chunks[1]["article_reference"].lower() == "article 1"


# ─── 9 & 10. Oversized article splitting + shared reference ───────────────────


def _build_oversized_english_article(marker: str, n_sentences: int = 400) -> str:
    sentences = [
        f"Contract provision number {i:03d} establishes a binding obligation "
        f"upon all parties to this agreement and must be read together with the "
        f"general conditions set out elsewhere herein."
        for i in range(n_sentences)
    ]
    return f"{marker}\n" + " ".join(sentences)


def test_oversized_article_splits_at_sentence_boundaries():
    text = _build_oversized_english_article("Article 1")
    # Sanity: the whole body must actually exceed MAX_TOKENS for this test.
    assert count_tokens(text) > MAX_TOKENS
    chunks = chunk_legal_document(text)
    assert len(chunks) > 1
    for c in chunks:
        assert c["token_count"] <= MAX_TOKENS


def test_oversized_subchunks_share_article_reference():
    text = _build_oversized_english_article("Article 5") + "\n\nArticle 6\nShort article body."
    chunks = chunk_legal_document(text)
    art5 = [c for c in chunks if c["article_reference"] and "5" in c["article_reference"]]
    assert len(art5) > 1
    refs = {c["article_reference"] for c in art5}
    assert len(refs) == 1  # all sub-chunks share the same reference


# ─── 11. Contiguous zero-based chunk_index ────────────────────────────────────


def test_chunk_index_contiguous_simple():
    text = "\n\n".join(f"Article {i}\nBody {i} text here." for i in range(1, 6))
    chunks = chunk_legal_document(text)
    for i, c in enumerate(chunks):
        assert c["chunk_index"] == i


def test_chunk_index_contiguous_across_oversized_split():
    text = _build_oversized_english_article("Article 1") + "\n\nArticle 2\nShort body."
    chunks = chunk_legal_document(text)
    for i, c in enumerate(chunks):
        assert c["chunk_index"] == i


# ─── 12. No markers → single preamble chunk ──────────────────────────────────


def test_no_markers_single_preamble_chunk():
    text = "A short document with no article markers at all. Just prose."
    chunks = chunk_legal_document(text)
    assert len(chunks) == 1
    assert chunks[0]["article_reference"] is None
    assert chunks[0]["chunk_index"] == 0


# ─── 13. Real tiktoken token counting ────────────────────────────────────────


def test_count_tokens_matches_direct_tiktoken():
    import tiktoken

    enc = tiktoken.get_encoding("cl100k_base")
    sample = "مادة (1) العقد شريعة المتعاقدين"
    assert count_tokens(sample) == len(enc.encode(sample))


def test_count_tokens_arabic_is_denser_than_chars_over_4():
    # Regression guard for Fix 1: Arabic is far denser than the old chars/4
    # heuristic.  A 100-char Arabic string is well above 25 tokens.
    arabic = "العقد شريعة المتعاقدين فلا يجوز نقضه ولا تعديله إلا باتفاق الطرفين."
    naive = len(arabic) // 4
    real = count_tokens(arabic)
    assert real > naive  # the whole reason Fix 1 exists


# ─── 14. MAX_TOKENS cap respected globally ───────────────────────────────────


def test_no_chunk_exceeds_max_tokens():
    # Mixed Arabic + English, with one oversized article and several small ones.
    big_arabic = "مادة (1)\n" + ("هذا نص قانوني طويل جدا يتكرر كثيرا. " * 600)
    text = big_arabic + "\n\nArticle 2\nShort English body.\n\nمادة (3)\nنص قصير."
    chunks = chunk_legal_document(text)
    assert len(chunks) > 1
    for c in chunks:
        assert c["token_count"] <= MAX_TOKENS


# ─── 15. Visual-order flag — helper functions ────────────────────────────────


def test_is_predominantly_arabic_pure_arabic_line():
    assert _is_predominantly_arabic("القوة القاهرة وأثرها على العقد") is True


def test_is_predominantly_arabic_pure_english_line():
    assert _is_predominantly_arabic("Force majeure and its effect") is False


def test_is_predominantly_arabic_mixed_and_empty():
    # Majority-English mixed line → not predominantly Arabic.
    assert _is_predominantly_arabic("Article القوة 1") is False
    # No letters at all (digits/punct only) → False (guards div-by-zero).
    assert _is_predominantly_arabic("( 1 ) - 217") is False


def test_visual_to_logical_reverses_arabic_word_order():
    # The مادة 217 case proven in Phase D.
    visual = "القاهرة والقوة المفاجئ الحادث تبعة المدين يتحمل أن على الاتفاق يجوز"
    logical = visual_to_logical_arabic(visual)
    # In logical order, يجوز ("it is permitted") leads and القاهرة trails.
    assert logical.split()[0] == "يجوز"
    assert logical.split()[-1] == "القاهرة"


def test_visual_to_logical_leaves_english_lines_unchanged():
    english = "This English line must not be reversed at all."
    assert visual_to_logical_arabic(english) == english


def test_visual_to_logical_mixed_doc_reverses_only_arabic_lines():
    text = "English heading stays put.\nالقاهرة والقوة المفاجئ"
    out = visual_to_logical_arabic(text).split("\n")
    assert out[0] == "English heading stays put."  # LTR line untouched
    assert out[1] == "المفاجئ والقوة القاهرة"       # RTL line reversed


# ─── 16. Visual-order flag — chunk_legal_document gating ──────────────────────


def test_flag_false_default_leaves_logical_text_unchanged():
    # Default (is_visual_order=False): logical-order Arabic is NOT reversed,
    # and standard spaced markers are still detected.
    text = "مادة (1)\nالعقد شريعة المتعاقدين.\n\nمادة (2)\nنص ثان."
    chunks = chunk_legal_document(text)  # flag defaults False
    assert len(chunks) == 2
    assert chunks[0]["article_reference"].startswith("مادة")
    # The body text keeps logical order (يجوز-style words not reordered).
    assert "العقد شريعة المتعاقدين" in chunks[0]["chunk_text"]


def test_flag_true_reverses_visual_order_body_to_logical():
    # Visual-order body (as the ETA PDF stores it) with a glued marker on its
    # own line.  With the flag set, the body reads logically after chunking.
    visual = "مادة5\nالقاهرة والقوة المفاجئ الحادث تبعة المدين يتحمل"
    chunks = chunk_legal_document(visual, is_visual_order=True)
    assert len(chunks) >= 1
    body = chunks[0]["chunk_text"]
    # After reversal يتحمل precedes القاهرة (logical reading order).
    assert body.index("يتحمل") < body.index("القاهرة")


def test_flag_true_article_regex_matches_after_reversal():
    # A glued 'مادةN' marker on its own line survives reversal (single word)
    # and is detected as an article boundary in the visual-order path.
    visual = "مادة5\nالقاهرة والقوة المفاجئ الحادث"
    chunks = chunk_legal_document(visual, is_visual_order=True)
    refs = [c["article_reference"] for c in chunks if c["article_reference"]]
    assert any(r and "مادة5" in r for r in refs)


def test_flag_true_corrupts_already_logical_text_documented_behavior():
    # DOCUMENTED EXPECTATION: applying the visual→logical reversal to text that
    # is ALREADY logical corrupts it.  This is exactly why the flag exists and
    # defaults False — direction is a per-source property, never auto-applied.
    already_logical = "يجوز الاتفاق على أن يتحمل المدين تبعة الحادث"
    out = visual_to_logical_arabic(already_logical)
    assert out != already_logical  # corruption is expected here
    assert out.split()[0] == "الحادث"  # now starts with the wrong word
