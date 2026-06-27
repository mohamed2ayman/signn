"""Clause-extraction accuracy scorer (Phase 8.1).

PURE scoring logic — NO Anthropic / network calls. Unit-tested in
``test_scorer.py`` and consumed by ``run_accuracy.py`` + the gated live test.

v1 measures CLAUSE EXTRACTION on the anonymized General Conditions baseline:
  - clause count vs golden
  - boundary precision / recall / F1 on the section-number set
  - which articles were found / missed / spurious / duplicated
  - clause_type agreement among matched clauses
  - verbatim fidelity: predicted content is drawn from the SOURCE text
    (char-trigram containment) — i.e. the model did not paraphrase / hallucinate

The golden set is STRUCTURAL (section_number + title + clause_type per article);
it does NOT carry full verbatim content (see README.md). Verbatim fidelity is
therefore scored against the SOURCE fixture, not against golden content.

Why this is model-agnostic: it scores a list of predicted clause dicts against
the golden set. It never imports an agent or a model. The same scorer judges
Claude today and any open-source replacement later (Phase 8.4/8.5).
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import asdict, dataclass, field
from typing import Any

# Arabic harakat (diacritics) + tatweel/kashida — stripped before comparison so
# vowelled vs unvowelled and stretched text compare equal.
_DIACRITICS = re.compile(r"[ؗ-ًؚ-ْٰـ]")
_AR_DIGITS = {ord(a): ord(b) for a, b in zip("٠١٢٣٤٥٦٧٨٩", "0123456789")}

# clause_type values the extractor prompt is allowed to emit.
ALLOWED_CLAUSE_TYPES = {
    "general", "payment", "liability", "termination", "indemnification",
    "force_majeure", "dispute_resolution", "confidentiality", "compliance",
    "insurance", "warranty", "intellectual_property", "scope_of_work",
    "variations", "defects", "time", "other",
}


def normalize_ar(text: str) -> str:
    """NFKC + strip Arabic diacritics/tatweel + collapse whitespace + lowercase."""
    if not text:
        return ""
    t = unicodedata.normalize("NFKC", text)
    t = _DIACRITICS.sub("", t)
    t = re.sub(r"\s+", " ", t).strip().lower()
    return t


def parse_section_number(value: Any) -> str | None:
    """Return a canonical article-number key (first integer as a string).

    Handles "1", "12", "مادة (12)", "12.3" -> "12", Arabic-Indic digits ("١٢"),
    etc. Returns None when no digit is present.
    """
    if value is None:
        return None
    s = str(value).translate(_AR_DIGITS)
    m = re.search(r"\d+", s)
    return m.group(0) if m else None


def _trigrams(text: str) -> set[str]:
    s = normalize_ar(text).replace(" ", "")
    return {s[i:i + 3] for i in range(len(s) - 2)} if len(s) >= 3 else set()


def fidelity_ratio(predicted_content: str, source_text: str) -> float:
    """Fraction of the predicted content's char-trigrams present in the source.

    ~1.0 => the content was taken verbatim from the source (faithful).
    Low  => paraphrase / hallucination / heavy reformatting.

    Convenience wrapper (recomputes source trigrams). ``score_clause_extraction``
    precomputes the source trigram set once for speed.
    """
    return _fidelity(predicted_content, _trigrams(source_text))


def _fidelity(predicted_content: str, source_trigrams: set[str]) -> float:
    pred = _trigrams(predicted_content)
    if not pred:
        return 1.0  # empty/very short content has nothing to contradict
    return len(pred & source_trigrams) / len(pred)


@dataclass
class ClauseScore:
    section_number: str
    type_match: bool
    fidelity: float


@dataclass
class AccuracyReport:
    golden_count: int
    predicted_count: int
    matched: int
    duplicates: int              # predicted repeats of an already-matched article (e.g. TOC stubs)
    missing: list[str]           # golden section numbers not predicted
    spurious: list[str]          # predicted section numbers not in golden
    boundary_precision: float
    boundary_recall: float
    boundary_f1: float
    type_accuracy: float         # among matched clauses
    mean_fidelity: float         # among matched clauses
    low_fidelity: list[str]      # matched section numbers below fidelity_threshold
    per_clause: list[ClauseScore] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def score_clause_extraction(
    predicted: list[dict[str, Any]],
    golden: list[dict[str, Any]],
    source_text: str,
    *,
    fidelity_threshold: float = 0.80,
) -> AccuracyReport:
    """Score a predicted clause list against the golden structure + source text."""
    golden_by_num: dict[str, dict] = {}
    for g in golden:
        num = parse_section_number(g.get("section_number"))
        if num is not None:
            golden_by_num[num] = g

    pred_by_num: dict[str, dict] = {}
    spurious: list[str] = []
    duplicates = 0
    for p in predicted:
        num = parse_section_number(p.get("section_number")) or parse_section_number(p.get("title"))
        if num is None:
            spurious.append("?")
            continue
        if num in golden_by_num:
            if num in pred_by_num:
                duplicates += 1            # TOC stub / sub-article split for an already-seen article
            else:
                pred_by_num[num] = p
        else:
            spurious.append(num)

    matched_nums = sorted(set(pred_by_num) & set(golden_by_num), key=lambda x: int(x))
    missing = sorted(set(golden_by_num) - set(pred_by_num), key=lambda x: int(x))

    src_tri = _trigrams(source_text)
    per_clause: list[ClauseScore] = []
    type_hits = 0
    fidelities: list[float] = []
    low_fid: list[str] = []
    for num in matched_nums:
        p, g = pred_by_num[num], golden_by_num[num]
        tmatch = (str(p.get("clause_type", "")).strip().lower()
                  == str(g.get("clause_type", "")).strip().lower())
        fid = _fidelity(p.get("content", "") or "", src_tri)
        if tmatch:
            type_hits += 1
        fidelities.append(fid)
        if fid < fidelity_threshold:
            low_fid.append(num)
        per_clause.append(ClauseScore(num, tmatch, round(fid, 4)))

    pred_total = len(predicted)
    matched = len(matched_nums)
    precision = matched / pred_total if pred_total else 0.0
    recall = matched / len(golden_by_num) if golden_by_num else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0

    return AccuracyReport(
        golden_count=len(golden_by_num),
        predicted_count=pred_total,
        matched=matched,
        duplicates=duplicates,
        missing=missing,
        spurious=sorted(set(spurious)),
        boundary_precision=round(precision, 4),
        boundary_recall=round(recall, 4),
        boundary_f1=round(f1, 4),
        type_accuracy=round(type_hits / matched, 4) if matched else 0.0,
        mean_fidelity=round(sum(fidelities) / len(fidelities), 4) if fidelities else 0.0,
        low_fidelity=low_fid,
        per_clause=per_clause,
    )
