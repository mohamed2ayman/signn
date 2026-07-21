"""Pure orchestration for the Step-2 Stage-1 clause-type feasibility screen:
shape gold records, split cross-validation folds, and run out-of-fold prediction
with an INJECTABLE embedder + classifier.

Deliberately dependency-free (stdlib only) so the CV plumbing is unit-testable
WITHOUT torch/transformers/scikit-learn. The real HF embedder lives in
hf_embedder.py (lazy torch) and the sklearn logistic-regression factory is built
in run_classification.py; both are injected. `NearestCentroid` is a pure-python
classifier used as the default fallback and the test double.
"""
from __future__ import annotations

import math
from typing import Any, Callable


def is_arabic(text: str) -> bool:
    return any(0x0600 <= ord(c) <= 0x06FF for c in (text or ""))


def classification_records(rows: list[dict]) -> list[dict]:
    """One record per gold clause: the model-input text + the yardstick label
    (Claude's stored clause_type) + the slice keys. `rows` are gold_clauses.jsonl
    dicts (contract_clause_id, text, clause_type, section_number, document(_label),
    was_corrected, contract)."""
    out: list[dict] = []
    for c in rows:
        txt = c.get("text", "") or ""
        out.append({
            "clause_id": str(c["contract_clause_id"]),
            "text": txt,
            "clause_ref": c.get("section_number"),
            "document_label": c.get("document_label") or c.get("document"),
            "y_true": c.get("clause_type"),        # the yardstick = Claude's label
            "lang": "ar" if is_arabic(txt) else "en",
            "was_corrected": bool(c.get("was_corrected")),
            "contract": c.get("contract"),
        })
    return out


def slice_language(records: list[dict], lang: str) -> list[dict]:
    return [r for r in records if r["lang"] == lang]


# ---------------------------------------------------------------- fold splitters
# Each returns list[(train_idx, test_idx)] over range(n). Deterministic (no hash,
# no RNG) so a run is reproducible.

def loo_folds(n: int) -> list[tuple[list[int], list[int]]]:
    """Leave-one-out: every clause is the held-out test exactly once. Wastes no
    clause — the honest choice for tiny/imbalanced classes (a singleton class's one
    member, held out, simply has no same-class training example -> an honest miss)."""
    return [([j for j in range(n) if j != i], [i]) for i in range(n)]


def group_folds(groups: list[Any], k: int = 5) -> list[tuple[list[int], list[int]]]:
    """GroupKFold by `groups` (contract): NO contract straddles train/test — the
    leakage-controlled read (clauses of one contract share a template). Distinct
    groups are round-robin'd into k buckets by sorted order (deterministic)."""
    gstr = [str(g) for g in groups]
    uniq = sorted(set(gstr))
    kk = max(1, min(k, len(uniq)))
    bucket = {g: (i % kk) for i, g in enumerate(uniq)}
    folds: list[tuple[list[int], list[int]]] = []
    for b in range(kk):
        test = [i for i, g in enumerate(gstr) if bucket[g] == b]
        train = [i for i, g in enumerate(gstr) if bucket[g] != b]
        if test and train:
            folds.append((train, test))
    return folds


# ---------------------------------------------------------------- pure classifier
class NearestCentroid:
    """Pure-python cosine nearest-centroid classifier over embeddings (lists of
    float). The dependency-free default + test double; the runner injects sklearn
    LogisticRegression(class_weight='balanced') for the real numbers."""

    def fit(self, X: list[list[float]], y: list[str]) -> "NearestCentroid":
        buckets: dict[str, list[list[float]]] = {}
        for vec, lab in zip(X, y):
            buckets.setdefault(lab, []).append(vec)
        self.centroids: dict[str, list[float]] = {}
        for lab, vecs in buckets.items():
            dim = len(vecs[0])
            self.centroids[lab] = [sum(v[d] for v in vecs) / len(vecs) for d in range(dim)]
        return self

    @staticmethod
    def _cos(a: list[float], b: list[float]) -> float:
        dot = sum(x * y for x, y in zip(a, b))
        na = math.sqrt(sum(x * x for x in a))
        nb = math.sqrt(sum(y * y for y in b))
        return dot / (na * nb) if na and nb else 0.0

    def predict(self, X: list[list[float]]) -> list[str]:
        out: list[str] = []
        for vec in X:
            best_lab, best = None, -2.0
            for lab, c in self.centroids.items():
                s = self._cos(vec, c)
                if s > best:
                    best, best_lab = s, lab
            out.append(best_lab)
        return out


# ---------------------------------------------------------------- CV predict
def crossval_predict(
    records: list[dict],
    embed_fn: Callable[[list[str]], list[list[float]]] | None = None,
    *,
    embeddings: list[list[float]] | None = None,
    folds: list[tuple[list[int], list[int]]] | None = None,
    protocol: str = "loo",
    classifier_factory: Callable[[], Any] = NearestCentroid,
) -> list[dict]:
    """Out-of-fold predictions: embed all texts ONCE (or reuse `embeddings`), then
    per fold fit a FRESH classifier on the train split and predict the held-out
    test split. Returns [{clause_id, y_pred}] — the uniform prediction shape the
    scorer consumes. `protocol`: 'loo' | 'group' (group needs records[*]['contract']).
    `embeddings` lets the runner embed once and score multiple protocols."""
    n = len(records)
    X = embeddings if embeddings is not None else embed_fn([r["text"] for r in records])
    y = [r["y_true"] for r in records]
    if folds is None:
        folds = (group_folds([r.get("contract") for r in records])
                 if protocol == "group" else loo_folds(n))
    preds: list[Any] = [None] * n
    for train_idx, test_idx in folds:
        clf = classifier_factory()
        clf.fit([X[i] for i in train_idx], [y[i] for i in train_idx])
        for i, p in zip(test_idx, clf.predict([X[i] for i in test_idx])):
            preds[i] = p
    return [{"clause_id": records[i]["clause_id"], "y_pred": preds[i]}
            for i in range(n) if preds[i] is not None]
