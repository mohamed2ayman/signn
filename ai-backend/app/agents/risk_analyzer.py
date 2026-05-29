"""Risk Analyzer Agent -- identifies contractual risks in individual clauses."""

from __future__ import annotations

import json
from typing import Any

from anthropic import Anthropic

from app.config.settings import get_settings

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

Return your answer as a JSON array of risk objects.  Do NOT include any
text outside the JSON array.
"""


class RiskAnalyzerAgent:
    """Analyses contract clauses and surfaces legal / commercial risks."""

    def __init__(self) -> None:
        settings = get_settings()
        self._client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)

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

        message = self._client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )

        raw_text = message.content[0].text
        risks: list[dict[str, Any]] = json.loads(raw_text)
        return risks
