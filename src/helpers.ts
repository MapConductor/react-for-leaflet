import { createGeoPoint, type GeoPoint, type GeoPointInterface } from '@mapconductor/js-sdk-core';
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
