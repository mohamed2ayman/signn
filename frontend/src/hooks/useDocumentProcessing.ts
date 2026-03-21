import { useState, useEffect, useCallback, useRef } from 'react';
import { documentProcessingService } from '@/services/api/documentProcessingService';
import { DocumentProcessingStatus } from '@/types';
import type { DocumentUpload } from '@/types';

const STATUS_PROGRESS: Record<DocumentProcessingStatus, number> = {
  [DocumentProcessingStatus.UPLOADED]: 10,
  [DocumentProcessingStatus.EXTRACTING_TEXT]: 30,
  [DocumentProcessingStatus.TEXT_EXTRACTED]: 50,
  [DocumentProcessingStatus.EXTRACTING_CLAUSES]: 70,
  [DocumentProcessingStatus.CLAUSES_EXTRACTED]: 100,
  [DocumentProcessingStatus.FAILED]: 0,
};

const TERMINAL_STATUSES = new Set([
  DocumentProcessingStatus.CLAUSES_EXTRACTED,
  DocumentProcessingStatus.FAILED,
]);

interface UseDocumentProcessingResult {
  documents: DocumentUpload[];
  allComplete: boolean;
  anyFailed: boolean;
  overallProgress: number;
  isProcessing: boolean;
  refresh: () => Promise<void>;
}

export function useDocumentProcessing(
  contractId: string | null,
  documentIds: string[],
): UseDocumentProcessingResult {
  const [documents, setDocuments] = useState<DocumentUpload[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatuses = useCallback(async () => {
    if (!contractId || documentIds.length === 0) return;

    try {
      const results = await Promise.all(
        documentIds.map((docId) =>
          documentProcessingService.getDocumentStatus(contractId, docId),
        ),
      );
      setDocuments(results);
    } catch (err) {
      console.error('Failed to fetch document statuses:', err);
    }
  }, [contractId, documentIds]);

  useEffect(() => {
    if (!contractId || documentIds.length === 0) return;

    setIsProcessing(true);
    fetchStatuses();

    intervalRef.current = setInterval(fetchStatuses, 2000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [contractId, documentIds, fetchStatuses]);

  // Stop polling when all documents are in terminal state
  useEffect(() => {
    if (documents.length === 0) return;

    const allTerminal = documents.every((doc) =>
      TERMINAL_STATUSES.has(doc.processing_status),
    );

    if (allTerminal) {
      setIsProcessing(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  }, [documents]);

  const allComplete =
    documents.length > 0 &&
    documents.every(
      (doc) =>
        doc.processing_status === DocumentProcessingStatus.CLAUSES_EXTRACTED,
    );

  const anyFailed = documents.some(
    (doc) => doc.processing_status === DocumentProcessingStatus.FAILED,
  );

  const overallProgress =
    documents.length > 0
      ? Math.round(
          documents.reduce(
            (sum, doc) =>
              sum + (STATUS_PROGRESS[doc.processing_status] || 0),
            0,
          ) / documents.length,
        )
      : 0;

  return {
    documents,
    allComplete,
    anyFailed,
    overallProgress,
    isProcessing,
    refresh: fetchStatuses,
  };
}

export default useDocumentProcessing;
