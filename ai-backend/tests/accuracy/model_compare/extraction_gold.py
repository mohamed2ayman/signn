"""Gold-set-backed extraction scorer (Step 5 Phase 0) — eval-only, NO model calls, NO billing.

Sources extraction ground truth from the **Phase 8.3 gold set** (`docs/phase-8.3-gold/`, loaded via
``model_compare.gold_loader`` — the real Arabic/English contract text is **NEVER committed**; pass
``GOLD_DIR``). Scores ANY model's extraction output against that gold, **sliced by LANGUAGE**
(Arabic vs English scored SEPARATELY — Arabic is the Phase-8.1 decision metric), reported per
document, per contract, per language, and overall.

Reuse + deliberate deviations from ``tests.accuracy.scorer`` (documented so the difference is not a
surprise — the single English fixture's leading-integer scorer cannot handle this richer gold):

* REUSED verbatim: the **verbatim-fidelity** logic (``fidelity_ratio`` / char-trigram containment,
  ``normalize_ar``) and the **P/R/F1** formula. Fidelity here is predicted content vs the matched
  GOLD clause's text (did the model reproduce the human-verified clause), not vs a source fixture.
* DEVIATION 1 — **score per DOCUMENT**, not per contract: multi-document contracts (e.g. Muhlbauer,
  Project_2Depot) restart section numbering per document, so a per-contract number set collides.
* DEVIATION 2 — match on the **normalized FULL section_number** (``section_key``), not the leading
  integer: combined GC+PC documents legitimately hold both ``"5"`` and ``"بند 5"`` (lesson #199);
  leading-int matching (`scorer.parse_section_number`) would wrongly merge them.
* DEVIATION 3 — boundary **precision/recall are defined over NUMBERED clauses only**; clauses with
  no section number (e.g. Project9 is mostly unnumbered) are reported as *coverage*
  (``gold_unnumbered`` / ``pred_unnumbered``), never folded into P/R as false positives. This makes
  self-consistency exactly 1.0 and matches how boundary detection is actually defined.

Nothing here imports an agent or calls a model — it scores a list of predicted clause dicts, exactly
like ``scorer.py``. The model adapter that PRODUCES those predictions is ``extraction_runner.py``.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import asdict, dataclass, field
from typing import Any, Callable

# Reuse the fidelity primitives from the existing scorer (the verbatim logic is identical).
from tests.accuracy.scorer import fidelity_ratio

# Arabic letter blocks (main + supplement + extended-A) for language classification.
_AR_LETTERS = re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿ]")
_LATIN_LETTERS = re.compile(r"[A-Za-z]")
# Arabic-Indic (٠-٩) + Extended/Persian (۰-۹) digits → ASCII, for section-key normalization.
_DIGIT_MAP = {**{ord(a): ord(b) for a, b in zip("٠١٢٣٤٥٦٧٨٩", "0123456789")},
              **{ord(a): ord(b) for a, b in zip("۰۱۲۳۴۵۶۷۸۹", "0123456789")}}


def classify_language(text: str) -> str:
    """'ar' | 'en' by MAJORITY script (Arabic letters ≥ Latin letters, and ≥1 Arabic char)."""
    t = text or ""
    ar = len(_AR_LETTERS.findall(t))
    lat = len(_LATIN_LETTERS.findall(t))
    return "ar" if ar > 0 and ar >= lat else "en"


def section_key(value: Any) -> str | None:
    """Normalized FULL section-number key, or None if it carries no digit.

    NFKC → Arabic/Persian digits to ASCII → strip whitespace + brackets → lowercase. Keeps any
    ``بند`` / ``مادة`` prefix so combined-conditions parts stay DISTINCT ("5" vs "بند 5"). Examples:
    ``"بند (5)"`` → ``"بند5"``, ``"مادة ١٢"`` → ``"مادة12"``, ``"14.3"`` → ``"14.3"``,
    ``"GC-7.2"`` → ``"gc-7.2"``, ``"Definitions"`` → None.
    """
    if value is None:
        return None
    s = unicodedata.normalize("NFKC", str(value)).translate(_DIGIT_MAP)
    s = re.sub(r"[\s()\[\]]", "", s).strip().lower()
    return s if re.search(r"\d", s) else None


def contract_language(clauses: list[dict[str, Any]]) -> str:
    """Majority language of a clause group, over the joined gold ``text``."""
    return classify_language(" ".join((c.get("text") or "") for c in clauses))


def predicted_from_gold(clauses: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Reshape gold clauses into the extractor's PREDICTED schema (``content`` ← gold ``text``).

    The scorer/extractor use ``content``; the gold set stores clause text under ``text``. Used for
    the FREE self-consistency check (feed the gold back in as if a model produced it → ~perfect).
    """
    return [
        {
            "section_number": c.get("section_number"),
            "title": c.get("title"),
            "content": c.get("text", "") or "",
            "clause_type": c.get("clause_type"),
        }
        for c in clauses
    ]


