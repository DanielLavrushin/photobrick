import AddPhotoAlternateOutlined from '@mui/icons-material/AddPhotoAlternateOutlined';
import Compare from '@mui/icons-material/Compare';
import FitScreen from '@mui/icons-material/FitScreen';
import GridOn from '@mui/icons-material/GridOn';
import VerticalSplit from '@mui/icons-material/VerticalSplit';
import WarningAmber from '@mui/icons-material/WarningAmber';
import ZoomIn from '@mui/icons-material/ZoomIn';
import ZoomOut from '@mui/icons-material/ZoomOut';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Skeleton from '@mui/material/Skeleton';
import Slider from '@mui/material/Slider';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { cropRect } from '@photobrick/engine';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { VIEWER_BAR_CSS, VIEWER_BG, VIEWER_BG_CSS } from '../../theme.ts';
import { MosaicViewer, type CompareSpec, type MosaicViewerHandle, type RendererKind } from '../../viewer/index.ts';
import { pxPerStud, useApp } from '../../state/store.ts';
import { useMosaicData } from '../useMosaicData.ts';
import { SummaryChips } from './SummaryChips.tsx';

export type EditorMode = 'edit' | 'shared' | 'loading';

const LOW_RES_PX_PER_STUD = 2;

function ToolButton({ label, onClick, pressed, children }: { label: string; onClick: () => void; pressed?: boolean; children: ReactNode }) {
  return (
    <Tooltip title={label}>
      <IconButton
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
        sx={{ color: pressed ? '#fff' : 'rgba(255,255,255,0.86)', bgcolor: pressed ? 'rgba(255,255,255,0.18)' : 'transparent', '&:hover': { bgcolor: 'rgba(255,255,255,0.12)' } }}
      >
        {children}
      </IconButton>
    </Tooltip>
  );
}

/** True after `busy` has stayed on for `ms` (no flicker for the usual 10 ms regenerations). */
function useDelayed(busy: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!busy) {
      const id = setTimeout(() => setLate(false), 0);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(id);
  }, [busy, ms]);
  return late && busy;
}

