"""GATED Step-2 Stage-2 correctness scorer (DEFERRED — run AFTER the human fills
the sheet).

Reads the FILLED labeling sheet, treats the human_label as GROUND TRUTH, validates
it against the 17-set, and scores three things per language, reusing the Stage-1
classification_scorer:
  - HUMAN vs CLAUDE            (is Claude's clause_type actually correct?)
  - HUMAN vs CAMeL-BERT  (AR)  (does the free local model match the human?)
  - HUMAN vs ContractBERT (EN)
Model predictions are the Stage-1 CV out-of-fold predictions over the FULL gold
slice (leakage-controlled GroupKFold-by-contract), matched to the labeled clauses
by clause_id — so no clause is scored on a model that trained on it. Runs the HF
models LOCALLY (free, cached); NO API, NO billing.

    RUN_STAGE2_SCORE=1 GOLD_DIR=/path STAGE2_SHEET=/path/filled.xlsx \
      python -m tests.accuracy.model_compare.score_labels
    # optional: CV_PROTOCOL=group|loo (default group)  STAGE2_SCORE_OUT=/tmp/stage2_report.json
"""
from __future__ import annotations

import json
import os

from tests.accuracy.model_compare import gold_loader
from tests.accuracy.model_compare.classification_scorer import LABELS_17, score_classification
from tests.accuracy.model_compare.clause_classification import (
    classification_records, crossval_predict, slice_language)
from tests.accuracy.model_compare.hf_embedder import make_hf_embed_fn
from tests.accuracy.model_compare.model_registry import REGISTRY
from tests.accuracy.model_compare.stage2_labeling import read_filled_xlsx, validate_human_labels


def _classifier_factory():
    from sklearn.linear_model import LogisticRegression  # noqa: PLC0415
    from sklearn.pipeline import make_pipeline  # noqa: PLC0415
    from sklearn.preprocessing import StandardScaler  # noqa: PLC0415

    def make():
        return make_pipeline(
            StandardScaler(),
            LogisticRegression(max_iter=1000, class_weight="balanced", random_state=0),
        )

    return make


def _model_preds_by_clause(records: list[dict], checkpoint: str, protocol: str) -> dict[str, str]:
    """Stage-1 out-of-fold predictions over the FULL slice, keyed by clause_id."""
    embed_fn = make_hf_embed_fn(checkpoint)
    X = embed_fn([r["text"] for r in records])
    preds = crossval_predict(records, embeddings=X, protocol=protocol,
                             classifier_factory=_classifier_factory())
    return {p["clause_id"]: p["y_pred"] for p in preds}


def _run() -> None:
    sheet = os.environ["STAGE2_SHEET"]
    protocol = os.environ.get("CV_PROTOCOL", "group")
    filled = read_filled_xlsx(sheet)
    labeled, unlabeled, invalid = validate_human_labels(filled)
    print(f"sheet rows: {len(filled)} | human-labeled: {len(labeled)} | "
          f"blank: {len(unlabeled)} | INVALID (not in 17): {len(invalid)}")
    if invalid:
        print("  invalid labels (fix before trusting the report):")
        for r in invalid[:20]:
            print(f"    {r.get('row_id')}: {r.get('human_label')!r}")
    if not labeled:
        raise SystemExit("No valid human labels found — nothing to score.")

    # human = ground truth; join everything on clause_id
    gold = {"ar": [], "en": []}
    claude = []
    for r in labeled:
        cid = str(r["clause_id"])
        lang = "ar" if str(r.get("language")).lower().startswith("ar") else "en"
        gold[lang].append({"clause_id": cid, "y_true": r["human_label"], "lang": lang,
                           "was_corrected": False})
        claude.append({"clause_id": cid, "y_pred": str(r.get("claude_label"))})

    # model out-of-fold preds over the FULL gold slice (so labeled clauses are held out somewhere)
    records = classification_records(gold_loader.load_gold()["clauses"])
    slices = {"en": slice_language(records, "en"), "ar": slice_language(records, "ar")}
    model_pred_by_lang = {}
    for spec in REGISTRY:
        print(f"\nrunning {spec.name} ({spec.checkpoint}) on full {spec.language.upper()} "
              f"(n={len(slices[spec.language])}) …")
        model_pred_by_lang[spec.language] = _model_preds_by_clause(
            slices[spec.language], spec.checkpoint, protocol)

    report = {"sheet": sheet, "protocol": protocol,
              "counts": {"labeled": len(labeled), "blank": len(unlabeled), "invalid": len(invalid)},
              "by_language": {}}
    for lang in ("en", "ar"):
        g = gold[lang]
        if not g:
            continue
        claude_l = [c for c in claude if any(c["clause_id"] == x["clause_id"] for x in g)]
        model_l = [{"clause_id": x["clause_id"], "y_pred": model_pred_by_lang[lang].get(x["clause_id"])}
                   for x in g if model_pred_by_lang[lang].get(x["clause_id"]) is not None]
        report["by_language"][lang] = {
            "n_human_labeled": len(g),
            "human_vs_claude": score_classification(claude_l, g, LABELS_17),
            "human_vs_model": score_classification(model_l, g, LABELS_17),
        }
        hc = report["by_language"][lang]["human_vs_claude"]["overall"]
        hm = report["by_language"][lang]["human_vs_model"]["overall"]
        print(f"\n[{lang.upper()}] human-labeled={len(g)}")
        print(f"    HUMAN vs CLAUDE : acc={hc['accuracy']} macroF1={hc['macro_f1_present']}")
        print(f"    HUMAN vs MODEL  : acc={hm['accuracy']} macroF1={hm['macro_f1_present']} "
              f"(n_scored={report['by_language'][lang]['human_vs_model']['n_scored']})")

    out = os.environ.get("STAGE2_SCORE_OUT", "/tmp/stage2_report.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print(f"\nwrote {out}")


if __name__ == "__main__":
    if os.environ.get("RUN_STAGE2_SCORE") != "1":
        raise SystemExit(
            "Refusing to run: set RUN_STAGE2_SCORE=1 (re-runs the HF models locally — "
            "free, cached, no billing). Also set GOLD_DIR and STAGE2_SHEET=<filled.xlsx>."
        )
    _run()
