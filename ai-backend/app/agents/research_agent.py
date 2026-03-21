"""Research Agent -- discovers relevant legal assets by keywords and jurisdiction."""

from __future__ import annotations

import json
from typing import Any

from anthropic import Anthropic

from app.config.settings import get_settings

SYSTEM_PROMPT = """\
You are a legal research agent for the SIGN contract management platform.

Given a set of search keywords and an optional jurisdiction, your task is to
identify relevant legal assets that a contract professional would find useful.

For each discovered asset, return a JSON object with:

- title           : the title or heading of the asset
- asset_type      : one of "case_law", "regulation", "template", "article"
- summary         : a brief (2-3 sentence) summary of the asset
- relevance_score : a float between 0.0 and 1.0 indicating how relevant
                    the asset is to the search query
- source          : the source, publication, or URL of the asset

Sort results by relevance_score descending.

Return your answer as a JSON array of asset objects.
Do NOT include any text outside the JSON array.

IMPORTANT: Base your responses on your knowledge of real legal frameworks,
statutes, and case law.  If you are not confident about a specific asset,
indicate a lower relevance_score rather than fabricating details.
"""


class ResearchAgent:
    """Discovers legal assets relevant to given keywords and jurisdiction."""

    def __init__(self) -> None:
        settings = get_settings()
        self._client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    def research(
        self,
        keywords: list[str],
        jurisdiction: str | None = None,
    ) -> list[dict[str, Any]]:
        """Research legal assets matching *keywords* in *jurisdiction*.

        Parameters
        ----------
        keywords:
            Search terms describing the topic of interest.
        jurisdiction:
            Optional legal jurisdiction to scope the search (e.g. "US",
            "UK", "EU", "UAE").

        Returns
        -------
        list[dict[str, Any]]
            A list of discovered asset dicts matching ``DiscoveredAsset``.
        """
        user_content = f"Search keywords: {', '.join(keywords)}\n"
        if jurisdiction:
            user_content += f"Jurisdiction: {jurisdiction}\n"
        user_content += (
            "\nPlease identify the most relevant legal assets for these "
            "search criteria."
        )

        message = self._client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )

        raw_text = message.content[0].text
        assets: list[dict[str, Any]] = json.loads(raw_text)
        return assets
