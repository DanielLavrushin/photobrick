// @photobrick/engine public API. See docs/ARCHITECTURE.md ("Engine public API").

export type * from './types.ts';

// constants, presets, palette
export { STUD_MM, PANEL_STUDS, MAX_GRID_SIDE, BASES, DEFAULT_BASE_ID, baseById, SIZE_PRESETS, LEGO_ART_SIZE, suggestSize, defaultSettings } from './presets.ts';
export type { SizePreset, SizePresetId } from './presets.ts';
export { DEFAULT_PALETTE, loadPalette, PaletteError } from './palette/index.ts';

// colour
export { SRGB_TO_LINEAR, linearToSrgb8, linToOklab, oklabToLin, hueDeg, hexToRgb } from './color.ts';

// pipeline
export { gridSize, cropRect, resampleToGrid, MAX_ZOOM } from './resample.ts';
export { DEFAULT_ADJUST, applyAdjust, isNeutralAdjust } from './adjust.ts';
export { activeColors, quantize, buildCostModel, naturalOptions, MAX_ACTIVE_COLORS } from './quantize/index.ts';
export type { CostModel, MatchWeights } from './quantize/metric.ts';
export { NATURAL_DEFAULTS } from './quantize/natural.ts';
export type { NaturalOptions } from './quantize/natural.ts';
export { DITHER_DEFAULTS, OKHW2 } from './quantize/faithful.ts';
export { SEPIA_COLOR_IDS, GREYSCALE_COLOR_IDS, SEPIA_WEIGHTS, GREYSCALE_WEIGHTS } from './quantize/lightness.ts';
export { limitColors, mergeSmallLots, despeckle, compact } from './post.ts';
export type { LimitColorsResult, MergeSmallLotsResult, DespeckleOptions, DespeckleResult } from './post.ts';
export { generate } from './generate.ts';

// parts, cost, exports
export { countColors, billOfMaterials, estimateCost, basePieces, physicalSizeCm } from './bom.ts';
export type { BomOptions } from './bom.ts';
export { toBrickLinkXml, toPickABrickCsv, toRebrickableCsv, PAB_MAX_QTY, PAB_MAX_ELEMENTS } from './exports.ts';

// panels and share links
export { panelsOf, panelLabel, PANEL_EMPTY } from './panels.ts';
export { encodeShare, decodeShare, ShareDecodeError, SHARE_VERSION, MAX_SHARE_CHARS, toBase64Url, fromBase64Url } from './codec.ts';
export type { ShareDecodeReason } from './codec.ts';
