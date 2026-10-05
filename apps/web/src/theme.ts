// MUI theme: light, friendly, high contrast; the viewer sits on a neutral dark grey so studs pop.

import { alpha, createTheme } from '@mui/material/styles';
import type { Rgb } from '@photobrick/engine';

/** Backdrop around the mosaic in the viewer (also the viewer's `background` prop). */
export const VIEWER_BG: Rgb = [38, 40, 45];
export const VIEWER_BG_CSS = `rgb(${VIEWER_BG.join(',')})`;
/** Bars above and below the viewer canvas, a step lighter than the backdrop. */
export const VIEWER_BAR_CSS = '#2f3137';

const brand = '#c63a2b'; // brick red; white text on it has a 5.1:1 contrast ratio
const ink = '#1c1d22';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: brand, dark: '#a42e21', light: '#e0604f', contrastText: '#ffffff' },
    secondary: { main: '#1f5fae', contrastText: '#ffffff' },
    warning: { main: '#b85c00' },
    background: { default: '#f5f4f1', paper: '#ffffff' },
    text: { primary: ink, secondary: '#55575f' },
    divider: 'rgba(28, 29, 34, 0.12)',
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: 'Roboto, system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif',
    h1: { fontWeight: 700, letterSpacing: '-0.02em' },
    h2: { fontWeight: 700, letterSpacing: '-0.015em' },
    h3: { fontWeight: 700, letterSpacing: '-0.01em' },
    h4: { fontWeight: 700 },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 700 },
    button: { textTransform: 'none', fontWeight: 500, letterSpacing: 0 },
    overline: { fontWeight: 700, letterSpacing: '0.08em', lineHeight: 2 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        'html, body, #root': { height: '100%' },
        body: { overscrollBehaviorY: 'none' },
        // One clear, consistent keyboard focus ring.
        ':focus-visible': { outline: `3px solid ${alpha('#1f5fae', 0.9)}`, outlineOffset: 2 },
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': { transitionDuration: '0.01ms !important', animationDuration: '0.01ms !important' },
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 999, paddingInline: 18 }, sizeLarge: { paddingBlock: 12, paddingInline: 28, fontSize: '1.05rem' } },
    },
    MuiButtonBase: { styleOverrides: { root: { '&.Mui-focusVisible': { outline: `3px solid ${alpha('#1f5fae', 0.9)}`, outlineOffset: 2 } } } },
    MuiTab: { styleOverrides: { root: { minWidth: 0, fontWeight: 600, letterSpacing: '0.04em' } } },
    MuiTooltip: { defaultProps: { arrow: true, enterDelay: 400 } },
    MuiChip: { styleOverrides: { root: { fontWeight: 500 } } },
    MuiPaper: { styleOverrides: { rounded: { borderRadius: 14 } } },
    MuiSlider: { styleOverrides: { valueLabel: { fontSize: 12, fontWeight: 600 } } },
    MuiTableCell: { styleOverrides: { sizeSmall: { paddingBlock: 6 } } },
  },
});
