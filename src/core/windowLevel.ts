/**
 * Window/level and zoom math shared by both renderers. Window/level dragging matches
 * Cornerstone's WindowLevelTool (5.18.3, tools/WindowLevelTool.js getNewRange), so NIfTI
 * and 1-bit images respond to the mouse exactly like DICOM images: a horizontal drag
 * changes the width, a vertical drag the centre, each by `multiplier` per pixel.
 */

export interface Window {
  readonly center: number;
  readonly width: number;
}

/** Cornerstone's DEFAULT_IMAGE_DYNAMIC_RANGE. */
const REFERENCE_RANGE = 1024;

/**
 * Units of width or centre per pixel of drag: the image's value range ÷ 1024, rounded
 * when above 1 (so a 12-bit image moves 4 per pixel). Matches
 * `_getMultiplierFromDynamicRange`.
 */
export function dragMultiplier(dynamicRange: number): number {
  const ratio = dynamicRange / REFERENCE_RANGE;
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  return ratio > 1 ? Math.round(ratio) : ratio;
}

/**
 * The window after a drag of (dx, dy) CSS pixels. Cornerstone keeps the width at least 1;
 * for images whose whole range is under 1024 (often float NIfTI), the floor scales with
 * the range so narrow windows stay possible.
 */
export function dragWindow(current: Window, dx: number, dy: number, dynamicRange: number): Window {
  const m = dragMultiplier(dynamicRange);
  const floor =
    dynamicRange >= REFERENCE_RANGE ? 1 : Math.max(dynamicRange / REFERENCE_RANGE, Number.EPSILON);
  return { width: Math.max(current.width + dx * m, floor), center: current.center + dy * m };
}

/**
 * The starting window: the file's own display window when it gives a usable one (DICOM
 * Window Center/Width, NIfTI cal_min/cal_max), else the image's min to max.
 */
export function initialWindow(
  min: number,
  max: number,
  stored?: { readonly low: number; readonly high: number },
): Window {
  if (
    stored &&
    Number.isFinite(stored.low) &&
    Number.isFinite(stored.high) &&
    stored.high > stored.low
  ) {
    return { center: (stored.low + stored.high) / 2, width: stored.high - stored.low };
  }
  const width = Math.max(max - min, Number.EPSILON);
  return { center: min + width / 2, width };
}

/** Zoom limits shared by both renderers. */
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 64;

/** Clamps a zoom factor to [MIN_ZOOM, MAX_ZOOM]. */
export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

/**
 * The zoom after a vertical drag of `dy` CSS pixels: exponential, so the same drag always
 * scales by the same ratio (150 px up ≈ ×e), whatever the current zoom.
 */
export function dragZoom(zoom: number, dy: number): number {
  return clampZoom(zoom * Math.exp(-dy / 150));
}

/**
 * Formats a window width or level for display: whole numbers when large or integral,
 * else four significant digits. Empty for non-finite values.
 */
export function formatWindowValue(n: number): string {
  if (!Number.isFinite(n)) return '';
  return Math.abs(n) >= 100 || Number.isInteger(n) ? String(Math.round(n)) : n.toPrecision(4);
}
