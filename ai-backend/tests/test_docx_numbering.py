"""Unit tests for Word list-numbering reconstruction (Issue 1 — Defects A + C).

python-docx's ``paragraph.text`` drops ``numPr`` list markers (auto-numbers and
bullet glyphs live in numbering.xml, not the run text). ``_DocxListNumbering``
rebuilds them so numbered clauses regain their number (→ section_number, Defect
C) and bulleted lists regain their structure (→ no flattening, Defect A).

No .docx file or network needed — the numbering + paragraph XML is hand-built
with python-docx's own parser.
"""

from __future__ import annotations

from docx.oxml import parse_xml

from app.services.tesseract_text_extractor import (
    _DocxListNumbering,
    _paragraph_numpr,
)

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _numbering_doc():
    """A fake ``doc`` exposing ``.part.numbering_part.element`` = a <w:numbering>
    with two lists: numId 1 = decimal ("%1-", nested "%1.%2"), numId 2 = bullet.
    """
    el = parse_xml(
        f'<w:numbering xmlns:w="{W}">'
        '<w:abstractNum w:abstractNumId="0">'
        '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1-"/></w:lvl>'
        '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2"/></w:lvl>'
        "</w:abstractNum>"
        '<w:abstractNum w:abstractNumId="1">'
        '<w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl>'
        "</w:abstractNum>"
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
        '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>'
        "</w:numbering>"
    )

    class _NumPart:
        element = el

    class _Part:
        numbering_part = _NumPart()

    class _Doc:
        part = _Part()

    return _Doc()


def _para(xml: str):
    class _P:
        _p = parse_xml(xml)

    return _P()


# ── _DocxListNumbering ───────────────────────────────────────────────────────

def test_numbering_available():
    assert _DocxListNumbering(_numbering_doc()).available is True


def test_numbered_list_running_counter_and_style():
    """Level-0 uses lvlText "%1-" and advances a running counter."""
    num = _DocxListNumbering(_numbering_doc())
    assert num.label("1", 0) == "1- "
    assert num.label("1", 0) == "2- "
    assert num.label("1", 0) == "3- "


def test_nested_numbered_levels_reset_under_parent():
    """Nested level ("%1.%2") composes the parent counter and RESTARTS when the
    parent advances (Word's list behaviour)."""
    num = _DocxListNumbering(_numbering_doc())
    assert num.label("1", 0) == "1- "
    assert num.label("1", 1) == "1.1 "
    assert num.label("1", 1) == "1.2 "
    assert num.label("1", 0) == "2- "   # parent advances …
    assert num.label("1", 1) == "2.1 "  # … deeper level restarts at 1


def test_bullet_list_renders_bullet_glyph():
    num = _DocxListNumbering(_numbering_doc())
    assert num.label("2", 0) == "• "
    assert num.label("2", 0) == "• "   # bullets carry no incrementing number


def test_unknown_numid_returns_none():
    num = _DocxListNumbering(_numbering_doc())
    assert num.label("99", 0) is None


def test_no_numbering_part_is_safe():
    """A document with no numbering part must not crash — just no labels."""

    class _Doc:
        part = object()  # no .numbering_part

    num = _DocxListNumbering(_Doc())
    assert num.available is False
    assert num.label("1", 0) is None


# ── _paragraph_numpr ─────────────────────────────────────────────────────────

def test_paragraph_numpr_reads_numid_and_ilvl():
    p = _para(
        f'<w:p xmlns:w="{W}"><w:pPr><w:numPr>'
        '<w:ilvl w:val="1"/><w:numId w:val="3"/>'
        "</w:numPr></w:pPr><w:r><w:t>text</w:t></w:r></w:p>"
    )
    assert _paragraph_numpr(p) == ("3", 1)


def test_paragraph_numpr_defaults_ilvl_zero():
    p = _para(
        f'<w:p xmlns:w="{W}"><w:pPr><w:numPr>'
        '<w:numId w:val="1"/>'
        "</w:numPr></w:pPr></w:p>"
    )
    assert _paragraph_numpr(p) == ("1", 0)


def test_paragraph_numpr_none_for_plain_paragraph():
    p = _para(f'<w:p xmlns:w="{W}"><w:r><w:t>plain</w:t></w:r></w:p>')
    assert _paragraph_numpr(p) is None
