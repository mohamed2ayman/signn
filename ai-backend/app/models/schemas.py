"""Pydantic request / response schemas for all AI API endpoints."""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Risk Analysis
# ---------------------------------------------------------------------------

class RiskAnalysisRequest(BaseModel):
    """Request body for the risk-analysis agent."""

    contract_id: str = Field(..., description="UUID of the contract being analysed.")
    clauses: list[dict[str, Any]] = Field(
        ...,
        description=(
            "List of clause objects, each containing at least 'id' and 'text'. "
            "May also include 'document_id', 'document_label', and "
            "'document_priority' for cross-document conflict detection."
        ),
    )
    org_id: str = Field(..., description="Organisation UUID for scoping knowledge.")
    knowledge_context: Optional[str] = Field(
        None,
        description="Optional additional context retrieved from the knowledge base.",
    )


class RiskItem(BaseModel):
    """A single identified risk."""

    clause_id: str = Field(..., description="ID of the clause where the risk was found.")
    risk_type: str = Field(..., description="Category of the risk (e.g. 'liability', 'termination', 'document_conflict').")
    severity: str = Field(..., description="Risk severity: 'low', 'medium', 'high', or 'critical'.")
    description: str = Field(..., description="Human-readable explanation of the risk.")
    suggestion: str = Field(..., description="Recommended remediation or alternative language.")
    document_id: Optional[str] = Field(None, description="Source document ID (for traceability).")
    document_label: Optional[str] = Field(None, description="Source document label (e.g. 'Contract Agreement').")
    conflicting_clause_id: Optional[str] = Field(None, description="ID of the conflicting clause (for document_conflict risks).")
    conflicting_document_id: Optional[str] = Field(None, description="Document ID of the conflicting clause.")
    conflicting_document_label: Optional[str] = Field(None, description="Document label of the conflicting clause.")
    governing_value: Optional[str] = Field(None, description="The value selected based on document priority.")
    overridden_value: Optional[str] = Field(None, description="The value overridden by the higher-priority document.")


class RiskAnalysisResponse(BaseModel):
    """Response from the risk-analysis agent."""

    risks: list[RiskItem] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Summarisation
# ---------------------------------------------------------------------------

class SummarizeRequest(BaseModel):
    """Request body for the summariser agent."""

    contract_id: str = Field(..., description="UUID of the contract.")
    full_text: str = Field(..., description="Complete contract text to summarise.")
    org_id: str = Field(..., description="Organisation UUID.")


class SummarizeResponse(BaseModel):
    """Response containing a structured summary with 17 key elements."""

    summary: dict[str, Any] = Field(
        ...,
        description=(
            "Structured summary dict with keys: "
            "title, parties, effective_date, expiration_date, contract_type, "
            "governing_law, jurisdiction, purpose, key_terms, payment_terms, "
            "termination_conditions, renewal_terms, confidentiality, "
            "indemnification, limitation_of_liability, dispute_resolution, "
            "special_provisions"
        ),
    )


# ---------------------------------------------------------------------------
# Diff Analysis
# ---------------------------------------------------------------------------

class DiffRequest(BaseModel):
    """Request body for the diff-analysis agent."""

    original_clauses: list[dict[str, Any]] = Field(
        ..., description="Original version of clauses."
    )
    modified_clauses: list[dict[str, Any]] = Field(
        ..., description="Modified version of clauses."
    )


class DiffChange(BaseModel):
    """A single detected change between contract versions."""

    clause_id: str = Field(..., description="Clause identifier.")
    change_type: str = Field(..., description="Type of change: 'added', 'removed', 'modified'.")
    original_text: Optional[str] = Field(None, description="Original clause text (if applicable).")
    modified_text: Optional[str] = Field(None, description="Modified clause text (if applicable).")
    significance: str = Field(..., description="Impact assessment: 'low', 'medium', 'high'.")
    explanation: str = Field(..., description="Plain-language explanation of the change.")


class DiffResponse(BaseModel):
    """Response from the diff-analysis agent."""

    changes: list[DiffChange] = Field(default_factory=list)
    summary: str = Field(..., description="High-level narrative summary of all changes.")


# ---------------------------------------------------------------------------
# Obligations Extraction
# ---------------------------------------------------------------------------

