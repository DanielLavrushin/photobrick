// Shared contracts for the PhotoBrick engine. Everything here is plain data so it can cross a
// worker boundary (structured clone) and be stored in JSON.

/** An sRGB 8-bit colour. */
export type Rgb = readonly [r: number, g: number, b: number];

/** One buildable colour of the mosaic part (default: 98138 Tile Round 1 x 1). */
export interface PaletteColor {
  /** Rebrickable colour id. The stable key everywhere (grids, projects, share links). */
  id: number;
  /** Rebrickable colour name, e.g. "Dark Bluish Gray". */
  name: string;
  /** Catalogue colour as '#RRGGBB' (Rebrickable). */
  hex: string;
  rgb: Rgb;
  /** Stable 2-character code printed on instructions (unique within the palette, never reused). */
  code: string;
  /** core = common; extended = produced but less common; rare = produced in tiny quantities. */
  tier: 'core' | 'extended' | 'rare';
  /** Enabled in the default palette. */
  defaultEnabled: boolean;
  /** BrickLink colour id (differs from Rebrickable ids), null if unknown. */
  blId: number | null;
  blName: string | null;
  /** LEGO's own colour id, null if unknown. */
  legoId: number | null;
  /** Preferred LEGO element id for Pick a Brick orders (the one actually sold), null if none. */
  elementId: string | null;
  /** Sold on LEGO Pick a Brick (DK snapshot) at the time the palette was built. */
  pab: boolean;
  /** Pick a Brick unit price in DKK / EUR (snapshot), null if unknown. */
  pabDkk: number | null;
  pabEur: number | null;
  /** BrickLink 6-month average sold price for new parts in EUR, null if not sampled. */
  blEur: number | null;
}

export interface Palette {
  /** Rebrickable part number, e.g. '98138'. */
  part: string;
  partName: string;
  /** BrickLink item number for the part (e.g. 6141 on Rebrickable is 4073 on BrickLink). */
  blPart: string;
  /** Immutable revision id, e.g. '2026-09-23'. Bump when colours/codes/ids change. */
  rev: string;
  /** Date the price snapshot was taken (ISO date). */
  pricesAsOf: string;
  /** Fallback BrickLink price per piece in EUR when a colour has no sample. */
  blEurDefault: number;
  /** Required attribution text for the Rebrickable data. */
  attribution: string;
  colors: PaletteColor[];
}

/** Base the round tiles are mounted on. Its colour shows in the ~25% gaps between round tiles. */
export interface BaseOption {
  id: string;
  /** i18n key suffix / English label. */
  label: string;
  /** Rebrickable colour id of the base plate. */
  colorId: number;
  rgb: Rgb;
  /** Rebrickable part number of the base (e.g. '91405' Plate 16 x 16). */
  part: string;
  /** Studs covered by one base piece along each side (16 for 91405, 48 for the 11024 baseplate). */
  studsPerPiece: number;
}

// ---------------------------------------------------------------------------------------------
// Input image

/** Decoded, EXIF-oriented, sRGB working image (at most ~2048 px on the long side). */
export interface WorkingImage {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, sRGB, straight alpha (like ImageData.data). */
  data: Uint8ClampedArray;
}

// ---------------------------------------------------------------------------------------------
// Settings

/** Mosaic size in 16x16-stud panels (the LEGO Art unit). Grid = 16*w x 16*h studs. */
export interface SizeSpec {
  panelsW: number;
  panelsH: number;
}

/**
 * Crop window inside the (EXIF-oriented) source image, always with the grid's aspect ratio.
 * cx, cy: centre in normalised source coordinates [0,1]. zoom >= 1: 1 = the largest window of
 * the grid's aspect that fits in the image; 2 = half that width. The engine clamps the window
 * so it never leaves the image.
 */
export interface Crop {
  cx: number;
  cy: number;
  zoom: number;
}

export interface Adjust {
  /** Exposure in EV stops, applied in linear light. Default 0, range -2..2. */
  exposure: number;
  /** Contrast around mid lightness in OKLab. Default 1, range 0.5..1.5. */
  contrast: number;
  /** Chroma multiplier in OKLab. Default 1, range 0..1.5. */
  saturation: number;
  /** Unsharp amount at grid resolution (sigma = 1 stud). Default 0.3, range 0..1. */
  detail: number;
}

/**
 * natural   - skin-aware matching + close-pair mixing (default; best for portraits)
 * faithful  - hue-weighted OKLab (okhw2) + constrained Floyd-Steinberg
 * sepia     - 8 warm tones, lightness-first
 * greyscale - Black / Dark Bluish Gray / Light Bluish Gray / White, lightness-first
 */
export type StylePreset = 'natural' | 'faithful' | 'sepia' | 'greyscale';

export interface MosaicSettings {
  size: SizeSpec;
  crop: Crop;
  adjust: Adjust;
  style: StylePreset;
  /**
   * 0..1 texture strength. natural: close-pair mixing amount (0 = off);
   * faithful/sepia/greyscale: constrained Floyd-Steinberg strength (0 = off). Default 0.5.
   */
  dither: number;
  /** 0..1 skin protection strength (natural only). Default 1. */
  skinProtect: number;
  /** Remove isolated single studs when it costs little. Default true. */
  despeckle: boolean;
  /** Merge colours used fewer than this many times into each cell's next-best colour. 0 = off. Default 10. */
  minLot: number;
  /** Use at most this many colours (greedy elimination). null = no limit. */
  maxColors: number | null;
  /** Rebrickable colour ids allowed; null = all palette colours with defaultEnabled. */
  enabledColors: number[] | null;
  /** BaseOption.id */
  base: string;
}

// ---------------------------------------------------------------------------------------------
// Output

/**
 * The generated mosaic. The grid is the source of truth: projects and share links store it,
 * never the photo. cells[i] indexes colorIds (a local colour table), row-major, i = y*width + x.
 */
export interface MosaicResult {
  width: number;
  height: number;
  cells: Uint8Array;
  /** Local colour table: index -> Rebrickable colour id. At most 255 entries. */
  colorIds: number[];
}

export interface GenerateTimings {
  resampleMs: number;
  adjustMs: number;
  quantizeMs: number;
  postMs: number;
  totalMs: number;
}

/** One line of the bill of materials (parts list). */
export interface BomLine {
  colorId: number;
  name: string;
  code: string;
  hex: string;
  /** Studs of this colour in the mosaic. */
  count: number;
  /** Extra pieces added as spares. */
  spares: number;
  /** count + spares: what to order. */
  total: number;
  blId: number | null;
  elementId: string | null;
  pab: boolean;
  tier: PaletteColor['tier'];
}

export interface CostEstimate {
  /** Sum over lines of total * price, EUR. */
  bricklinkEur: number;
  pickABrickEur: number | null;
  pickABrickDkk: number | null;
  /** Lines without a Pick a Brick offer (must be bought elsewhere). */
  notOnPab: number[];
  pricesAsOf: string;
}

/** One 16x16 panel of the mosaic, for panel-by-panel instructions. */
export interface Panel {
  /** Panel column / row (0-based). */
  px: number;
  py: number;
  /** Human label, e.g. 'A1' (letter = row, number = column). */
  label: string;
  /** 256 local colour indices (row-major, 16 x 16), same table as MosaicResult.colorIds. */
  cells: Uint8Array;
  /** Local colour index -> count within this panel (only non-zero entries). */
  counts: Map<number, number>;
}
