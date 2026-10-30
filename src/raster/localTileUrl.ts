import { parseTilePixelRatio, tilePixelRatioSuffix } from '@mapconductor/js-sdk-core';

/**
 * Marker tiles Leaflet loads straight from `LocalTileServer` when no Service
 * Worker is available. The ratio suffix (`@2x`) means the same as in the
 * Service Worker's `/__tiles/` URLs.
 */
export const MAPCONDUCTOR_TILE_PROTOCOL = 'mc-local-tile';

export interface LocalTileTemplate {
  routeId: string;
  tileSize: number;
  /** Device pixels per CSS pixel the route's tiles are drawn at (`@2x` → 2). */
  pixelRatio: number;
}

// mc-local-tile://{routeId}/{tileSize}/{cacheKey?}/{z}/{x}/{y}{@2x?}.png
export function localTileUrlTemplate({
  routeId,
  tileSize,
  cacheKey,
  pixelRatio,
}: {
  routeId: string;
  tileSize: number;
  cacheKey?: string;
  pixelRatio?: number;
}): string {
  const base = `${MAPCONDUCTOR_TILE_PROTOCOL}://${routeId}/${tileSize}`;
  const tile = `{z}/{x}/{y}${tilePixelRatioSuffix(pixelRatio)}.png`;
  if (cacheKey) {
    return `${base}/${cacheKey}/${tile}`;
  }
  return `${base}/${tile}`;
}

/**
 * The route behind an SDK-owned tile template (`mc-local-tile://` or the
 * Service Worker's `/__tiles/`), or null for any other template. Leaflet reads
 * both straight from `LocalTileServer`, so the ratio has to come from here.
 */
export function parseLocalTileTemplate(template: string): LocalTileTemplate | null {
  const pixelRatio = parseTilePixelRatio(template.match(/(@\d+x)\.png$/)?.[1]);
  if (template.startsWith(`${MAPCONDUCTOR_TILE_PROTOCOL}://`)) {
    const url = new URL(template);
    const tileSize = Number(url.pathname.split('/').filter(Boolean)[0]);
    return Number.isFinite(tileSize) ? { routeId: url.hostname, tileSize, pixelRatio } : null;
  }
  const match = template.match(/^\/?__tiles\/([^/]+)\/(\d+)\//);
  return match ? { routeId: match[1], tileSize: Number(match[2]), pixelRatio } : null;
}
