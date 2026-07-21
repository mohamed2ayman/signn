"""GATED, LOCAL, FREE clause-type feasibility runner (Step 2, Stage 1).

Downloads the HF checkpoints on first run + runs CPU inference — NO API, NO
billing. For each registered model it measures the CROSS-VALIDATED agreement
between a frozen-embedding classifier and Claude's stored clause_type (the
yardstick; NOT correctness — no human type ground truth yet). Runs BOTH CV
protocols (leave-one-out = optimistic; group-by-contract = leakage-controlled)
so the gap is visible, and writes ONE JSON report.

    RUN_CLASSIFICATION=1 GOLD_DIR=/path/to/gold \
      python -m tests.accuracy.model_compare.run_classification

Requires the eval-only deps (ai-backend/requirements-eval.txt): torch,
transformers, scikit-learn. Gold is read locally and never leaves the machine.
Env (optional): CLASSIFICATION_REPORT (out path, default /tmp/classification_report.json).
"""
from __future__ import annotations

import json
import os

from tests.accuracy.model_compare import gold_loader
from tests.accuracy.model_compare.classification_scorer import LABELS_17, score_classification
from tests.accuracy.model_compare.clause_classification import (
    NearestCentroid, classification_records, crossval_predict, slice_language)
from tests.accuracy.model_compare.hf_embedder import make_hf_embed_fn
from tests.accuracy.model_compare.model_registry import REGISTRY

PROTOCOLS = ("loo", "group")


def _classifier_factory():
    """sklearn LogisticRegression(class_weight='balanced') if available (the real
    classifier for imbalanced data), else the pure NearestCentroid fallback. The
    report records which was used."""
    try:
        from sklearn.linear_model import LogisticRegression  # noqa: PLC0415
        from sklearn.pipeline import make_pipeline  # noqa: PLC0415
        from sklearn.preprocessing import StandardScaler  # noqa: PLC0415

        def make():
            # StandardScaler (fit per-fold inside the pipeline -> no leakage) makes
            # lbfgs converge in a fraction of the iterations on 768-dim BERT
            # embeddings; without it lbfgs hits max_iter every fit (pathologically
            # slow across the ~404 leave-one-out fits).
            return make_pipeline(
                StandardScaler(),
                LogisticRegression(max_iter=1000, class_weight="balanced", random_state=0),
            )

        return make, "standardscaler+logreg_balanced"
    except Exception:  # noqa: BLE001 — sklearn optional; centroid is a valid fallback
        return NearestCentroid, "nearest_centroid"


def _run() -> None:
    gold = gold_loader.load_gold()
    records = classification_records(gold["clauses"])
    factory, clf_name = _classifier_factory()
    report = {"classifier": clf_name, "labels": LABELS_17, "models": {}}

    print(f"classifier: {clf_name} | total gold clauses: {len(records)} "
          f"(en={len(slice_language(records,'en'))} ar={len(slice_language(records,'ar'))})", flush=True)

    for spec in REGISTRY:
        sub = slice_language(records, spec.language)
        print(f"\n=== {spec.name}  {spec.checkpoint}  [{spec.language.upper()}]  n={len(sub)} ===", flush=True)
        print("    embedding (frozen, CPU) …", flush=True)
        embed_fn = make_hf_embed_fn(spec.checkpoint)
        X = embed_fn([r["text"] for r in sub])                # embed ONCE
        model_out = {"checkpoint": spec.checkpoint, "language": spec.language,
                     "license": spec.license, "n": len(sub), "protocols": {}}
        for protocol in PROTOCOLS:
            preds = crossval_predict(sub, embeddings=X, protocol=protocol,
                                     classifier_factory=factory)
            result = score_classification(preds, sub, LABELS_17)
            model_out["protocols"][protocol] = result
            ov = result["overall"]
            print(f"    [{protocol:5}] acc={ov['accuracy']} macro_f1_present={ov['macro_f1_present']} "
                  f"macro_f1_all17={ov['macro_f1_all17']} n_scored={result['n_scored']}", flush=True)
        report["models"][spec.name] = model_out

    out = os.environ.get("CLASSIFICATION_REPORT", "/tmp/classification_report.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print(f"\nwrote {out}", flush=True)


if __name__ == "__main__":
    if os.environ.get("RUN_CLASSIFICATION") != "1":
        raise SystemExit(
            "Refusing to run: set RUN_CLASSIFICATION=1 (this downloads HF models + "
            "runs local CPU inference; free, no billing). Also set GOLD_DIR."
        )
    _run()
