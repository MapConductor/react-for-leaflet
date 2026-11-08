import { createGeoPoint, overlayStackZ, type GeoPoint, type GeoPointInterface, type OverlayKind } from '@mapconductor/js-sdk-core';
import type { LatLngExpression, LeafletMouseEvent, Map as LeafletMap } from 'leaflet';

export const toLatLng = (point: GeoPointInterface): LatLngExpression => [
  point.latitude,
  point.longitude,
];

export const fromLeafletEvent = (event: LeafletMouseEvent): GeoPoint => createGeoPoint({
  latitude: event.latlng.lat,
  longitude: event.latlng.lng,
});

export function ensurePane(
  map: LeafletMap,
  name: string,
  zIndex: number,
  pointerEvents = 'auto',
): string {
  const pane = map.getPane(name) ?? map.createPane(name);
  pane.style.zIndex = String(zIndex);
  pane.style.pointerEvents = pointerEvents;
  return name;
}

/**
 * Pane z-index for an overlay, from the shared stack (js-sdk-core OVERLAY_STACK_ORDER):
 * raster < ground image < polygon < circle < polyline < marker, zIndex within the band.
 *
 * Bands of 60 from 211 to 569: above Leaflet's tilePane (200, the basemap) and below its
 * markerPane (600, the native markers). zIndex is clamped to ±29 so it cannot cross a band.
 * Polygons, circles and polylines used to share one range (400 ± zIndex), so with equal
 * zIndexes whichever pane was created first was drawn under the others; a raster could go up
 * to 350, over ground images (300) and low-zIndex shapes.
 */
export function overlayPaneZIndex(kind: OverlayKind, zIndex: number | null | undefined = 0): number {
  return overlayStackZ(kind, zIndex, { base: 240, bandSize: 60 });
}
