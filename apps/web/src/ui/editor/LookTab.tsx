import RestartAlt from '@mui/icons-material/RestartAlt';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { BASES, DEFAULT_ADJUST, GREYSCALE_COLOR_IDS, SEPIA_COLOR_IDS, type Adjust, type Rgb, type StylePreset } from '@photobrick/engine';
import { useTranslation } from 'react-i18next';
import { fmtPct, fmtSigned } from '../../lib/format.ts';
import { colorById, UNKNOWN_RGB } from '../../lib/palette.ts';
import { useApp } from '../../state/store.ts';
import { Section, SettingSlider, Swatch } from './parts.tsx';

const STYLES: readonly StylePreset[] = ['natural', 'faithful', 'sepia', 'greyscale'];

const rgbOf = (id: number): Rgb => colorById(id)?.rgb ?? UNKNOWN_RGB;
// A 3 x 3 patch of studs in each style's typical colours.
const PREVIEW: Record<StylePreset, Rgb[]> = {
  natural: [78, 92, 84, 92, 84, 70, 322, 70, 308].map(rgbOf),
  faithful: [4, 25, 14, 29, 10, 27, 85, 1, 322].map(rgbOf),
  sepia: [SEPIA_COLOR_IDS[6], SEPIA_COLOR_IDS[5], SEPIA_COLOR_IDS[4], SEPIA_COLOR_IDS[5], SEPIA_COLOR_IDS[4], SEPIA_COLOR_IDS[3], SEPIA_COLOR_IDS[4], SEPIA_COLOR_IDS[2], SEPIA_COLOR_IDS[1]].map(rgbOf),
  greyscale: [GREYSCALE_COLOR_IDS[3], GREYSCALE_COLOR_IDS[2], GREYSCALE_COLOR_IDS[2], GREYSCALE_COLOR_IDS[2], GREYSCALE_COLOR_IDS[1], GREYSCALE_COLOR_IDS[1], GREYSCALE_COLOR_IDS[1], GREYSCALE_COLOR_IDS[0], GREYSCALE_COLOR_IDS[0]].map(rgbOf),
};

function StyleCard({ style, selected, onClick }: { style: StylePreset; selected: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <ButtonBase
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      data-testid={`style-${style}`}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.25,
        width: '100%',
        textAlign: 'left',
        p: 1.25,
        borderRadius: 2.5,
        border: 2,
        borderColor: selected ? 'primary.main' : 'divider',
        bgcolor: selected ? 'rgba(198, 58, 43, 0.06)' : 'background.paper',
        '&:hover': { borderColor: selected ? 'primary.main' : 'text.secondary' },
      }}
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 13px)', gap: '1px', p: '3px', flexShrink: 0, mt: 0.25, borderRadius: 1, bgcolor: '#6c6e68' }} aria-hidden="true">
        {PREVIEW[style].map((rgb, i) => (
          <Swatch key={i} rgb={rgb} size={13} />
        ))}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography component="span" sx={{ display: 'block', fontWeight: 700, lineHeight: 1.3 }}>
          {t(`look.style.${style}.name`)}
        </Typography>
        <Typography component="span" variant="body2" color="text.secondary" sx={{ display: 'block', lineHeight: 1.35 }}>
          {t(`look.style.${style}.desc`)}
        </Typography>
      </Box>
    </ButtonBase>
  );
}

