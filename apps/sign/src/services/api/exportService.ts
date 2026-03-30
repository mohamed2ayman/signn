import api from './axios';

function downloadBlob(data: Blob, filename: string) {
  const url = window.URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export const exportService = {
  downloadContractPdf: async (contractId: string) => {
    const response = await api.get(`/export/contracts/${contractId}/pdf`, {
      responseType: 'blob',
    });
    downloadBlob(new Blob([response.data]), `contract-${contractId}.pdf`);
  },

  downloadRiskReport: async (contractId: string) => {
    const response = await api.get(
      `/export/contracts/${contractId}/risk-report`,
      { responseType: 'blob' },
    );
    downloadBlob(new Blob([response.data]), `risk-report-${contractId}.pdf`);
  },

  downloadSummary: async (
    contractId: string,
    format: 'pdf' | 'json' = 'pdf',
  ) => {
    const response = await api.get(
      `/export/contracts/${contractId}/summary`,
      {
        params: { format },
        responseType: format === 'pdf' ? 'blob' : 'json',
      },
    );
    if (format === 'pdf') {
      downloadBlob(new Blob([response.data]), `summary-${contractId}.pdf`);
    }
    return response.data;
  },
};
