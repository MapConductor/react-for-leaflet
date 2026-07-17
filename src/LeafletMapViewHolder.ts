import {
  MapViewHolderBase,
  createGeoPoint,
  type GeoPoint,
  type GeoPointInterface,
  type Offset,
} from '@mapconductor/js-sdk-core';
import type { Map as LeafletMap } from 'leaflet';
import type { LeafletMapViewController } from './LeafletMapViewController';

export class LeafletMapViewHolder extends MapViewHolderBase<HTMLElement, LeafletMap> {
  private controller: LeafletMapViewController | null = null;

  constructor(
    readonly mapView: HTMLElement,
    readonly map: LeafletMap,
  ) {
    super();
  }

  getController(): LeafletMapViewController | null {
    return this.controller;
  }

  setController(controller: LeafletMapViewController): void {
    this.controller = controller;
  }

  toScreenOffset(position: GeoPointInterface): Offset {
    const point = this.map.latLngToContainerPoint([position.latitude, position.longitude]);
    return { x: point.x, y: point.y };
  }

  async fromScreenOffset(offset: Offset): Promise<GeoPoint> {
    return this.fromScreenOffsetSync(offset);
  }

  fromScreenOffsetSync(offset: Offset): GeoPoint {
    const latLng = this.map.containerPointToLatLng([offset.x, offset.y]);
    return createGeoPoint({ latitude: latLng.lat, longitude: latLng.lng });
  }
}
