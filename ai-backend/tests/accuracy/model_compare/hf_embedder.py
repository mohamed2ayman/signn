"""Frozen mean-pooled sentence embeddings from a LOCAL HuggingFace encoder.

EVAL-ONLY. torch + transformers are imported LAZILY inside the factory, so this
module — and the whole model_compare package — imports fine without them (keeps
the ai-backend test suite green when the eval deps are absent). Runs on CPU,
fully OFFLINE once the checkpoint is cached, NO API, NO billing. The gold text
never leaves the machine.

BERT-family encoders have no meaningful zero-shot classification, so Stage 1 uses
FROZEN embeddings (no fine-tuning) fed to a simple cross-validated classifier —
the realistic approach at ~64 EN / ~404 AR clauses
(see docs/step2-clause-classification-benchmark-investigation.md §4).
"""
from __future__ import annotations

from typing import Callable


def make_hf_embed_fn(checkpoint: str, *, batch_size: int = 16,
                     max_length: int = 512) -> Callable[[list[str]], list[list[float]]]:
    """Return embed_fn(list[str]) -> list[list[float]]: mean-pooled (attention-mask
    weighted) last-hidden-state of `checkpoint`, frozen (no grad). Downloads the
    checkpoint on first use (cached under HF_HOME). Lazy torch/transformers."""
    import torch  # noqa: PLC0415 — eval-only, imported on demand
    from transformers import AutoModel, AutoTokenizer  # noqa: PLC0415

    tok = AutoTokenizer.from_pretrained(checkpoint)
    model = AutoModel.from_pretrained(checkpoint)
    model.eval()

    @torch.no_grad()
    def embed(texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for i in range(0, len(texts), batch_size):
            batch = [t or "" for t in texts[i:i + batch_size]]
            enc = tok(batch, padding=True, truncation=True, max_length=max_length,
                      return_tensors="pt")
            hidden = model(**enc).last_hidden_state            # [B, T, H]
            mask = enc["attention_mask"].unsqueeze(-1).float()  # [B, T, 1]
            summed = (hidden * mask).sum(dim=1)                 # [B, H]
            counts = mask.sum(dim=1).clamp(min=1e-9)
            out.extend((summed / counts).cpu().tolist())
        return out

    return embed
