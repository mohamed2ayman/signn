"""Pure scorer for risk output vs the HUMAN-VERIFIED gold (lesson #244).

Aligns a model's risks to gold clauses by `clause_id` (the risk agent echoes it),
scoring ONLY clauses the model was actually shown, and measures the fair signals:
  - verified_high_recall : of the shown clauses carrying a human-verified HIGH
    gold risk, how many does the model flag HIGH-or-above? (does Haiku MISS what
    a HUMAN confirmed is High — the decisive quality question)
  - verified_recall      : of ALL shown verified gold clauses, how many the model
    flagged at all (surfaces under-flagging that HIGH-only recall would hide)
  - severity_agreement   : over every shown verified gold clause, model max-
    severity vs gold — a MISS counts as a non-match (a model that under-flags
    scores LOWER, it cannot inflate by shrinking the denominator)
  - category_agreement   : same denominator; both sides fold through ONE coarse
    map (risk vocab ≠ the 17 gold labels — still APPROXIMATE, a soft signal)
  - arabic_same_language_rate : fraction of model risks on ARABIC clauses whose
    `description` is actually Arabic (the prompt's same-language rule)

`head_to_head` compares two models' outputs on the SAME clauses — the non-circular
read (sidesteps the gold's Sonnet origin). No model calls here.
"""
from __future__ import annotations

from typing import Any


def _is_arabic(text: str) -> bool:
    return any("؀" <= ch <= "ۿ" for ch in (text or ""))


def norm_severity(s: Any) -> str:
    """Model emits low/medium/high/critical; gold uses HIGH/MEDIUM/LOW. Map both
    to a common 3-level scale (critical folds into HIGH)."""
    v = str(s or "").strip().lower()
    if v in ("critical", "high"):
        return "HIGH"
    if v == "medium":
        return "MEDIUM"
    if v == "low":
        return "LOW"
    return "?"


# Coarse map: risk-agent category vocabulary → the 17 gold clause-type keys.
# APPROXIMATE — the two vocabularies are misaligned (backlog #8).
_CATEGORY_MAP = {
    "payment terms": "payment", "liability cap": "liability", "indemnification": "indemnification",
    "termination": "termination", "confidentiality": "confidentiality",
    "intellectual property": "intellectual_property", "compliance": "compliance",
    "contractual": "general", "notice period": "time", "delay": "time", "time": "time",
    "force majeure": "force_majeure", "dispute resolution": "dispute_resolution",
    "performance bond": "payment", "quality": "defects", "warranty": "warranty",
    "defects": "defects", "insurance": "insurance", "scope of work": "scope_of_work",
    "design": "scope_of_work", "variations": "variations", "subcontracting": "general",
    "uncategorized": "other",
}

# The 17 gold labels (display → key) so a gold category in either form normalizes.
_GOLD_LABEL_TO_KEY = {
    "general": "general", "payment": "payment", "liability": "liability",
    "termination": "termination", "indemnification": "indemnification",
    "force majeure": "force_majeure", "dispute resolution": "dispute_resolution",
    "confidentiality": "confidentiality", "compliance": "compliance", "insurance": "insurance",
    "warranty": "warranty", "ip": "intellectual_property",
    "intellectual property": "intellectual_property", "scope of work": "scope_of_work",
    "variations": "variations", "defects": "defects", "time": "time", "other": "other",
}


# Both vocabularies normalize onto the SAME coarse key space, so ONE combined map
# folds a model-side risk category AND a gold `final_category` label identically.
# (Two separate maps silently scored a clause where BOTH sides said e.g.
# "Payment Terms" as a MISMATCH — model→"payment" vs gold→"payment_terms".)
_COMBINED_CATEGORY_MAP = {**_GOLD_LABEL_TO_KEY, **_CATEGORY_MAP}


def _cat_key(value: Any) -> str:
    v = str(value or "").strip().lower()
    return _COMBINED_CATEGORY_MAP.get(v, v.replace(" ", "_"))


def _by_clause(risks: list[dict[str, Any]], id_key: str) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for r in risks:
        cid = r.get(id_key)
        if cid is None:
            continue
        out.setdefault(str(cid), []).append(r)
    return out


def _max_sev_by_clause(risks: list[dict[str, Any]], id_key: str) -> dict[str, str]:
    rank = {"HIGH": 3, "MEDIUM": 2, "LOW": 1, "?": 0}
    best: dict[str, str] = {}
    for cid, rs in _by_clause(risks, id_key).items():
        best[cid] = max((norm_severity(r.get("severity")) for r in rs), key=lambda s: rank[s])
    return best


