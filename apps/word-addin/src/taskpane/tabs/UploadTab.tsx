/// <reference types="office-js" />

import * as React from 'react';
import type { AuthState } from '../lib/auth';
import { api } from '../lib/api';

interface Props {
  auth: AuthState;
  onAuthLost: () => void;
}

interface Project {
  id: string;
  name: string;
}
interface Contract {
  id: string;
  title: string;
  contract_number?: string;
  status: string;
}

export function UploadTab({ onAuthLost }: Props) {
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [contracts, setContracts] = React.useState<Contract[]>([]);
  const [projectId, setProjectId] = React.useState('');
  const [contractId, setContractId] = React.useState('');
  const [label, setLabel] = React.useState('');
  const [busy, setBusy] = React.useState<'idle' | 'uploading' | 'done'>('idle');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        const list = await api<Project[]>('/projects');
        setProjects(list);
      } catch (e) {
        if (e instanceof Error && e.name === 'AuthRequiredError') onAuthLost();
        else setError(e instanceof Error ? e.message : 'Failed to load projects');
      }
    })();
  }, []);

  React.useEffect(() => {
    if (!projectId) {
      setContracts([]);
      return;
    }
    (async () => {
      try {
        const list = await api<Contract[]>(`/projects/${projectId}/contracts`);
        setContracts(list);
      } catch (e) {
        if (e instanceof Error && e.name === 'AuthRequiredError') onAuthLost();
        else setError(e instanceof Error ? e.message : 'Failed to load contracts');
      }
    })();
  }, [projectId]);

  const upload = async () => {
    if (!contractId) {
      setError('Pick a contract.');
      return;
    }
    setError(null);
    setBusy('uploading');
    try {
      const fileBytes = await getCurrentDocxBytes();
      const blob = new Blob([fileBytes], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const filename = `word-addin-${Date.now()}.docx`;

      const form = new FormData();
      form.append('file', blob, filename);
      if (label) form.append('document_label', label);

      await api(`/contracts/${contractId}/documents`, {
        method: 'POST',
        multipart: form,
      });
      setBusy('done');
    } catch (e) {
      if (e instanceof Error && e.name === 'AuthRequiredError') {
        onAuthLost();
        return;
      }
      setError(e instanceof Error ? e.message : 'Upload failed');
      setBusy('idle');
    }
  };

  return (
    <div>
      <div className="sign-card">
        <div style={{ fontSize: 12, marginBottom: 8 }}>
          Upload the document open in Word to a SIGN contract.
        </div>
        <select
          className="sign-input"
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            setContractId('');
          }}
        >
          <option value="">— select project —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          className="sign-input"
          value={contractId}
          onChange={(e) => setContractId(e.target.value)}
          disabled={!projectId}
        >
          <option value="">— select contract —</option>
          {contracts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} {c.contract_number ? `(${c.contract_number})` : ''}
            </option>
          ))}
        </select>
        <input
          className="sign-input"
          placeholder="Document label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button
          className="sign-button"
          onClick={upload}
          disabled={busy === 'uploading' || !contractId}
        >
          {busy === 'uploading' ? 'Uploading…' : 'Upload to SIGN'}
        </button>
        {busy === 'done' && (
          <div style={{ color: '#1d6d1d', fontSize: 12, marginTop: 8 }}>
            Uploaded. SIGN is processing the document.
          </div>
        )}
        {error && <div className="sign-error">{error}</div>}
      </div>
    </div>
  );
}

/**
 * Read the current Word document as a binary .docx using Office.context.document.getFileAsync.
 * Streams slices and concatenates into a single Uint8Array.
 */
function getCurrentDocxBytes(): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    Office.context.document.getFileAsync(
      Office.FileType.Compressed,
      { sliceSize: 65536 },
      (fileResult) => {
        if (fileResult.status !== Office.AsyncResultStatus.Succeeded) {
          reject(fileResult.error);
          return;
        }
        const file = fileResult.value;
        const slices: Uint8Array[] = [];
        let received = 0;

        const readNext = () => {
          if (received === file.sliceCount) {
            file.closeAsync(() => {
              const total = slices.reduce((acc, s) => acc + s.length, 0);
              const out = new Uint8Array(total);
              let offset = 0;
              for (const s of slices) {
                out.set(s, offset);
                offset += s.length;
              }
              resolve(out);
            });
            return;
          }
          file.getSliceAsync(received, (sliceResult) => {
            if (sliceResult.status !== Office.AsyncResultStatus.Succeeded) {
              file.closeAsync(() => reject(sliceResult.error));
              return;
            }
            const data = sliceResult.value.data as ArrayBuffer | Uint8Array;
            slices.push(
              data instanceof Uint8Array ? data : new Uint8Array(data),
            );
            received++;
            readNext();
          });
        };
        readNext();
      },
    );
  });
}
