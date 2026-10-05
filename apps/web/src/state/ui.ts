// Transient UI state that several components share: dialogs, toasts and the print view.

import { create } from 'zustand';

export type InfoDialog = 'about' | 'privacy' | null;
export type ToastSeverity = 'success' | 'info' | 'warning' | 'error';

export interface Toast {
  id: number;
  message: string;
  severity: ToastSeverity;
}

interface UiState {
  dialog: InfoDialog;
  /** The dialogs chunk is loaded once something asked for a dialog. */
  dialogsWanted: boolean;
  toast: Toast | null;
  printOpen: boolean;
  /** A share link that couldn't be copied automatically, shown for manual copying. */
  manualShareUrl: string | null;
  openDialog(d: Exclude<InfoDialog, null>): void;
  closeDialog(): void;
  notify(message: string, severity?: ToastSeverity): void;
  dismissToast(): void;
  setPrintOpen(open: boolean): void;
  setManualShareUrl(url: string | null): void;
}

let toastId = 0;

export const useUi = create<UiState>()((set) => ({
  dialog: null,
  dialogsWanted: false,
  toast: null,
  printOpen: false,
  manualShareUrl: null,
  openDialog: (dialog) => set({ dialog, dialogsWanted: true }),
  closeDialog: () => set({ dialog: null }),
  notify: (message, severity = 'success') => set({ toast: { id: ++toastId, message, severity } }),
  dismissToast: () => set({ toast: null }),
  setPrintOpen: (printOpen) => set({ printOpen }),
  setManualShareUrl: (manualShareUrl) => set(manualShareUrl ? { manualShareUrl, dialogsWanted: true } : { manualShareUrl }),
}));