class ObligationsRequest(BaseModel):
    """Request body for the obligations extractor agent."""

    contract_id: str = Field(..., description="UUID of the contract.")
    clauses: list[dict[str, Any]] = Field(
        ...,
        description=(
            "Clause objects to scan for obligations. "
            "May include 'document_id', 'document_label', and "
            "'document_priority' for priority-aware extraction."
        ),
    )


class ObligationItem(BaseModel):
    """A single extracted obligation."""

    clause_id: str = Field(..., description="Source clause ID.")
    obligation_type: str = Field(
        ..., description="Category: 'payment', 'delivery', 'reporting', 'compliance', 'other'."
    )
    responsible_party: str = Field(..., description="Party responsible for fulfilling the obligation.")
    description: str = Field(..., description="Plain-language description of the obligation.")
    deadline: Optional[str] = Field(None, description="Due date or period, if specified.")
    recurrence: Optional[str] = Field(None, description="Recurrence pattern, if any.")
    document_id: Optional[str] = Field(None, description="Source document ID.")
    document_label: Optional[str] = Field(None, description="Source document label.")
    document_priority: Optional[int] = Field(None, description="Priority of the source document.")


class ObligationsResponse(BaseModel):
    """Response from the obligations extractor."""

    obligations: list[ObligationItem] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Conflict Detection
# ---------------------------------------------------------------------------

class ConflictDetectionRequest(BaseModel):
    """Request body for the conflict detection agent."""

    contract_id: str = Field(..., description="UUID of the contract.")
    clauses: list[dict[str, Any]] = Field(
        ...,
        description=(
            "Clause objects with document metadata: 'id', 'text', "
            "'document_id', 'document_label', 'document_priority'."
        ),
    )


class ConflictDocumentDetail(BaseModel):
    """Details of one side of a document conflict."""

    id: str = Field(..., description="Document ID.")
    label: str = Field(..., description="Document label (e.g. 'Contract Agreement').")
    priority: int = Field(..., description="Document priority number.")
    clause_text: str = Field(..., description="The relevant clause text from this document.")
    clause_id: str = Field(..., description="The clause identifier.")


class ConflictItem(BaseModel):
    """A single detected conflict between two documents."""

    conflict_id: str = Field(..., description="Unique identifier for this conflict.")
    type: str = Field(
        ...,
        description="Conflict type: 'deadline_conflict', 'value_conflict', 'scope_conflict', 'obligation_conflict'.",
    )
    description: str = Field(..., description="Clear explanation of the conflict.")
    document_a: ConflictDocumentDetail = Field(..., description="Higher-priority document details.")
    document_b: ConflictDocumentDetail = Field(..., description="Lower-priority document details.")
    governing_value: str = Field(..., description="The value that takes precedence.")
    governing_reason: str = Field(..., description="Why this value governs.")
    overridden_value: str = Field(..., description="The value being overridden.")
    severity: str = Field(..., description="Impact level: 'low', 'medium', 'high'.")
    suggestion: str = Field(..., description="Recommendation on how to resolve the conflict.")


class ConflictSummary(BaseModel):
    """Aggregate summary of all detected conflicts."""

    total: int = Field(..., description="Total number of conflicts found.")
    by_severity: dict[str, int] = Field(default_factory=dict, description="Count of conflicts by severity level.")
    by_type: dict[str, int] = Field(default_factory=dict, description="Count of conflicts by type.")


class ConflictDetectionResponse(BaseModel):
    """Response from the conflict detection agent."""

    conflicts: list[ConflictItem] = Field(default_factory=list)
    summary: ConflictSummary = Field(..., description="Aggregate conflict summary.")


# ---------------------------------------------------------------------------
# Conversational Chat
# ---------------------------------------------------------------------------

class ChatMessage(BaseModel):
    """A single message in the conversation history."""

    role: str = Field(..., description="Message role: 'user' or 'assistant'.")
    content: str = Field(..., description="Message text.")


class ChatRequest(BaseModel):
    """Request body for the conversational agent."""

    message: str = Field(..., description="Current user message.")
    contract_id: Optional[str] = Field(None, description="Optional contract ID for context.")
    org_id: Optional[str] = Field(None, description="Organisation UUID for knowledge scoping.")
    history: list[ChatMessage] = Field(
        default_factory=list,
        description="Previous conversation messages.",
    )


