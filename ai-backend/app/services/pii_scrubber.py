"""Reversible structured-PII scrubbing for outbound model calls — Slice 1.

Detects STRUCTURED PII only — emails, EG/SA/UAE/QA phone numbers, EG/SA/AE/QA
national IDs, and IBANs — and replaces each occurrence with a consistent
placeholder token (``[EMAIL_1]``, ``[PHONE_1]``, ``[ID_EG_1]``, ``[ID_SA_1]``,
``[ID_AE_1]``, ``[ID_QA_1]``, ``[IBAN_1]``) so the text can be sent to an
external model provider without the real values. The mapping is kept in-process
by a :class:`PiiScrubber` instance and used to RESTORE the real values into the
model's response. Name/address NER is explicitly out of scope (deferred slice).

Arabic-contract critical detail: Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) and their
Extended/Persian variants (۰۱۲۳۴۵۶۷۸۹) are normalized to ASCII digits BEFORE
detection via a 1:1 single-codepoint ``str.translate`` — the normalized copy has
exactly the same length as the original, so every match span maps directly back
to the ORIGINAL string offsets. The scrubbed-out value (and the value restored
later) is always the ORIGINAL span text, Arabic digits included.

SECURITY RULES (hard, do not relax):
  * The token→value mapping lives ONLY inside a ``PiiScrubber`` instance for the
    duration of one model call. It is NEVER logged, NEVER persisted, and NEVER
    placed in exception messages or telemetry.
  * Logging is COUNTS-BY-TYPE only (e.g. ``2 EMAIL, 1 ID_EG``) — never values.
  * ``validate_restored`` reports placeholder NAMES only.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass

# ─────────────────────────────────────────────────────────────────────────────
# Digit normalization (length-preserving — spans map 1:1 to original offsets)
# ─────────────────────────────────────────────────────────────────────────────

_DIGIT_TRANSLATION: dict[int, int] = {}
for _i in range(10):
    _DIGIT_TRANSLATION[0x0660 + _i] = ord("0") + _i  # Arabic-Indic ٠-٩
    _DIGIT_TRANSLATION[0x06F0 + _i] = ord("0") + _i  # Extended Arabic-Indic (Persian) ۰-۹


def _normalize_digits(text: str) -> str:
    """Map Arabic-Indic / Persian digits to ASCII. 1 codepoint → 1 codepoint,
    so ``len(result) == len(text)`` and all regex offsets are valid on both."""
    return text.translate(_DIGIT_TRANSLATION)


# ─────────────────────────────────────────────────────────────────────────────
# Validators
# ─────────────────────────────────────────────────────────────────────────────

def _luhn_valid(digits: str) -> bool:
    """Standard Luhn mod-10 over an all-digit string (rightmost = check digit)."""
    total = 0
    for i, ch in enumerate(reversed(digits)):
        n = int(ch)
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


def _valid_eg_national_id(d: str) -> bool:
    """Egyptian national ID — STRUCTURAL validation only.

    Layout: C YYMMDD GG SSSS X (14 digits). We validate the century digit
    (2 → 19xx, 3 → 20xx), a plausible YYMMDD birth date (month 01-12, day
    01-31 — no full calendar math), and the governorate code (01-35, or 88
    for born-abroad). HONESTY NOTE: the 14th (check) digit's algorithm has no
    official public specification we could verify, so no checksum is
    implemented — structure only. This still rejects the common false
    positives (invoice/contract numbers with impossible dates/governorates).
    """
    if len(d) != 14 or d[0] not in "23":
        return False
    mm = int(d[3:5])
    dd = int(d[5:7])
    if not (1 <= mm <= 12 and 1 <= dd <= 31):
        return False
    gov = int(d[7:9])
    return (1 <= gov <= 35) or gov == 88


def _valid_sa_id(d: str) -> bool:
    """Saudi national ID / Iqama: 10 digits starting 1 (citizen) or 2 (resident),
    Luhn mod-10 checksum (the real algorithm used by Absher validators)."""
    return len(d) == 10 and d[0] in "12" and _luhn_valid(d)


def _valid_ae_id(d: str) -> bool:
    """UAE Emirates ID: 15 digits, fixed 784 prefix (ISO 3166-1 numeric for the
    UAE), Luhn mod-10 over all 15 digits (the real EIDA checksum)."""
    return len(d) == 15 and d.startswith("784") and _luhn_valid(d)


def _valid_qa_id(d: str) -> bool:
    """Qatar QID — STRUCTURAL validation: 11 digits starting 2 or 3 (century
    marker). No public checksum specification exists; structure only."""
    return len(d) == 11 and d[0] in "23"


def _iban_mod97_valid(compact: str) -> bool:
    """ISO 13616 MOD-97: move the first 4 chars to the end, map A→10…Z→35,
    and the resulting integer must be ≡ 1 (mod 97). Real checksum, fully
    implemented — this is the primary false-positive gate for IBANs."""
    rearranged = compact[4:] + compact[:4]
    try:
        num = "".join(str(int(c, 36)) for c in rearranged)
    except ValueError:
        return False
    return int(num) % 97 == 1


# ─────────────────────────────────────────────────────────────────────────────
# Detectors — each yields (start, end, label, key) spans on the NORMALIZED text
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class _Span:
    start: int
    end: int
    label: str
    key: str          # identity key: same value → same placeholder token
    original: str = ""  # filled from the ORIGINAL (pre-normalization) text


_EMAIL_RE = re.compile(
    r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}"
)

# In-number separators commonly seen in contracts: space, NBSP, dot, dash.
_SEP = r"[  .\-]"


def _digits(n: int) -> str:
    """``n`` digits, each optionally preceded by one separator character."""
    return rf"(?:{_SEP}?\d){{{n}}}"


# Phone alternatives. One combined PHONE label — country only matters for
# detection coverage, not for the placeholder type.
#   EG: mobile 01[0125] + 8 digits; intl +20 / 0020 (leading 0 dropped,
#       optional "(0)").
#   SA: mobile 05 + 8 digits; intl +966 5 + 8 digits.
#   AE: intl +971 5 + 8 digits (local 05x shares the SA local alternative —
#       identical 10-digit shape, and both scrub to [PHONE_n] anyway).
#   QA: prefix REQUIRED (+974 / 00974) + 8 digits led by 3/5/6/7 — a bare
#       8-digit run is far too false-positive-prone in contracts full of
#       amounts, so unprefixed Qatari numbers are deliberately not matched.
_PHONE_ALTS = [
    rf"(?:\+|00)20\)?{_SEP}?(?:\(0\){_SEP}?)?1[0125]{_digits(8)}",
    rf"01[0125]{_digits(8)}",
    rf"(?:\+|00)966\)?{_SEP}?\(?5\)?{_digits(8)}",
    rf"(?:\+|00)971\)?{_SEP}?\(?5\)?{_digits(8)}",
    rf"05{_digits(8)}",
    rf"(?:\+|00)974\)?{_SEP}?[3567]{_digits(7)}",
]
_PHONE_RE = re.compile(rf"(?<![\d+])\(?(?:{'|'.join(_PHONE_ALTS)})(?!\d)")

# National IDs. (?<!\d)/(?!\d) guards keep matches out of longer digit runs
# (IBAN bodies, invoice numbers, amounts).
_EG_ID_RE = re.compile(r"(?<!\d)[23]\d{13}(?!\d)")          # contiguous 14
_SA_ID_RE = re.compile(r"(?<!\d)[12]\d{9}(?!\d)")           # contiguous 10
_AE_ID_RE = re.compile(r"(?<!\d)784[ -]?\d{4}[ -]?\d{7}[ -]?\d(?!\d)")
_QA_ID_RE = re.compile(r"(?<!\d)[23]\d{10}(?!\d)")          # contiguous 11

# IBAN candidates: 2 uppercase letters + 2 check digits + spaced/plain alnum
# body. Candidates are trimmed to the known per-country length, then MOD-97
# gated. Uppercase print-form only (the standard way IBANs appear in
# contracts); lowercase IBANs are not matched.
_IBAN_CAND_RE = re.compile(r"(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,32}")
_IBAN_LENGTHS = {
    "EG": 29,
    "SA": 24,
    "AE": 23,
    "QA": 29,
    # Other GCC/MENA neighbours seen in regional contracts:
    "KW": 30, "BH": 22, "OM": 23, "JO": 30, "LB": 28,
}
_IBAN_GENERIC_MIN, _IBAN_GENERIC_MAX = 15, 34


def _compact_key(s: str) -> str:
    """Identity key for digit-based values: strip separators/formatting."""
    return re.sub(r"[^0-9A-Za-z+]", "", s)


def _find_simple(norm: str, regex: re.Pattern, label: str,
                 validator=None) -> list[_Span]:
    spans: list[_Span] = []
    for m in regex.finditer(norm):
        value = m.group()
        if validator is not None and not validator(_compact_key(value).lstrip("+")):
            continue
        key = value if label == "EMAIL" else _compact_key(value)
        spans.append(_Span(m.start(), m.end(), label, key))
    return spans


def _find_ibans(norm: str) -> list[_Span]:
    spans: list[_Span] = []
    for m in _IBAN_CAND_RE.finditer(norm):
        cand = m.group()
        country = cand[:2]
        # Positions of the alnum (non-space) chars inside the candidate.
        alnum_pos = [i for i, ch in enumerate(cand) if ch != " "]
        compact = "".join(cand[i] for i in alnum_pos)
        required = _IBAN_LENGTHS.get(country)
        if required is not None:
            if len(compact) < required:
                continue
            head = compact[:required]
            if not _iban_mod97_valid(head):
                continue
            end = m.start() + alnum_pos[required - 1] + 1
            spans.append(_Span(m.start(), end, "IBAN", head))
        else:
            if not (_IBAN_GENERIC_MIN <= len(compact) <= _IBAN_GENERIC_MAX):
                continue
            if not _iban_mod97_valid(compact):
                continue
            spans.append(_Span(m.start(), m.end(), "IBAN", compact))
    return spans


# Overlap tie-break priority (applied AFTER longest-match-wins): more specific
# / higher-stakes types first.
_PRIORITY = {"IBAN": 0, "ID_EG": 1, "ID_AE": 2, "ID_QA": 3, "ID_SA": 4,
             "PHONE": 5, "EMAIL": 6}

_ALL_LABELS = tuple(_PRIORITY)
_PLACEHOLDER_RE = re.compile(
    rf"\[(?:{'|'.join(_ALL_LABELS)})_\d+\]"
)


def _detect(text: str) -> list[_Span]:
    """All PII spans in *text*, overlap-resolved (longest match wins; ties by
    type priority), sorted by start, with ``original`` filled from *text*."""
    norm = _normalize_digits(text)
    cands: list[_Span] = []
    cands += _find_simple(norm, _EMAIL_RE, "EMAIL")
    cands += _find_simple(norm, _PHONE_RE, "PHONE")
    cands += _find_simple(norm, _EG_ID_RE, "ID_EG", _valid_eg_national_id)
    cands += _find_simple(norm, _SA_ID_RE, "ID_SA", _valid_sa_id)
    cands += _find_simple(norm, _AE_ID_RE, "ID_AE", _valid_ae_id)
    cands += _find_simple(norm, _QA_ID_RE, "ID_QA", _valid_qa_id)
    cands += _find_ibans(norm)

    # Longest-match-wins (an IBAN containing phone/ID-shaped digit runs must
    # not be double-scrubbed), ties broken by type priority, then position.
    cands.sort(key=lambda s: (-(s.end - s.start), _PRIORITY[s.label], s.start))
    chosen: list[_Span] = []
    for c in cands:
        if all(c.end <= k.start or c.start >= k.end for k in chosen):
            chosen.append(c)
    chosen.sort(key=lambda s: s.start)
    for c in chosen:
        c.original = text[c.start:c.end]
    return chosen


# ─────────────────────────────────────────────────────────────────────────────
# The scrub/restore session object
# ─────────────────────────────────────────────────────────────────────────────

class PiiScrubber:
    """One scrub/restore session — spans exactly one model call.

    Token numbering and value identity are consistent ACROSS every ``scrub()``
    call on the same instance (system prompt + all message turns), so the same
    email appearing twice — even once in ASCII and once in Arabic-Indic digits
    for numeric types — maps to the same placeholder.

    The mapping is an in-process attribute of this object and dies with it.
    NEVER log, persist, or serialize ``mapping`` — see the module docstring.
    """

    def __init__(self) -> None:
        self._token_by_key: dict[tuple[str, str], str] = {}
        self._value_by_token: dict[str, str] = {}
        self._counts: Counter[str] = Counter()

    # -- introspection (safe) --------------------------------------------
    @property
    def has_pii(self) -> bool:
        return bool(self._value_by_token)

    @property
    def mapping(self) -> dict[str, str]:
        """Token → original value. LOCAL USE ONLY — never log or persist."""
        return dict(self._value_by_token)

    def counts_summary(self) -> str:
        """Log-safe summary: counts by type only, e.g. ``2 EMAIL, 1 ID_EG``."""
        return ", ".join(
            f"{n} {label}" for label, n in sorted(self._counts.items())
        )

    def __repr__(self) -> str:  # never leak values via repr in tracebacks
        return f"<PiiScrubber {self.counts_summary() or 'clean'}>"

    # -- scrub ------------------------------------------------------------
    def scrub(self, text: str) -> str:
        spans = _detect(text)
        if not spans:
            return text
        out: list[str] = []
        last = 0
        for sp in spans:
            out.append(text[last:sp.start])
            out.append(self._token_for(sp))
            last = sp.end
        out.append(text[last:])
        return "".join(out)

    def _token_for(self, sp: _Span) -> str:
        key = (sp.label, sp.key)
        token = self._token_by_key.get(key)
        if token is None:
            self._counts[sp.label] += 1
            token = f"[{sp.label}_{self._counts[sp.label]}]"
            self._token_by_key[key] = token
            # First-seen original formatting is what restore puts back.
            self._value_by_token[token] = sp.original
        return token

    def scrub_system(self, system):
        """Scrub a system prompt: plain str, or (defensively) a block list."""
        if isinstance(system, str):
            return self.scrub(system)
        if isinstance(system, list):
            return [self._scrub_block(b) for b in system]
        return system

    def scrub_messages(self, messages):
        """Scrub the text content of message turns. Roles and structure are
        untouched; only str content (or ``text`` fields of dict blocks — the
        defensive multi-block case; no agent sends blocks today) is scrubbed.
        Returns NEW list/dicts — the caller's objects are never mutated."""
        if not isinstance(messages, list):
            return messages
        out = []
        for msg in messages:
            if isinstance(msg, dict) and isinstance(msg.get("content"), str):
                out.append({**msg, "content": self.scrub(msg["content"])})
            elif isinstance(msg, dict) and isinstance(msg.get("content"), list):
                out.append({
                    **msg,
                    "content": [self._scrub_block(b) for b in msg["content"]],
                })
            else:
                out.append(msg)
        return out

    def _scrub_block(self, block):
        if isinstance(block, dict) and isinstance(block.get("text"), str):
            return {**block, "text": self.scrub(block["text"])}
        return block

    # -- restore ----------------------------------------------------------
    def restore(self, text: str) -> str:
        """Put the real values back in place of this session's placeholders.
        Token names are unambiguous (``[PHONE_1]`` is never a substring of
        ``[PHONE_12]`` thanks to the closing bracket), so plain replace is safe."""
        for token, value in self._value_by_token.items():
            text = text.replace(token, value)
        return text

    def validate_restored(self, text: str) -> list[str]:
        """Placeholder-shaped tokens still present after restore — the
        leak/restore-failure signal. Includes model-invented tokens this
        session never issued (also worth a warning). NAMES only — safe to log."""
        return sorted(set(_PLACEHOLDER_RE.findall(text)))


# ─────────────────────────────────────────────────────────────────────────────
# Module-level one-shot conveniences
# ─────────────────────────────────────────────────────────────────────────────

def scrub_text(text: str) -> tuple[str, dict[str, str]]:
    """One-shot scrub. Returns ``(scrubbed_text, mapping)`` — the mapping is
    the caller's responsibility to keep local and unlogged."""
    scrubber = PiiScrubber()
    scrubbed = scrubber.scrub(text)
    return scrubbed, scrubber.mapping


def restore_text(text: str, mapping: dict[str, str]) -> str:
    for token, value in mapping.items():
        text = text.replace(token, value)
    return text


def validate_restored(text: str, mapping: dict[str, str] | None = None) -> list[str]:
    """Placeholders still present in *text* (names only). *mapping* is accepted
    for signature symmetry; ALL placeholder-shaped survivors are reported,
    whether or not this session issued them."""
    del mapping  # all survivors are reported regardless
    return sorted(set(_PLACEHOLDER_RE.findall(text)))
