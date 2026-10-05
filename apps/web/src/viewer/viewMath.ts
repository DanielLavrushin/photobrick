// Pure view arithmetic for the mosaic viewer. A view maps grid coordinates (studs) to CSS pixels
// of the viewer: screen = origin + stud * scale.

export interface View {
  /** CSS px per stud. */
  scale: number;
  /** CSS px offset of the grid's top-left corner from the viewer's top-left corner. */
  ox: number;
  oy: number;
}

export interface ZoomLimits {
  /** Smallest allowed scale (CSS px per stud). */
  min: number;
  /** Largest allowed scale. */
  max: number;
}

/** Studs never get bigger than this on screen unless the fitted view is already bigger. */
export const MAX_CSS_PX_PER_STUD = 96;

/**
 * A fitted view snaps studs to a whole number of device pixels when that shrinks them by at most
 * this fraction: at a fractional pitch the gaps beat against the pixel grid (moire), at a whole one
 * every stud is drawn identically.
 */
export const FIT_SNAP_MAX_LOSS = 0.1;

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/**
 * The view that shows the whole grid centred in a cssW x cssH viewer, with at least `padding` CSS px
 * free on every side. With a `pixelRatio` (device px per CSS px) the origin lands on a device pixel
 * and the stud pitch on a whole number of device pixels when that costs at most FIT_SNAP_MAX_LOSS.
 * Degenerate sizes give a finite view (scale > 0) rather than NaN or Infinity.
 */
export function fitView(gridW: number, gridH: number, cssW: number, cssH: number, padding = 0, pixelRatio = 0): View {
  if (gridW <= 0 || gridH <= 0) return { scale: 1, ox: 0, oy: 0 };
  const availW = Math.max(1, cssW - 2 * padding);
  const availH = Math.max(1, cssH - 2 * padding);
  let scale = Math.min(availW / gridW, availH / gridH);
  if (!(pixelRatio > 0)) return { scale, ox: (cssW - gridW * scale) / 2, oy: (cssH - gridH * scale) / 2 };
  const device = scale * pixelRatio;
  const whole = Math.floor(device);
  if (whole >= 1 && whole >= device * (1 - FIT_SNAP_MAX_LOSS)) scale = whole / pixelRatio;
  return {
    scale,
    ox: Math.round(((cssW - gridW * scale) / 2) * pixelRatio) / pixelRatio,
    oy: Math.round(((cssH - gridH * scale) / 2) * pixelRatio) / pixelRatio,
  };
}

/** Zoom range for a grid in a viewer: from the fitted view up to MAX_CSS_PX_PER_STUD. */
export function zoomLimits(gridW: number, gridH: number, cssW: number, cssH: number, padding = 0, pixelRatio = 0): ZoomLimits {
  const min = fitView(gridW, gridH, cssW, cssH, padding, pixelRatio).scale;
  return { min, max: Math.max(min, MAX_CSS_PX_PER_STUD) };
}

/**
 * Multiplies the scale by `factor` (clamped to the limits) while keeping the point under (cx, cy)
 * (CSS px in the viewer) fixed on screen.
 */
export function zoomAt(view: View, factor: number, cx: number, cy: number, limits: ZoomLimits): View {
  const scale = clamp(view.scale * factor, limits.min, limits.max);
  const k = scale / view.scale;
  return { scale, ox: cx - (cx - view.ox) * k, oy: cy - (cy - view.oy) * k };
}

/**
 * Keeps the mosaic reachable. Along each axis, a mosaic smaller than the viewer (minus `margin` on
 * both sides) stays entirely inside it; a larger one can be panned only until its edge reaches the
 * margin, so an edge never moves further in than `margin` and the mosaic never leaves the screen.
 */
export function clampView(view: View, gridW: number, gridH: number, cssW: number, cssH: number, margin = 0): View {
  return {
    scale: view.scale,
    ox: clampAxis(view.ox, gridW * view.scale, cssW, margin),
    oy: clampAxis(view.oy, gridH * view.scale, cssH, margin),
  };
}

function clampAxis(o: number, size: number, viewport: number, margin: number): number {
  const a = margin;
  const b = viewport - margin - size;
  return clamp(o, Math.min(a, b), Math.max(a, b));
}

/** The stud under (x, y) CSS px, or null when the point is outside the grid. */
export function screenToCell(view: View, x: number, y: number, gridW: number, gridH: number): { x: number; y: number } | null {
  const cx = Math.floor((x - view.ox) / view.scale);
  const cy = Math.floor((y - view.oy) / view.scale);
  if (cx < 0 || cy < 0 || cx >= gridW || cy >= gridH) return null;
  return { x: cx, y: cy };
}

export function sameView(a: View, b: View): boolean {
  return a.scale === b.scale && a.ox === b.ox && a.oy === b.oy;
}
