"""Model registry for the clause-type feasibility screen (Step 2, Stage 1).

Adding a 3rd model later is ONE `ModelSpec` line. Each spec names a REAL,
license-checked HuggingFace checkpoint + the gold language slice it is evaluated
on. Predictions are produced uniformly downstream (embed -> CV classifier), so the
scorer never knows which model ran. No torch import here — checkpoints are strings.

Checkpoint choices are from docs/step2-clause-classification-benchmark-investigation.md §4:
  - EN: `nlpaueb/bert-base-uncased-contracts` — the real "ContractBERT" (LEGAL-BERT
        CONTRACTS sub-variant, pretrained on US EDGAR/SEC contracts). cc-by-sa-4.0.
  - AR: `CAMeL-Lab/bert-base-arabic-camelbert-mix` — Arabic MSA+Dialectal+Classical,
        Apache-2.0. (NOTE the premise correction: LEGAL-XLM-RoBERTa covers 24 EU
        languages and has NO Arabic — verified on its model card — so an
        Arabic-specific encoder is used instead.)
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelSpec:
    name: str          # short display name
    checkpoint: str    # HuggingFace id (real, license-checked)
    language: str      # "en" | "ar" — the gold slice this model is evaluated on
    license: str       # informational (from the model card)


REGISTRY: list[ModelSpec] = [
    ModelSpec("contractbert-en", "nlpaueb/bert-base-uncased-contracts", "en", "cc-by-sa-4.0"),
    ModelSpec("camelbert-ar", "CAMeL-Lab/bert-base-arabic-camelbert-mix", "ar", "apache-2.0"),
    # Add a 3rd model as ONE line, e.g.:
    # ModelSpec("legal-bert-en", "nlpaueb/legal-bert-base-uncased", "en", "cc-by-sa-4.0"),
]