def score_risk(
    model_risks: list[dict[str, Any]],
    gold_risks: list[dict[str, Any]],
    clauses: list[dict[str, Any]],
) -> dict[str, Any]:
    # Score ONLY clauses the model was actually SHOWN. A gold clause absent from
    # the input (e.g. a clause_rejected OCR/truncation reject that lives in the
    # excluded sidecar, never fed to the model) is un-catchable-by-design and must
    # not deflate recall or agreement.
    input_ids = {str(c["id"]) for c in clauses}
    arabic_clause = {str(c["id"]): _is_arabic(c.get("text", "")) for c in clauses}
    model_sev = _max_sev_by_clause(model_risks, "clause_id")

    # 1. verified-High recall — shown clauses carrying a human-verified HIGH gold risk.
    gold_hi = {str(r["contract_clause_id"]) for r in gold_risks
               if r.get("human_verified") and str(r.get("severity")).upper() == "HIGH"
               and str(r["contract_clause_id"]) in input_ids}
    hits = sum(1 for cid in gold_hi if model_sev.get(cid) == "HIGH")
    recall = round(hits / len(gold_hi), 4) if gold_hi else None

    # 2/3. severity + category agreement over EVERY verified gold clause the model
    #      was shown. A model MISS counts as a NON-match (denominator = all such
    #      clauses), so a model that under-flags gets a LOWER score — it can't hide
    #      behind a shrinking denominator. `verified_recall` reports the flag rate
    #      separately so a miss is distinguishable from a wrong-severity flag.
    gold_ver_by_clause: dict[str, dict[str, Any]] = {}
    rank = {"HIGH": 3, "MEDIUM": 2, "LOW": 1, "?": 0}
    for r in gold_risks:
        if not r.get("verified"):
            continue
        cid = str(r["contract_clause_id"])
        if cid not in input_ids:
            continue
        cur = gold_ver_by_clause.get(cid)
        if cur is None or rank[norm_severity(r.get("severity"))] > rank[norm_severity(cur.get("severity"))]:
            gold_ver_by_clause[cid] = r
    model_cat = {}
    for cid, rs in _by_clause(model_risks, "clause_id").items():
        # category of the model's highest-severity risk on the clause
        top = max(rs, key=lambda r: rank[norm_severity(r.get("severity"))])
        model_cat[cid] = _cat_key(top.get("risk_category"))

    ver_total = len(gold_ver_by_clause)
    ver_flagged = sev_match = cat_match = 0
    for cid, gr in gold_ver_by_clause.items():
        if cid in model_sev:                                    # model flagged this clause at all
            ver_flagged += 1
            if model_sev[cid] == norm_severity(gr.get("severity")):
                sev_match += 1
        if cid in model_cat and model_cat[cid] == _cat_key(gr.get("final_category")):
            cat_match += 1
    verified_recall = round(ver_flagged / ver_total, 4) if ver_total else None
    sev_agree = round(sev_match / ver_total, 4) if ver_total else None   # miss = non-match
    cat_agree = round(cat_match / ver_total, 4) if ver_total else None   # miss = non-match

    # 4. Arabic same-language rate — model risks on Arabic clauses.
    ar_total = ar_ok = 0
    for r in model_risks:
        cid = str(r.get("clause_id"))
        if arabic_clause.get(cid):
            ar_total += 1
            if _is_arabic(r.get("description", "")):
                ar_ok += 1
    ar_rate = round(ar_ok / ar_total, 4) if ar_total else None

    return {
        "model_risk_count": len(model_risks),
        "clauses_with_a_model_risk": len(model_sev),
        "verified_high_clauses": len(gold_hi),
        "verified_high_recall": recall,
        "verified_clauses_total": ver_total,       # verified gold clauses the model was SHOWN
        "verified_clauses_flagged": ver_flagged,   # of those, how many the model flagged at all
        "verified_clauses_missed": ver_total - ver_flagged,
        "verified_recall": verified_recall,        # all-severity flag recall (surfaces under-flagging)
        "severity_agreement": sev_agree,           # miss counts as non-match
        "category_agreement_approx": cat_agree,    # miss counts as non-match
        "arabic_clause_risks": ar_total,
        "arabic_same_language_rate": ar_rate,
    }


def head_to_head(
    a_risks: list[dict[str, Any]],
    b_risks: list[dict[str, Any]],
    clauses: list[dict[str, Any]],
    a_name: str = "A",
    b_name: str = "B",
) -> dict[str, Any]:
    """Non-circular read: compare two models on the SAME clauses (max severity)."""
    a_sev = _max_sev_by_clause(a_risks, "clause_id")
    b_sev = _max_sev_by_clause(b_risks, "clause_id")
    all_ids = {str(c["id"]) for c in clauses}
    a_hi = {cid for cid in all_ids if a_sev.get(cid) == "HIGH"}
    b_hi = {cid for cid in all_ids if b_sev.get(cid) == "HIGH"}
    agree = sum(1 for cid in all_ids if a_sev.get(cid, "none") == b_sev.get(cid, "none"))
    return {
        "clauses": len(all_ids),
        "severity_agreement": round(agree / len(all_ids), 4) if all_ids else None,
        f"high_only_{a_name}": sorted(a_hi - b_hi),
        f"high_only_{b_name}": sorted(b_hi - a_hi),
        f"{a_name}_high_count": len(a_hi),
        f"{b_name}_high_count": len(b_hi),
    }
