// Parts the tool can build and the rules it applies. Changing a rule changes the shipped palettes:
// run the tool and review the diff.

export interface PartConfig {
  /** Rebrickable part number. */
  part: string;
  /** Rebrickable part name. */
  partName: string;
  /** BrickLink item number. */
  blPart: string;
  /**
   * LEGO design ids to prefer when choosing an element id for colours without a Pick a Brick
   * offer (the research heuristic: element of a preferred design first, then the highest id).
   */
  preferredDesigns: readonly string[];
  /** Pick a Brick price snapshot in data/, or null. With one, defaultEnabled = sold there. */
  pab: string | null;
  /** BrickLink price sample in data/ for per-colour prices, or null. */
  brickLink: string | null;
  /** BrickLink price sample in data/ whose median gives blEurDefault. */
  blDefault: string;
}

export const PARTS: Readonly<Record<string, PartConfig>> = {
  '98138': {
    part: '98138',
    partName: 'Tile Round 1 x 1',
    blPart: '98138',
    preferredDesigns: ['35381', '35380'],
    pab: 'pab-dk-98138.json',
    brickLink: 'bricklink-prices-98138.json',
    blDefault: 'bricklink-prices-98138.json',
  },
  '6141': {
    part: '6141',
    partName: 'Plate Round 1 x 1 with Solid Stud',
    blPart: '4073',
    preferredDesigns: ['6141', '34823', '30057'],
    pab: null,
    brickLink: null,
    // No sample of its own yet; a round 1x1 plate sells at about the price of the tile.
    blDefault: 'bricklink-prices-98138.json',
  },
};

export const DEFAULT_PART = '98138';

export interface PaletteRules {
  /** A colour is current if it is in a set released in this year or later. */
  minYear: number;
  /** Current colours with at least this many pieces across set inventories are 'core'. */
  coreMinQty: number;
  /** Colours with fewer pieces than this across set inventories are 'rare'. */
  rareBelowQty: number;
  /** Conversion rate for the DKK price snapshots (the krone is pegged to the euro at 7.46). */
  dkkPerEur: number;
}

export const DEFAULT_RULES: PaletteRules = {
  minYear: 2023,
  coreMinQty: 300,
  rareBelowQty: 100,
  dkkPerEur: 7.46,
};

export const ATTRIBUTION = 'Colour and part data from Rebrickable (rebrickable.com).';

/** Rebrickable allows automated downloads of the CSV files at most once a day. */
export const DOWNLOAD_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const CSV_BASE_URL = 'https://cdn.rebrickable.com/media/downloads/';
export const API_COLORS_URL = 'https://rebrickable.com/api/v3/lego/colors/?page_size=1000';
/** The Rebrickable API allows about one request per second. */
export const API_INTERVAL_MS = 1100;
export const USER_AGENT = 'photobrick-palette-tool/0.1';
