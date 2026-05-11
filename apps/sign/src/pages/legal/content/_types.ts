// Shared types for legal content modules.
export type LegalBlock =
  | { type: 'p'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'table'; rows: string[][] };

export interface LegalSubsection {
  id: string;
  title: string;
  blocks: LegalBlock[];
}

export interface LegalSection {
  id: string;
  title: string;
  intro: LegalBlock[];
  subsections: LegalSubsection[];
}

export interface LegalTocSubsection {
  id: string;
  title: string;
}

export interface LegalTocSection {
  id: string;
  title: string;
  subsections: LegalTocSubsection[];
}

export type LegalToc = LegalTocSection[];