export function ViewerPane({ mode, desktop }: { mode: EditorMode; desktop: boolean }) {
  const { t } = useTranslation();
  const data = useMosaicData();
  const image = useApp((s) => s.image);
  const settings = useApp((s) => s.settings);
  const cropMode = useApp((s) => s.cropMode);
  const busy = useApp((s) => s.busy);
  const loadingName = useApp((s) => s.loadingName);
  const moveCrop = useApp((s) => s.moveCrop);
  const zoomCrop = useApp((s) => s.zoomCrop);
  const setCropMode = useApp((s) => s.setCropMode);
  const newPhoto = useApp((s) => s.newPhoto);
  const viewerRef = useRef<MosaicViewerHandle>(null);
  const [grid, setGrid] = useState(false);
  const [holding, setHolding] = useState(false);
  const [splitOn, setSplitOn] = useState(false);
  const [split, setSplit] = useState(0.5);
  const [flat, setFlat] = useState(false);
  const slow = useDelayed(busy, 300);

  const result = data?.result ?? null;
  const bmp = image?.compareBitmap ?? null;
  const crop = settings?.crop;
  const showSplit = splitOn && desktop && mode === 'edit' && !cropMode;

  const compare = useMemo<CompareSpec | undefined>(() => {
    if (mode !== 'edit' || !result || !image || !crop || !bmp) return undefined;
    // The rect of the displayed result (its grid may lag the settings by a frame).
    const r = cropRect(image.width, image.height, result.width, result.height, crop);
    const sx = bmp.width / image.width;
    const sy = bmp.height / image.height;
    return {
      image: bmp,
      rect: { x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy },
      active: holding || showSplit,
      split: holding ? undefined : showSplit ? split : undefined,
    };
  }, [mode, result, image, crop, bmp, holding, showSplit, split]);

  const onRendererChange = useCallback((kind: RendererKind) => setFlat(kind === 'canvas2d'), []);

  const lowRes = mode === 'edit' && !!image && !!settings && pxPerStud(image.width, image.height, settings) < LOW_RES_PX_PER_STUD;

  const hold = (on: boolean) => setHolding(on);
  const onHoldKey = (e: KeyboardEvent, down: boolean) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!e.repeat) hold(down);
    }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: VIEWER_BG_CSS, color: '#fff', minHeight: 0 }}>
      {/* Summary row */}
      <Box
        sx={{
          flexShrink: 0,
          minHeight: 44,
          px: { xs: 1, md: 1.5 },
          display: 'flex',
          alignItems: 'center',
          gap: { xs: 0.5, md: 0.75 },
          bgcolor: VIEWER_BAR_CSS,
          overflowX: 'auto',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
        data-testid="summary"
      >
        {cropMode ? (
          <>
            <Typography variant="body2" sx={{ flex: 1, minWidth: 0, color: 'rgba(255,255,255,0.9)' }}>
              {t('viewer.cropHint')}
            </Typography>
            <Button size="small" variant="contained" onClick={() => setCropMode(false)} sx={{ flexShrink: 0 }}>
              {t('common.done')}
            </Button>
          </>
        ) : data ? (
          <>
            <SummaryChips data={data} />
            {flat && (
              <Tooltip title={t('viewer.flatHint')}>
                <Chip size="small" label={t('viewer.flat')} tabIndex={0} sx={{ height: 28, flexShrink: 0, bgcolor: 'rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.8)' }} />
              </Tooltip>
            )}
            {lowRes && (
              <Tooltip title={t('size.lowResBody')}>
                <Chip
                  size="small"
                  icon={<WarningAmber sx={{ '&&': { color: '#ffb74d' } }} />}
                  label={t('viewer.lowRes')}
                  tabIndex={0}
                  sx={{ height: 28, flexShrink: 0, bgcolor: 'rgba(255,152,0,0.18)', color: '#ffe0b2' }}
                />
              </Tooltip>
            )}
          </>
        ) : (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} variant="rounded" width={i === 0 ? 96 : 76} height={28} sx={{ bgcolor: 'rgba(255,255,255,0.08)', borderRadius: 4 }} />)
        )}
      </Box>

      {/* Mosaic */}
      <Box sx={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {slow && <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, zIndex: 1 }} aria-label={t('viewer.working')} />}
        {mode !== 'loading' && (
          <MosaicViewer
            ref={viewerRef}
            result={result}
            colors={data?.colors ?? []}
            base={data?.base.rgb ?? [108, 110, 104]}
            background={VIEWER_BG}
            compare={compare}
            showPanelGrid={grid}
            interaction={cropMode ? 'crop' : 'view'}
            fitPadding={desktop ? 20 : 10}
            onCropDrag={moveCrop}
            onCropZoom={zoomCrop}
            onRendererChange={onRendererChange}
            aria-label={result ? t('viewer.label', { w: result.width, h: result.height }) : t('viewer.labelEmpty')}
          />
        )}
        {(mode === 'loading' || !result) && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }} role="status" aria-live="polite">
            <Box sx={{ textAlign: 'center', px: 2 }}>
              <CircularProgress size={36} sx={{ color: 'rgba(255,255,255,0.85)' }} />
              <Typography variant="body2" sx={{ mt: 1.5, color: 'rgba(255,255,255,0.85)' }}>
                {mode === 'loading' ? (loadingName ? t('viewer.opening', { name: loadingName }) : t('viewer.openingShared')) : t('viewer.making')}
              </Typography>
            </Box>
          </Box>
        )}
      </Box>

      {/* Toolbar */}
      <Box
        role="toolbar"
        aria-label={t('viewer.toolbar')}
        sx={{ flexShrink: 0, height: 52, px: 1, display: 'flex', alignItems: 'center', gap: 0.5, bgcolor: VIEWER_BAR_CSS }}
      >
        <ToolButton label={t('viewer.fit')} onClick={() => viewerRef.current?.fit()}>
          <FitScreen />
        </ToolButton>
        <ToolButton label={t('viewer.zoomOut')} onClick={() => viewerRef.current?.zoomBy(1 / 1.4)}>
          <ZoomOut />
        </ToolButton>
        <ToolButton label={t('viewer.zoomIn')} onClick={() => viewerRef.current?.zoomBy(1.4)}>
          <ZoomIn />
        </ToolButton>
        <ToolButton label={t('viewer.panelGrid')} pressed={grid} onClick={() => setGrid((g) => !g)}>
          <GridOn />
        </ToolButton>

        {mode === 'edit' && (
          <>
            <Box sx={{ width: 8, flexShrink: 0 }} />
            <Button
              variant="outlined"
              size="small"
              startIcon={<Compare />}
              disabled={!bmp || !result || cropMode}
              aria-pressed={holding}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  // capture is a convenience
                }
                hold(true);
              }}
              onPointerUp={() => hold(false)}
              onPointerCancel={() => hold(false)}
              onLostPointerCapture={() => hold(false)}
              onKeyDown={(e) => onHoldKey(e, true)}
              onKeyUp={(e) => onHoldKey(e, false)}
              onBlur={() => hold(false)}
              onContextMenu={(e) => e.preventDefault()}
              data-testid="hold-compare"
              sx={{
                color: '#fff',
                borderColor: 'rgba(255,255,255,0.4)',
                whiteSpace: 'nowrap',
                touchAction: 'none',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                WebkitTouchCallout: 'none',
                bgcolor: holding ? 'rgba(255,255,255,0.18)' : 'transparent',
                '&:hover': { borderColor: '#fff', bgcolor: 'rgba(255,255,255,0.1)' },
                '&.Mui-disabled': { color: 'rgba(255,255,255,0.35)', borderColor: 'rgba(255,255,255,0.15)' },
              }}
            >
              {desktop ? t('viewer.holdCompare') : t('viewer.compareShort')}
            </Button>
            {desktop && (
              <ToolButton label={t('viewer.split')} pressed={splitOn} onClick={() => setSplitOn((v) => !v)}>
                <VerticalSplit />
              </ToolButton>
            )}
            {showSplit && (
              <Slider
                size="small"
                value={split}
                min={0}
                max={1}
                step={0.01}
                onChange={(_, v) => setSplit(v as number)}
                aria-label={t('viewer.splitPosition')}
                sx={{ width: 140, mx: 1.5, color: '#fff' }}
              />
            )}
          </>
        )}

        <Box sx={{ flex: 1 }} />
        {mode === 'edit' && (
          desktop ? (
            <Button size="small" startIcon={<AddPhotoAlternateOutlined />} onClick={newPhoto} sx={{ color: '#fff', whiteSpace: 'nowrap', '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' } }}>
              {t('viewer.newPhoto')}
            </Button>
          ) : (
            <ToolButton label={t('viewer.newPhoto')} onClick={newPhoto}>
              <AddPhotoAlternateOutlined />
            </ToolButton>
          )
        )}
      </Box>
    </Box>
  );
}