@dataclass
class GroupReport:
    """Score for ONE (contract, document) group."""
    contract: str
    document: str
    language: str
    gold_total: int              # all gold clauses in the group
    gold_numbered: int           # gold clauses with a usable section_number (the P/R denominator)
    predicted_total: int
    predicted_numbered: int
    matched: int
    duplicates: int              # predicted repeats of an already-matched key
    missing: list[str]           # numbered gold keys not predicted
    spurious: list[str]          # numbered predicted keys not in gold
    gold_unnumbered: int         # coverage only — NOT counted in P/R
    pred_unnumbered: int         # coverage only — NOT counted in P/R
    boundary_precision: float
    boundary_recall: float
    boundary_f1: float
    type_accuracy: float         # among matched
    mean_fidelity: float         # among matched — predicted content vs matched gold text
    low_fidelity: list[str]      # matched keys below fidelity_threshold

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def score_group(
    predicted: list[dict[str, Any]],
    gold_clauses: list[dict[str, Any]],
    *,
    contract: str = "",
    document: str = "",
    fidelity_threshold: float = 0.80,
) -> GroupReport:
    """Score one document's predicted clauses against its gold clauses (full-key, numbered-only P/R)."""
    language = contract_language(gold_clauses)

    gold_by_key: dict[str, dict] = {}
    gold_unnumbered = 0
    for g in gold_clauses:
        k = section_key(g.get("section_number"))
        if k is None:
            gold_unnumbered += 1
            continue
        gold_by_key.setdefault(k, g)  # first wins on a true duplicate key

    pred_by_key: dict[str, dict] = {}
    spurious: list[str] = []
    duplicates = 0
    pred_unnumbered = 0
    predicted_numbered = 0
    for p in predicted:
        k = section_key(p.get("section_number")) or section_key(p.get("title"))
        if k is None:
            pred_unnumbered += 1
            continue
        predicted_numbered += 1
        if k in gold_by_key:
            if k in pred_by_key:
                duplicates += 1
            else:
                pred_by_key[k] = p
        else:
            spurious.append(k)

    matched_keys = set(pred_by_key) & set(gold_by_key)
    missing = sorted(set(gold_by_key) - set(pred_by_key))

    type_hits = 0
    fids: list[float] = []
    low_fid: list[str] = []
    for k in sorted(matched_keys):
        p, g = pred_by_key[k], gold_by_key[k]
        fid = fidelity_ratio(p.get("content", "") or "", g.get("text", "") or "")
        if (str(p.get("clause_type", "")).strip().lower()
                == str(g.get("clause_type", "")).strip().lower()):
            type_hits += 1
        fids.append(fid)
        if fid < fidelity_threshold:
            low_fid.append(k)

    matched = len(matched_keys)
    # DEVIATION 3: precision denominator is NUMBERED predictions, not the total.
    precision = matched / predicted_numbered if predicted_numbered else 0.0
    recall = matched / len(gold_by_key) if gold_by_key else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0

    return GroupReport(
        contract=contract,
        document=document,
        language=language,
        gold_total=len(gold_clauses),
        gold_numbered=len(gold_by_key),
        predicted_total=len(predicted),
        predicted_numbered=predicted_numbered,
        matched=matched,
        duplicates=duplicates,
        missing=missing,
        spurious=sorted(set(spurious)),
        gold_unnumbered=gold_unnumbered,
        pred_unnumbered=pred_unnumbered,
        boundary_precision=round(precision, 4),
        boundary_recall=round(recall, 4),
        boundary_f1=round(f1, 4),
        type_accuracy=round(type_hits / matched, 4) if matched else 0.0,
        mean_fidelity=round(sum(fids) / len(fids), 4) if fids else 0.0,
        low_fidelity=low_fid,
    )


