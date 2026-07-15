"""Risk Analyzer Agent -- identifies contractual risks in individual clauses."""

from __future__ import annotations

import json
import re
from typing import Any

from app.agents.base_agent import BaseAgent


def _parse_risk_array(raw: str) -> list[dict[str, Any]]:
    """Parse the model's JSON risk array robustly + truncation-tolerant.

    The model wraps its output in a ```json markdown fence (and may add a
    preamble), which a bare ``json.loads`` chokes on — the historical cause of
    the risk path parsing 0 risks. It can also hit ``max_tokens`` mid-array, so
    the array has no closing ``]``. This mirrors the proven parser shipped in
    ``scripts/risk_prelabel_batch.py``: strip the fence, isolate the outermost
    ``[...]``, and — if that fails — decode complete objects one at a time and
    keep everything before the cutoff. Returns ``[]`` on unparseable prose.
    """
    s = (raw or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\n?", "", s)
        s = re.sub(r"\n?```\s*$", "", s).strip()
    a = s.find("[")
    if a == -1:
        return []
    # Fast path: a well-formed complete array (possibly with surrounding prose).
    b = s.rfind("]")
    if b > a:
        try:
            out = json.loads(s[a:b + 1])
            if isinstance(out, list):
                return [x for x in out if isinstance(x, dict)]
        except (json.JSONDecodeError, ValueError):
            pass
    # Salvage path: decode complete objects until the first incomplete one.
    dec = json.JSONDecoder()
    i = a + 1
    objs: list[dict[str, Any]] = []
    while i < len(s):
        while i < len(s) and s[i] in " \t\r\n,":
            i += 1
        if i >= len(s) or s[i] == "]":
            break
        try:
            obj, end = dec.raw_decode(s, i)
        except (json.JSONDecodeError, ValueError):
            break  # truncated / incomplete object — keep what completed
        if isinstance(obj, dict):
            objs.append(obj)
        i = end
    return objs

# ═══════════════════════════════════════════════════════════════════════════
# ⚠️  PHASE 7.17 PROMPT 1 — A.1 PROMPT UPDATE
#
# DO NOT MERGE TO PRODUCTION WITHOUT AYMAN SIGN-OFF on the Likelihood /
# Impact anchor language below. The anchors were synthesised from PMBOK +
# construction-law literature but have NOT been validated by a domain
# expert. Two acceptable paths until sign-off lands:
#
#   (a) feature-flag this prompt OFF in production (route prod AI traffic
#       to the previous prompt content);
#   (b) keep production pointing at the previous content via a config flag
#       while staging exercises the new prompt.
#
# The cost-percentage banding (1-5%, 5-15%, >15%), schedule-slip
# thresholds (<1 wk, 1-4 wks, 1-3 mo), and Impact=5 example scenarios
# (litigation / criminal exposure / safety incident) all need
# domain-expert review before they shape every L,I value the platform
# ever produces.
#
# This guard exists in the prompt file itself so any PR reviewer sees it
# before approving the merge — do not remove without the sign-off.
# ═══════════════════════════════════════════════════════════════════════════

SYSTEM_PROMPT = """\
You are an expert legal risk analyst for the SIGN contract management platform.

Your task is to analyse the contract clauses provided by the user and identify
potential risks within INDIVIDUAL CLAUSES.

SCOPE EXCLUSION: Do NOT return findings about contradictions or conflicts
between multiple documents. Cross-document conflicts are handled by a
separate analysis pipeline (the conflict-detection agent and the
pollAndSaveConflicts writer on the backend). Focus only on risks within
individual clauses of the current document. If you see what looks like a
cross-document contradiction, ignore it — the conflict pipeline will
catch it.

For every risk you find, return a JSON object with the following fields:

- clause_id      : the identifier of the clause where the risk was found
- risk_category  : a canonical risk-category name describing the nature of
                   the risk (e.g. "Performance Bond", "Liability Cap",
                   "Payment Terms", "Indemnification", "Termination",
                   "Notice Period", "Force Majeure", "Dispute Resolution",
                   "Confidentiality", "Intellectual Property"). If the
                   risk does not fit any standard category, return
                   "Uncategorized" and explain in the description.
- likelihood     : integer 1-5 with these anchors:
                     1 = Rare           — would require an extraordinary
                                          chain of events
                     2 = Unlikely       — possible but not expected based
                                          on typical project conditions
                     3 = Possible       — could reasonably occur during
                                          the contract lifecycle
                     4 = Likely         — expected to occur given typical
                                          project dynamics
                     5 = Almost Certain — virtually inevitable absent
                                          specific mitigation
- impact         : integer 1-5 with these anchors:
                     1 = Insignificant  — minor inconvenience, no material
                                          consequence
                     2 = Minor          — small cost overrun, schedule slip
                                          under 1 week, or minor
                                          reputational concern
                     3 = Moderate       — meaningful cost (1-5% of contract
                                          value), schedule slip 1-4 weeks,
                                          or operational disruption
                     4 = Major          — significant cost (5-15% of
                                          contract value), schedule slip
                                          1-3 months, reputational damage,
                                          or contractual dispute likely
                     5 = Severe         — catastrophic cost (>15% of
                                          contract value), project failure,
                                          litigation, criminal/regulatory
                                          exposure, or safety incident
- severity       : one of "low", "medium", "high", "critical" — legacy
                   compatibility field. Derive from likelihood × impact
                   using these bands:
                     score = likelihood * impact
                     1-5   → "low"
                     6-14  → "medium"
                     15-20 → "high"
                     21-25 → "critical"
- description    : a clear, concise explanation of the risk written for
                   a business user (not a lawyer)
- suggestion     : a concrete recommendation for mitigating the risk or
                   alternative contract language

The likelihood and impact fields are the PRIMARY values — the platform
uses likelihood × impact to compute a 1-25 risk score that drives every
downstream surface (portfolio dashboards, sorting, drift detection).
Pick values deliberately against the anchor descriptions above; do not
default to 3 / 3 unless that genuinely reflects your assessment.

If additional knowledge context is provided, use it to calibrate your
assessment against the organisation's risk appetite and past precedents.

LANGUAGE — HARD RULE:
- Write the `description` and `suggestion` fields in the SAME LANGUAGE as the
  clause each risk is about. If the clause is in Arabic, that risk's
  `description` and `suggestion` MUST be in Arabic; if the clause is in
  English, they MUST be in English. Never translate the clause's language.
  The clauses below may be in different languages, so decide PER CLAUSE from
  that clause's own text.
- Keep `risk_category` as the canonical English key exactly as listed above —
  it is a fixed label, not prose; do NOT translate it.

Return your answer as a JSON array of risk objects.  Do NOT include any
text outside the JSON array.
"""


class RiskAnalyzerAgent(BaseAgent):
    """Analyses contract clauses and surfaces legal / commercial risks."""

    def analyze(
        self,
        clauses: list[dict[str, Any]],
        knowledge_context: str | None = None,
    ) -> list[dict[str, Any]]:
        """Analyse *clauses* and return a list of identified risks.

        Parameters
        ----------
        clauses:
            Each dict should contain at least ``id`` and ``text`` keys.
        knowledge_context:
            Optional context from the organisation's knowledge base to help
            calibrate risk assessment.

        Returns
        -------
        list[dict[str, Any]]
            A list of risk dicts matching the ``RiskItem`` schema.
        """
        # Check if clauses carry document metadata
        has_doc_metadata = any(
            clause.get("document_id") for clause in clauses
        )

        user_content = "Analyse the following contract clauses for risks:\n\n"

        if has_doc_metadata:
            # Group clauses by document for clarity
            docs: dict[str, list[dict[str, Any]]] = {}
            for clause in clauses:
                doc_key = clause.get("document_id", "unknown")
                docs.setdefault(doc_key, []).append(clause)

            for doc_id, doc_clauses in docs.items():
                label = doc_clauses[0].get("document_label", "Unknown Document")
                priority = doc_clauses[0].get("document_priority", 0)
                user_content += (
                    f"## Document: {label} "
                    f"(ID: {doc_id}, Priority: {priority})\n\n"
                )
                for clause in doc_clauses:
                    user_content += (
                        f"### Clause {clause.get('id', 'unknown')}\n"
                        f"{clause.get('text', '')}\n\n"
                    )

            user_content += (
                "IMPORTANT: Compare clauses across ALL documents above and "
                "detect any conflicts or ambiguities. LOWER priority number "
                "means the document is MORE important (priority 1 always wins).\n\n"
            )
        else:
            for clause in clauses:
                user_content += (
                    f"### Clause {clause.get('id', 'unknown')}\n"
                    f"{clause.get('text', '')}\n\n"
                )

        if knowledge_context:
            user_content += (
                "### Organisation Knowledge Context\n"
                f"{knowledge_context}\n"
            )

        # Same-language reinforcement (mirrors clause_rewriter): write each
        # risk's description/suggestion in the language of the clause it is
        # about, and keep risk_category as the English canonical key.
        user_content += (
            "\nWrite every risk's `description` and `suggestion` in the SAME "
            "language as the clause it refers to (Arabic clause → Arabic; "
            "English clause → English; never translate). Keep `risk_category` "
            "as the English canonical name.\n"
        )

        message = self._call_model(
            scrub=True,  # Camp-1: structured-PII scrubbed (Slice 1)
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )

        raw_text = message.content[0].text
        # Robust, fence-/truncation-tolerant parse (was a bare json.loads that
        # returned 0 risks on the model's ```json-fenced output). The _call_model
        # chokepoint above is UNCHANGED — only the parsing of its response text.
        risks: list[dict[str, Any]] = _parse_risk_array(raw_text)
        return risks
