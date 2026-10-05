import AddPhotoAlternateOutlined from '@mui/icons-material/AddPhotoAlternateOutlined';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shareDataFromHash } from '../share/hash.ts';
import { useApp, warmUpEngine } from '../state/store.ts';
import { useUi } from '../state/ui.ts';
import { VIEWER_BG_CSS } from '../theme.ts';
import { Landing } from './Landing.tsx';

// The editor (viewer, controls, most MUI components) is a separate chunk, fetched while the landing
// page is idle so opening a photo doesn't wait for it.
const loadEditor = () => import('./editor/Editor.tsx');
const Editor = lazy(loadEditor);
const InfoDialogs = lazy(() => import('./InfoDialogs.tsx'));

function whenIdle(fn: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(fn, { timeout: 3000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 1200);
  return () => clearTimeout(id);
}

/** Shown for the moment the editor chunk takes to arrive (normally it is already prefetched). */
function EditorFallback() {
  return (
    <Box sx={{ height: '100dvh', display: 'grid', placeItems: 'center', bgcolor: VIEWER_BG_CSS }} role="status">
      <CircularProgress sx={{ color: 'rgba(255,255,255,0.85)' }} />
    </Box>
  );
}

/** The first image in a file list; files without a type are tried too (the decoder decides). */
function pickImage(files: FileList | null | undefined): File | null {
  if (!files || files.length === 0) return null;
  const list = Array.from(files);
  return list.find((f) => f.type.startsWith('image/')) ?? list.find((f) => f.type === '') ?? list[0];
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
}

/** Opens share links (#g=...) on load and when the hash changes. */
function useShareHash(): void {
  const openShared = useApp((s) => s.openShared);
  useEffect(() => {
    const check = () => {
      const data = shareDataFromHash(location.hash);
      if (data !== null) void openShared(data);
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, [openShared]);
}

/** Drop a photo anywhere, or paste one; returns whether a file is being dragged over the page. */
function useFileDropAndPaste(): boolean {
  const { t } = useTranslation();
  const openFile = useApp((s) => s.openFile);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const f = pickImage(e.dataTransfer?.files);
      if (f) void openFile(f, f.name);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return;
      const f = pickImage(e.clipboardData?.files);
      if (!f) return;
      e.preventDefault();
      void openFile(f, f.name && f.name !== 'image.png' ? f.name : t('app.pastedImage'));
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      document.removeEventListener('paste', onPaste);
    };
  }, [openFile, t]);
  return dragging;
}

function DropOverlay() {
  const { t } = useTranslation();
  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: (th) => th.zIndex.modal + 1,
        bgcolor: 'rgba(28, 29, 34, 0.72)',
        display: 'grid',
        placeItems: 'center',
        pointerEvents: 'none',
        p: 3,
      }}
      aria-hidden="true"
    >
      <Box sx={{ border: '3px dashed rgba(255,255,255,0.8)', borderRadius: 4, px: 6, py: 5, textAlign: 'center', color: '#fff' }}>
        <AddPhotoAlternateOutlined sx={{ fontSize: 56, mb: 1 }} />
        <Typography variant="h5" component="p">
          {t('app.dropHere')}
        </Typography>
      </Box>
    </Box>
  );
}

export function App() {
  const phase = useApp((s) => s.phase);
  const dialogsWanted = useUi((s) => s.dialogsWanted);
  useShareHash();
  const dragging = useFileDropAndPaste();
  useEffect(
    () =>
      whenIdle(() => {
        void loadEditor();
        warmUpEngine();
      }),
    [],
  );
  return (
    <>
      {phase === 'landing' ? (
        <Landing />
      ) : (
        <Suspense fallback={<EditorFallback />}>
          <Editor mode={phase === 'editor' ? 'edit' : phase === 'shared' ? 'shared' : 'loading'} />
        </Suspense>
      )}
      {dragging && <DropOverlay />}
      {dialogsWanted && (
        <Suspense fallback={null}>
          <InfoDialogs />
        </Suspense>
      )}
    </>
  );
}