class Citation(BaseModel):
    """A citation reference returned alongside a chat response."""

    clause_id: Optional[str] = Field(None, description="Referenced clause ID.")
    text: str = Field(..., description="Cited text excerpt.")
    source: str = Field(..., description="Source document or section name.")


class ChatResponse(BaseModel):
    """Response from the conversational agent."""

    response: str = Field(..., description="Assistant reply text.")
    citations: list[Citation] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Research
# ---------------------------------------------------------------------------

class ResearchRequest(BaseModel):
    """Request body for the research agent."""

    keywords: list[str] = Field(..., description="Search keywords.")
    jurisdiction: Optional[str] = Field(None, description="Legal jurisdiction filter.")


class DiscoveredAsset(BaseModel):
    """An asset discovered during research."""

    title: str = Field(..., description="Asset title or heading.")
    asset_type: str = Field(..., description="Type of asset: 'case_law', 'regulation', 'template', 'article'.")
    summary: str = Field(..., description="Brief summary of the asset.")
    relevance_score: float = Field(..., ge=0, le=1, description="Relevance score from 0 to 1.")
    source: str = Field(..., description="Source or URL of the asset.")


class ResearchResponse(BaseModel):
    """Response from the research agent."""

    discovered_assets: list[DiscoveredAsset] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Embeddings
# ---------------------------------------------------------------------------

class EmbeddingIngestRequest(BaseModel):
    """Request body for ingesting a document into the vector store."""

    asset_id: str = Field(..., description="Unique ID of the asset.")
    text: str = Field(..., description="Text content to embed.")
    org_id: str = Field(..., description="Organisation UUID for tenant isolation.")
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Arbitrary metadata to store alongside the embedding.",
    )


class EmbeddingSearchRequest(BaseModel):
    """Request body for searching the vector store."""

    query: str = Field(..., description="Natural-language search query.")
    org_id: str = Field(..., description="Organisation UUID for tenant isolation.")
    filters: dict[str, Any] = Field(
        default_factory=dict,
        description="Optional metadata filters.",
    )
    top_k: int = Field(5, ge=1, le=100, description="Number of results to return.")


class EmbeddingResult(BaseModel):
    """A single embedding search result."""

    asset_id: str = Field(..., description="ID of the matching asset.")
    score: float = Field(..., description="Cosine similarity score.")
    text: str = Field(..., description="Matched text excerpt.")
    metadata: dict[str, Any] = Field(default_factory=dict)


class EmbeddingSearchResponse(BaseModel):
    """Response from an embedding search query."""

    results: list[EmbeddingResult] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Text Extraction
# ---------------------------------------------------------------------------

class TextExtractionRequest(BaseModel):
    """Request body for text extraction from a file."""

    file_path: str = Field(..., description="Path to the file to extract text from.")
    mime_type: str = Field(..., description="MIME type of the file.")


class TextExtractionResponse(BaseModel):
    """Response from text extraction."""

    text: str = Field(..., description="Extracted text content.")
    page_count: int = Field(0, description="Number of pages/sheets/slides.")


# ---------------------------------------------------------------------------
# Clause Extraction
# ---------------------------------------------------------------------------

class ClauseExtractionRequest(BaseModel):
    """Request body for the clause extraction agent."""

    contract_id: str = Field(..., description="UUID of the contract.")
    full_text: str = Field(..., description="Full document text to extract clauses from.")
    contract_type: Optional[str] = Field(None, description="Optional contract type hint.")
    org_id: str = Field(..., description="Organisation UUID.")


class ExtractedClauseItem(BaseModel):
    """A single extracted clause."""

    title: str = Field(..., description="Short descriptive title for the clause.")
    content: str = Field(..., description="Exact original text of the clause.")
    clause_type: str = Field(..., description="Category of the clause.")
    section_number: Optional[str] = Field(None, description="Section number if present.")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Extraction confidence.")


class ClauseExtractionResponse(BaseModel):
    """Response from the clause extraction agent."""

    clauses: list[ExtractedClauseItem] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Async Job
# ---------------------------------------------------------------------------

class AsyncJobResponse(BaseModel):
    """Generic response returned when a task is dispatched to Celery."""

    job_id: str = Field(..., description="Celery task ID for polling status.")
    status: str = Field(default="queued", description="Initial job status.")
