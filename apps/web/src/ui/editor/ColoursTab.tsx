import RestartAlt from '@mui/icons-material/RestartAlt';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtInt } from '../../lib/format.ts';
import { DEFAULT_ENABLED_IDS, enabledIds, PALETTE } from '../../lib/palette.ts';
import { useApp } from '../../state/store.ts';
import { useMosaicData } from '../useMosaicData.ts';
import { Code, Section, SettingSlider, Swatch } from './parts.tsx';

/** Slider position that means "no limit" (right of 40). */
const MAX_COLORS_OFF = 41;
const MIN_ENABLED = 2;

export function ColoursTab() {
  const { t } = useTranslation();
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const data = useMosaicData();
  const counts = useMemo(() => new Map(data?.bom.map((l) => [l.colorId, l.count]) ?? []), [data]);
  if (!settings) return null;

  const enabled = enabledIds(settings.enabledColors);
  const isDefault = settings.enabledColors === null;
  const toggle = (id: number, on: boolean) => {
    const next = new Set(enabled);
    if (on) next.add(id);
    else next.delete(id);
    if (next.size < MIN_ENABLED) return;
    const ids = PALETTE.colors.filter((c) => next.has(c.id)).map((c) => c.id);
    const same = ids.length === DEFAULT_ENABLED_IDS.length && ids.every((id2, i) => id2 === DEFAULT_ENABLED_IDS[i]);
    setSettings({ enabledColors: same ? null : ids });
  };
  const fixedStyle = settings.style === 'sepia' || settings.style === 'greyscale';

  return (
    <>
      <Section title={t('colours.limitsTitle')} first>
        <SettingSlider
          label={t('colours.maxColours')}
          value={settings.maxColors ?? MAX_COLORS_OFF}
          min={2}
          max={MAX_COLORS_OFF}
          step={1}
          format={(v) => (v >= MAX_COLORS_OFF ? t('common.off') : String(v))}
          onChange={(v) => setSettings({ maxColors: v >= MAX_COLORS_OFF ? null : v })}
          help={t('colours.maxColoursHelp')}
          testId="slider-max-colours"
        />
        <SettingSlider
          label={t('colours.minLot')}
          value={settings.minLot}
          min={0}
          max={30}
          step={1}
          format={(v) => (v <= 1 ? t('common.off') : t('colours.minLotValue', { count: v }))}
          onChange={(v) => setSettings({ minLot: v })}
          help={t('colours.minLotHelp')}
        />
      </Section>

      <Section
        title={t('colours.paletteTitle', { on: enabled.size, total: PALETTE.colors.length })}
        action={
          <Button size="small" startIcon={<RestartAlt />} disabled={isDefault} onClick={() => setSettings({ enabledColors: null })}>
            {t('colours.resetDefault')}
          </Button>
        }
      >
        {fixedStyle && (
          <Alert severity="info" sx={{ mb: 1.5 }}>
            {t('colours.fixedStyle', { style: t(`look.style.${settings.style}.name`) })}
          </Alert>
        )}
        <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }} aria-label={t('colours.listLabel')}>
          {PALETTE.colors.map((c) => {
            const on = enabled.has(c.id);
            const used = counts.get(c.id);
            return (
              <Box
                component="li"
                key={c.id}
                sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 0.75, borderBottom: 1, borderColor: 'divider', opacity: on ? 1 : 0.6 }}
              >
                <Swatch rgb={c.rgb} size={26} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                    <Code>{c.code}</Code>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {c.name}
                    </Typography>
                    {c.tier === 'rare' && <Chip label={t('colours.rare')} size="small" variant="outlined" color="warning" sx={{ height: 20, fontSize: 11 }} />}
                    {!c.pab && <Chip label={t('colours.notOnPab')} size="small" variant="outlined" sx={{ height: 20, fontSize: 11 }} />}
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {used ? t('colours.used', { n: fmtInt(used) }) : on ? t('colours.unused') : t('colours.off')}
                  </Typography>
                </Box>
                <Switch
                  edge="end"
                  checked={on}
                  onChange={(e) => toggle(c.id, e.target.checked)}
                  disabled={on && enabled.size <= MIN_ENABLED}
                  slotProps={{ input: { 'aria-label': t('colours.toggle', { name: c.name }) } }}
                />
              </Box>
            );
          })}
        </Box>
      </Section>
    </>
  );
}
