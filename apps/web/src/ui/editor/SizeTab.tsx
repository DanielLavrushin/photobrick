import Add from '@mui/icons-material/Add';
import Remove from '@mui/icons-material/Remove';
import RestartAlt from '@mui/icons-material/RestartAlt';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { gridSize, LEGO_ART_SIZE, physicalSizeCm, SIZE_PRESETS, suggestSize, type SizeSpec } from '@photobrick/engine';
import { useTranslation } from 'react-i18next';
import { fmtEur, fmtInt, fmtOne } from '../../lib/format.ts';
import { PALETTE } from '../../lib/palette.ts';
import { maxCropZoom, pxPerStud, useApp } from '../../state/store.ts';
import { useMosaicData } from '../useMosaicData.ts';
import { Section, SettingSlider } from './parts.tsx';

const MAX_PANELS = 10;

const sameSize = (a: SizeSpec, b: SizeSpec): boolean => a.panelsW === b.panelsW && a.panelsH === b.panelsH;

function SizeCard({ title, subtitle, size, eurPerStud, selected, onClick, testId, wide = false }: { title: string; subtitle?: string; size: SizeSpec; eurPerStud: number; selected: boolean; onClick: () => void; testId: string; wide?: boolean }) {
  const { t } = useTranslation();
  const { width, height } = gridSize(size);
  const cm = physicalSizeCm(size);
  const studs = width * height;
  const lines = [
    t('size.cardPanels', { w: size.panelsW, h: size.panelsH }),
    t('size.cardStuds', { w: width, h: height }),
    t('size.cardCm', { w: fmtOne(cm.w), h: fmtOne(cm.h) }),
    `${t('size.cardPieces', { n: fmtInt(studs) })} · ${t('summary.cost', { amount: fmtEur(studs * eurPerStud) })}`,
  ];
  return (
    <ButtonBase
      onClick={onClick}
      aria-pressed={selected}
      data-testid={testId}
      sx={{
        display: 'block',
        gridColumn: wide ? '1 / -1' : undefined,
        textAlign: 'left',
        width: '100%',
        px: 1.5,
        py: 1.25,
        borderRadius: 2.5,
        border: 2,
        borderColor: selected ? 'primary.main' : 'divider',
        bgcolor: selected ? 'rgba(198, 58, 43, 0.06)' : 'background.paper',
        transition: 'border-color 120ms ease, background-color 120ms ease',
        '&:hover': { borderColor: selected ? 'primary.main' : 'text.secondary' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, mb: 0.5 }}>
        <Typography component="span" sx={{ fontWeight: 700, fontSize: '1.1rem', lineHeight: 1.25, color: selected ? 'primary.dark' : 'text.primary' }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography component="span" variant="body2" color="text.secondary" noWrap>
            {subtitle}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: wide ? 'repeat(2, minmax(0, 1fr))' : '1fr', columnGap: 2 }}>
        {lines.map((line, i) => (
          <Typography key={i} variant="body2" component="span" noWrap sx={{ display: 'block', lineHeight: 1.5, color: i === 0 ? 'text.primary' : 'text.secondary', fontWeight: i === 0 ? 500 : 400 }}>
            {line}
          </Typography>
        ))}
      </Box>
    </ButtonBase>
  );
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const { t } = useTranslation();
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'space-between' }} role="group" aria-label={label}>
      <Typography variant="body2" sx={{ fontWeight: 500, minWidth: 64 }}>
        {label}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <IconButton size="small" onClick={() => onChange(value - 1)} disabled={value <= 1} aria-label={t('size.decrease', { what: label })} sx={{ border: 1, borderColor: 'divider' }}>
          <Remove fontSize="small" />
        </IconButton>
        <Typography component="output" aria-live="polite" sx={{ minWidth: 88, textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
          {t('size.panelsCount', { count: value })}
        </Typography>
        <IconButton size="small" onClick={() => onChange(value + 1)} disabled={value >= MAX_PANELS} aria-label={t('size.increase', { what: label })} sx={{ border: 1, borderColor: 'divider' }}>
          <Add fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
}

export function SizeTab() {
  const { t } = useTranslation();
  const image = useApp((s) => s.image);
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const cropMode = useApp((s) => s.cropMode);
  const setCropMode = useApp((s) => s.setCropMode);
  const setCropZoom = useApp((s) => s.setCropZoom);
  const resetCrop = useApp((s) => s.resetCrop);
  const data = useMosaicData();
  if (!image || !settings) return null;

  // Price per stud of the current colour mix (spares included), applied to the other sizes.
  const eurPerStud = data && data.studs > 0 ? data.cost.bricklinkEur / data.studs : PALETTE.blEurDefault * 1.03;
  const cards = [
    ...SIZE_PRESETS.map((p) => ({ id: p.id, title: t(`size.preset.${p.id}`), subtitle: t(`size.presetName.${p.id}`), size: suggestSize(image.width, image.height, p.id) })),
    { id: 'art', title: t('size.artTitle'), subtitle: undefined, size: { ...LEGO_ART_SIZE } },
  ];
  const setSize = (size: SizeSpec) => setSettings({ size: { panelsW: Math.min(MAX_PANELS, Math.max(1, size.panelsW)), panelsH: Math.min(MAX_PANELS, Math.max(1, size.panelsH)) } });
  const { width: gw, height: gh } = gridSize(settings.size);
  const cm = physicalSizeCm(settings.size);
  const ppS = pxPerStud(image.width, image.height, settings);
  const maxZoom = maxCropZoom(image.width, image.height, settings);
  const zoom = Math.min(settings.crop.zoom, maxZoom);
  // Log scale: equal slider steps are equal zoom ratios.
  const toSlider = (z: number) => (maxZoom > 1 ? Math.log(z) / Math.log(maxZoom) : 0);
  const cropChanged = settings.crop.zoom !== 1 || Math.abs(settings.crop.cx - 0.5) > 1e-6 || Math.abs(settings.crop.cy - 0.5) > 1e-6;

  return (
    <>
      <Section title={t('size.presetsTitle')} first>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.25 }}>
          {cards.map((c) => (
            <SizeCard
              key={c.id}
              testId={`size-${c.id}`}
              title={c.title}
              subtitle={c.subtitle}
              size={c.size}
              eurPerStud={eurPerStud}
              selected={sameSize(c.size, settings.size)}
              onClick={() => setSize(c.size)}
              wide={c.id === 'art'}
            />
          ))}
        </Box>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
          {t('size.presetsHelp')}
        </Typography>
      </Section>

      <Section title={t('size.customTitle')}>
        <Box sx={{ display: 'grid', gap: 1 }}>
          <Stepper label={t('size.width')} value={settings.size.panelsW} onChange={(v) => setSize({ ...settings.size, panelsW: v })} />
          <Stepper label={t('size.height')} value={settings.size.panelsH} onChange={(v) => setSize({ ...settings.size, panelsH: v })} />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t('size.customSummary', { w: gw, h: gh, cw: fmtOne(cm.w), ch: fmtOne(cm.h), n: fmtInt(gw * gh) })}
        </Typography>
      </Section>

      <Section title={t('size.cropTitle')}>
        <FormControlLabel
          control={<Switch checked={cropMode} onChange={(e) => setCropMode(e.target.checked)} />}
          label={t('size.adjustCrop')}
          sx={{ mb: 0.5 }}
        />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {cropMode ? t('size.cropHelpOn') : t('size.cropHelpOff')}
        </Typography>
        <SettingSlider
          label={t('size.zoom')}
          value={toSlider(zoom)}
          min={0}
          max={1}
          step={0.001}
          disabled={maxZoom <= 1.001}
          format={(v) => t('size.zoomValue', { z: (maxZoom ** v).toFixed(1) })}
          onChange={(v) => setCropZoom(maxZoom ** v)}
        />
        <Button startIcon={<RestartAlt />} onClick={resetCrop} disabled={!cropChanged} size="small">
          {t('size.resetCrop')}
        </Button>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
          {t('size.photoInfo', { w: image.width, h: image.height, p: fmtOne(ppS) })}
        </Typography>
        {ppS < 2 && (
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            {t('size.lowResBody')}
          </Alert>
        )}
      </Section>
    </>
  );
}
