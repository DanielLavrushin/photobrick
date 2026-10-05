// Small building blocks shared by the editor tabs.

import Box from '@mui/material/Box';
import Slider from '@mui/material/Slider';
import Typography from '@mui/material/Typography';
import type { Rgb } from '@photobrick/engine';
import { useId, type ReactNode } from 'react';
import { rgbCss } from '../../lib/palette.ts';

export function Section({ title, action, children, first = false }: { title?: string; action?: ReactNode; children: ReactNode; first?: boolean }) {
  return (
    <Box component="section" sx={{ px: 2, pt: first ? 2 : 2.5, pb: 1 }}>
      {(title || action) && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
          {title && (
            <Typography variant="overline" component="h2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
              {title}
            </Typography>
          )}
          {action}
        </Box>
      )}
      {children}
    </Box>
  );
}

export interface SettingSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
  help?: string;
  marks?: { value: number }[];
  testId?: string;
}

/** Label + current value on one line, the slider under it, optional help text. */
export function SettingSlider({ label, value, min, max, step, format, onChange, disabled, help, marks, testId }: SettingSliderProps) {
  const id = useId();
  return (
    <Box sx={{ mb: 1.5, opacity: disabled ? 0.55 : 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1 }}>
        <Typography id={id} variant="body2" sx={{ fontWeight: 500 }}>
          {label}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }} aria-hidden="true">
          {format(value)}
        </Typography>
      </Box>
      <Slider
        size="small"
        value={value}
        min={min}
        max={max}
        step={step}
        marks={marks}
        disabled={disabled}
        onChange={(_, v) => onChange(v as number)}
        getAriaValueText={format}
        slotProps={{ input: { 'aria-labelledby': id, ...(testId ? { 'data-testid': testId } : {}) } as Record<string, string> }}
        sx={{ py: 1.25, mt: 0.25 }}
      />
      {help && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: -0.5, lineHeight: 1.4 }}>
          {help}
        </Typography>
      )}
    </Box>
  );
}

export function Swatch({ rgb, size = 20, title }: { rgb: Rgb; size?: number; title?: string }) {
  return (
    <Box
      component="span"
      title={title}
      aria-hidden={title ? undefined : true}
      sx={{
        display: 'inline-block',
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: '50%',
        bgcolor: rgbCss(rgb),
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.18), inset 0 -2px 3px rgba(0,0,0,0.12)',
        verticalAlign: 'middle',
      }}
    />
  );
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <Box
      component="span"
      sx={{ fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace', fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.04em', color: 'text.secondary' }}
    >
      {children}
    </Box>
  );
}