@dataclass
class LanguageAggregate:
    language: str
    n_documents: int
    n_contracts: int
    gold_numbered: int
    matched: int
    predicted_numbered: int
    micro_precision: float       # pooled matched / pooled predicted_numbered
    micro_recall: float          # pooled matched / pooled gold_numbered
    micro_f1: float
    macro_f1: float              # mean of per-group boundary_f1
    mean_fidelity: float         # mean of per-group mean_fidelity (matched clauses)
    type_accuracy: float         # mean of per-group type_accuracy
    gold_unnumbered: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _aggregate(groups: list[GroupReport], language: str | None) -> LanguageAggregate:
    sel = [g for g in groups if language is None or g.language == language]
    gold_numbered = sum(g.gold_numbered for g in sel)
    matched = sum(g.matched for g in sel)
    pred_numbered = sum(g.predicted_numbered for g in sel)
    micro_p = matched / pred_numbered if pred_numbered else 0.0
    micro_r = matched / gold_numbered if gold_numbered else 0.0
    micro_f1 = (2 * micro_p * micro_r / (micro_p + micro_r)) if (micro_p + micro_r) else 0.0
    scored = [g for g in sel if g.gold_numbered]  # only groups with numbered gold have an F1
    macro_f1 = sum(g.boundary_f1 for g in scored) / len(scored) if scored else 0.0
    mean_fid = sum(g.mean_fidelity for g in scored) / len(scored) if scored else 0.0
    type_acc = sum(g.type_accuracy for g in scored) / len(scored) if scored else 0.0
    return LanguageAggregate(
        language=language or "overall",
        n_documents=len(sel),
        n_contracts=len({g.contract for g in sel}),
        gold_numbered=gold_numbered,
        matched=matched,
        predicted_numbered=pred_numbered,
        micro_precision=round(micro_p, 4),
        micro_recall=round(micro_r, 4),
        micro_f1=round(micro_f1, 4),
        macro_f1=round(macro_f1, 4),
        mean_fidelity=round(mean_fid, 4),
        type_accuracy=round(type_acc, 4),
        gold_unnumbered=sum(g.gold_unnumbered for g in sel),
    )


@dataclass
class ExtractionGoldReport:
    per_group: list[GroupReport]
    per_language: dict[str, LanguageAggregate]   # {"ar": ..., "en": ...}
    overall: LanguageAggregate

    def to_dict(self) -> dict[str, Any]:
        return {
            "per_group": [g.to_dict() for g in self.per_group],
            "per_language": {k: v.to_dict() for k, v in self.per_language.items()},
            "overall": self.overall.to_dict(),
        }


def group_by_document(gold_clauses: list[dict[str, Any]]) -> dict[tuple[str, str], list[dict]]:
    """Group gold clauses by (contract, document) — the natural extraction unit."""
    out: dict[tuple[str, str], list[dict]] = {}
    for c in gold_clauses:
        key = (c.get("contract") or "", c.get("document") or c.get("document_label") or "")
        out.setdefault(key, []).append(c)
    return out


def score_gold_extraction(
    gold_clauses: list[dict[str, Any]],
    predict: Callable[[str, list[dict[str, Any]]], list[dict[str, Any]]],
) -> ExtractionGoldReport:
    """Score a model against the whole gold set, per (contract, document) + per language.

    ``predict(document_label, gold_group)`` returns the model's predicted clause list for one
    document. For the FREE self-consistency check pass ``predict=lambda _lbl, g: predicted_from_gold(g)``.
    A real model ignores ``gold_group`` and extracts from the document's source text (see
    ``run_extraction_bakeoff.py``); the gold group is passed so the self-consistency echo has it.
    """
    groups: list[GroupReport] = []
    for (contract, document), gold_group in group_by_document(gold_clauses).items():
        predicted = predict(document, gold_group)
        groups.append(score_group(predicted, gold_group, contract=contract, document=document))

    per_language = {
        lang: _aggregate(groups, lang)
        for lang in ("ar", "en")
        if any(g.language == lang for g in groups)
    }
    return ExtractionGoldReport(
        per_group=groups,
        per_language=per_language,
        overall=_aggregate(groups, None),
    )


def self_consistency(gold_clauses: list[dict[str, Any]]) -> ExtractionGoldReport:
    """FREE proof-of-scorer: feed the gold back in as its own predictions (no model, no billing)."""
    return score_gold_extraction(gold_clauses, lambda _label, group: predicted_from_gold(group))
