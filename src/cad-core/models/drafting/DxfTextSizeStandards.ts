/**
 * Standard DXF text height rules for all GAD views.
 * These values are AutoCAD drawing units and map directly to the DraftingText.height
 * property in the JSON payload sent to the backend.
 *
 * Title rule: canvas font size >= 16px or text contains title keywords
 * Dimension rule: canvas font size < 16px and no title keywords
 */
export const DXF_TEXT_STANDARDS = {
  /** Toe Wall view — tightest because it is a detail-level view */
  'tw': {
    dimension: 200,
    title: 80,
  },
  /** Plan Top view — wide view, needs larger text for readability */
  'plan': {
    dimension: 200,
    title: 250,
  },
  /** Bore Log view - requires small text to fit into tight boxes */
  'borelog': {
    dimension: 150,
    title: 200,
  },
  /** Default: all other views (soffit, elev, rw, cw, sk, er, lfw, cross, etc.) */
  'default': {
    dimension: 200,
    title: 250,
  },
} as const;

/** Font size threshold in canvas pixels above which text might be considered a "title" */
export const DXF_TITLE_FONT_THRESHOLD_PX = 16;

/** Check if a text string is likely a view title based on content and size */
export function isTitleText(text: string, canvasFontSizePx: number): boolean {
  const cleanText = text.trim();
  if (cleanText.length < 3) return false;

  // Large font size was previously used as a heuristic, but due to
  // virtual canvas scaling (e.g., sf = 10), standard annotations frequently
  // exceed the 16px threshold, causing catastrophic title-stacking bugs.
  // We now strictly rely on EXACT MATCH patterns.

  // Only treat as title if it is an EXACT match of a known view-level heading.
  // This prevents annotation strings like "PROP. FORMATION LEVEL 31.470" or
  // "SLOPE NOT STEEPER THAN 1:1" from being mis-classified as titles and
  // being relocated to the bottom of the drawing by the title-placement logic.
  const upperText = cleanText.toUpperCase();
  const EXACT_TITLE_PATTERNS: RegExp[] = [
    /^HALF SECTION$/,
    /^HALF ELEVATION$/,
    /^HALF SECTION & HALF ELEVATION$/,
    /^CROSS SECTION$/,
    /^ELEVATION$/,
    /^PLAN VIEW$/,
    /^PLAN$/,
    /^PIER CROSS SECTION$/,
    /^TOE WALL$/,
    /^SECTION OF MASS C\.C TOE WALL$/,
    /^ABUT(MENT)? X.?SECTION$/,
    /^DETAILS AT SECTION X$/,
    /^SECTIONAL VIEW OF FACE WALL AT C-C$/,
    /^SECTION AT [A-Z]-[A-Z]$/,
    /^STN\/RDSO SLAB$/,
    /^U THROUGH WALL$/,
    /^BORE LOG$/,
    /^SCALE/,
  ];

  return EXACT_TITLE_PATTERNS.some(re => re.test(upperText));
}

/** Check if a text string is specifically a scale subtitle */
export function isScaleSubtitle(text: string): boolean {
  return text.toUpperCase().includes('SCALE');
}

/** Check if text is a pure dimension (e.g. "1500", "3.200", "1500 mm", "3.2 m") */
export function isPureDimensionText(text: string): boolean {
  // Matches optional sign, numbers, dots, spaces, and optional m or mm (case insensitive)
  return /^[+\-]?[\d\.\,\s]+(m|mm)?$/i.test(text.trim());
}

/** Resolve standard DXF text height for a given view key, text content, and canvas font size */
export function resolveDxfTextHeight(viewKey: string, text: string, canvasFontSizePx: number): number {
  const isTitle = isTitleText(text, canvasFontSizePx);

  let targetHeight = 200; // Default fallback

  if (isTitle) {
    if (viewKey === 'tw' || viewKey === 'detail_x' || viewKey === 'lfw' || viewKey === 'abut') {
      targetHeight = 150; // Proportionate title height for detail views
    } else {
      targetHeight = 220; // View titles for main views
    }
  } else if (viewKey === 'tw' || viewKey === 'detail_x' || viewKey === 'lfw' || viewKey === 'abut') {
    // Detail views have compact structural elements (200mm toe wall, 75mm pad, etc.).
    // Use 90-100 units so annotations and level markers stay readable without cluttering.
    if (isPureDimensionText(text)) {
      targetHeight = 90; // Neat dimension text
    } else {
      targetHeight = 100; // Neat level markers and callout text
    }
  } else if (viewKey === 'elev') {
    // Elevation view has dense annotations (level labels, dimension text, material notes).
    // Use 160 units so labels stay readable without overlapping neighbours.
    targetHeight = 160;
  } else if (viewKey === 'borelog') {
    // User requested size 150 for filled text and levels text
    targetHeight = 150;
  } else if (viewKey === 'rcc') {
    // Make all text in the output DXF 200 in size for the reinforcement view
    targetHeight = 200;
  } else if (viewKey === 'bbs') {
    // Scale the text up so standard 13px text maps to ~100 DXF units
    // (13 * 7.5 = 97.5 ~ 100)
    targetHeight = canvasFontSizePx * 7.5;
  } else {
    // Other views
    const rule = (DXF_TEXT_STANDARDS as any)[viewKey] ?? DXF_TEXT_STANDARDS['default'];
    targetHeight = rule.dimension;
  }

  // The export pipeline scales all text heights by 2.5x to convert from Canvas scale (400px = 1m)
  // to AutoCAD true scale (1000 units = 1m). 1000 / 400 = 2.5.
  // Therefore, we divide the target AutoCAD height by 2.5 so that the final multiplied text
  // size ends up exactly at the target size (e.g. 250, 200, 150) in AutoCAD.
  return targetHeight / 2.5;
}
