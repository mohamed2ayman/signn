"""Export the Step-2 Stage-2 human clause-type labeling sheet.

Reads the gold (GOLD_DIR), takes ALL English clauses + a STRATIFIED Arabic sample
(default 150, every type represented), and writes an XLSX with a `labeling` tab
(Claude's label shown, human_label dropdown from the 17), a `Labels` reference
tab, and a HIDDEN `_map` tab (row_id -> clause_id). Prints the per-type draw.
Eval-only — reads local gold, NO model calls, NO billing.

    GOLD_DIR=/path/to/gold python -m tests.accuracy.model_compare.export_labeling_sheet
    # optional: STAGE2_AR_N=150  STAGE2_SHEET=/tmp/clause_labeling_sheet.xlsx
"""
from __future__ import annotations

import collections
import os

from tests.accuracy.model_compare import gold_loader
from tests.accuracy.model_compare.classification_scorer import LABELS_17
from tests.accuracy.model_compare.clause_classification import (
    classification_records, slice_language)
from tests.accuracy.model_compare.stage2_labeling import (
    build_label_rows, stratified_sample, write_labeling_xlsx)


def main() -> None:
    records = classification_records(gold_loader.load_gold()["clauses"])
    en = slice_language(records, "en")
    ar = slice_language(records, "ar")
    n_ar = int(os.environ.get("STAGE2_AR_N", "150"))
    ar_sample, alloc = stratified_sample(ar, n_total=n_ar)
    rows = build_label_rows(en, ar_sample)

    out = os.environ.get("STAGE2_SHEET", "/tmp/clause_labeling_sheet.xlsx")
    write_labeling_xlsx(rows, out)

    avail = collections.Counter(r["y_true"] for r in ar)
    print(f"English clauses: {len(en)} (ALL) | Arabic sampled: {len(ar_sample)}/{len(ar)} "
          f"| total labeling rows: {len(rows)}")
    print("\nArabic stratified draw per type (drawn / available):")
    for lab in LABELS_17:
        if avail.get(lab):
            print(f"  {lab:22} {alloc.get(lab, 0):>3} / {avail[lab]}")
    drawn_types = sum(1 for lab in avail if alloc.get(lab, 0) > 0)
    print(f"\ntypes represented in the AR sample: {drawn_types}/{len(avail)} "
          f"(every available type present: {drawn_types == len(avail)})")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
