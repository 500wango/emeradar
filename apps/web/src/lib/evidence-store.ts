import { create } from 'zustand';

export interface EvidenceDrawerItem {
  id: string;
  evidenceClass: 'OBSERVED' | 'SELF_REPORTED' | 'THIRD_PARTY_ESTIMATE' | 'INFERRED' | string;
  sourceType: string;
  sourceId: string;
  domain?: string;
  title: string;
  snippet: string;
  payload: any;
  observedAt: string | Date;
}

interface EvidenceDrawerStore {
  isOpen: boolean;
  selectedEvidence: EvidenceDrawerItem | null;
  openDrawer: (item: EvidenceDrawerItem) => void;
  closeDrawer: () => void;
}

export const useEvidenceDrawer = create<EvidenceDrawerStore>((set) => ({
  isOpen: false,
  selectedEvidence: null,
  openDrawer: (item) => set({ isOpen: true, selectedEvidence: item }),
  closeDrawer: () => set({ isOpen: false, selectedEvidence: null }),
}));