export function LookTab() {
  const { t } = useTranslation();
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  if (!settings) return null;
  const setAdjust = (patch: Partial<Adjust>) => setSettings((s) => ({ ...s, adjust: { ...s.adjust, ...patch } }));
  const a = settings.adjust;
  const adjusted = a.exposure !== DEFAULT_ADJUST.exposure || a.contrast !== DEFAULT_ADJUST.contrast || a.saturation !== DEFAULT_ADJUST.saturation || a.detail !== DEFAULT_ADJUST.detail;
  const natural = settings.style === 'natural';

  return (
    <>
      <Section title={t('look.styleTitle')} first>
        <Box role="radiogroup" aria-label={t('look.styleTitle')} sx={{ display: 'grid', gap: 1 }}>
          {STYLES.map((s) => (
            <StyleCard key={s} style={s} selected={settings.style === s} onClick={() => setSettings({ style: s })} />
          ))}
        </Box>
      </Section>

      <Section title={t('look.matchingTitle')}>
        <SettingSlider
          label={t('look.texture')}
          value={settings.dither}
          min={0}
          max={1}
          step={0.05}
          format={(v) => (v === 0 ? t('common.off') : fmtPct(v))}
          onChange={(v) => setSettings({ dither: v })}
          help={natural ? t('look.textureHelpNatural') : t('look.textureHelp')}
          testId="slider-texture"
        />
        <SettingSlider
          label={t('look.skin')}
          value={settings.skinProtect}
          min={0}
          max={1}
          step={0.05}
          disabled={!natural}
          format={(v) => (v === 0 ? t('common.off') : fmtPct(v))}
          onChange={(v) => setSettings({ skinProtect: v })}
          help={natural ? t('look.skinHelp') : t('look.skinNaturalOnly')}
        />
        <FormControlLabel
          control={<Switch checked={settings.despeckle} onChange={(e) => setSettings({ despeckle: e.target.checked })} />}
          label={t('look.despeckle')}
        />
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: -0.5, ml: 6 }}>
          {t('look.despeckleHelp')}
        </Typography>
      </Section>

      <Section
        title={t('look.adjustTitle')}
        action={
          <Button size="small" startIcon={<RestartAlt />} disabled={!adjusted} onClick={() => setSettings((s) => ({ ...s, adjust: { ...DEFAULT_ADJUST } }))}>
            {t('common.reset')}
          </Button>
        }
      >
        <SettingSlider
          label={t('look.exposure')}
          value={a.exposure}
          min={-2}
          max={2}
          step={0.1}
          marks={[{ value: 0 }]}
          format={(v) => t('look.ev', { v: fmtSigned(v) })}
          onChange={(v) => setAdjust({ exposure: Math.round(v * 10) / 10 })}
        />
        <SettingSlider label={t('look.contrast')} value={a.contrast} min={0.5} max={1.5} step={0.05} marks={[{ value: 1 }]} format={fmtPct} onChange={(v) => setAdjust({ contrast: v })} />
        <SettingSlider label={t('look.saturation')} value={a.saturation} min={0} max={1.5} step={0.05} marks={[{ value: 1 }]} format={fmtPct} onChange={(v) => setAdjust({ saturation: v })} />
        <SettingSlider label={t('look.detail')} value={a.detail} min={0} max={1} step={0.05} format={(v) => (v === 0 ? t('common.off') : fmtPct(v))} onChange={(v) => setAdjust({ detail: v })} help={t('look.detailHelp')} />
      </Section>

      <Section title={t('look.baseTitle')}>
        <FormControl fullWidth size="small">
          <InputLabel id="base-label">{t('look.base')}</InputLabel>
          <Select
            labelId="base-label"
            label={t('look.base')}
            value={settings.base}
            onChange={(e) => setSettings({ base: e.target.value })}
            renderValue={(id) => {
              const b = BASES.find((x) => x.id === id) ?? BASES[0];
              return (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Swatch rgb={b.rgb} size={18} />
                  {t(`bases.${b.id}`)}
                </Box>
              );
            }}
          >
            {BASES.map((b) => (
              <MenuItem key={b.id} value={b.id}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                  <Swatch rgb={b.rgb} size={22} />
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {t(`bases.${b.id}`)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {b.studsPerPiece === 16 ? t('look.basePlate16', { part: b.part }) : t('look.baseplate48', { part: b.part })}
                    </Typography>
                  </Box>
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
          {t('look.baseHelp')}
        </Typography>
      </Section>
    </>
  );
}
