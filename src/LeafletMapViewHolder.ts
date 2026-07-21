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

  fromScreenOffsetSync(offset: Offset): GeoPoint {
    const latLng = this.map.containerPointToLatLng([offset.x, offset.y]);
    return createGeoPoint({ latitude: latLng.lat, longitude: latLng.lng });
  }

  /**
   * Projects a geographic position into the OUTER map container's pixel space.
   *
   * Leaflet's map container is rendered inside a transformed plane (see
   * `LeafletMapView.mapPlaneStyle`: 200% size, centered via
   * `translate(-50%, -50%)`, then optionally `rotateZ`/`rotateX` for
   * bearing/tilt). {@link toScreenOffset} returns coordinates relative to that
   * inner container's pre-transform top-left, but screen-space overlays
   * (`MarkerAnimationLayer`, `InfoBubbleOverlay`) live in the outer
   * (untransformed) container. Apply the inner's CSS transform to map
   * inner-local pixels into outer-local pixels so those overlays line up with
   * the visible marker.
   */
  toOuterScreenOffset(position: GeoPointInterface): Offset {
    const point = this.map.latLngToContainerPoint([position.latitude, position.longitude]);
    return this.innerToOuterOffset(point.x, point.y);
  }

  /**
   * Apply the inner container's CSS transform to convert inner-local pixels
   * (relative to the inner's pre-transform top-left) into outer-local pixels
   * (relative to the visible wrapper that hosts the screen-space overlays).
   */
  private innerToOuterOffset(x: number, y: number): Offset {
    const inner = this.mapView;
    const outer = inner.parentElement;
    if (!outer) return { x, y };

    const innerW = inner.offsetWidth;
    const innerH = inner.offsetHeight;
    const outerW = outer.offsetWidth;
    const outerH = outer.offsetHeight;

    // The inner is positioned with `left: 50%, top: 50%`, so its pre-transform
    // top-left sits at outer coord (outerW/2, outerH/2). transform-origin is
    // the inner's center, so the pivot in outer coords is
    // (outerW/2 + innerW/2, outerH/2 + innerH/2) and stays fixed through the
    // transform. Applying the matrix to the displacement from the inner's
    // center yields the post-transform displacement; adding the pivot gives
    // the outer-container coord.
    const transform = getComputedStyle(inner).transform;
    const pivotX = outerW / 2 + innerW / 2;
    const pivotY = outerH / 2 + innerH / 2;
    const dx = x - innerW / 2;
    const dy = y - innerH / 2;
    if (!transform || transform === 'none') {
      return { x: pivotX + dx, y: pivotY + dy };
    }
    const matrix = new DOMMatrix(transform);
    const t = matrix.transformPoint(new DOMPoint(dx, dy, 0, 1));
    return { x: pivotX + t.x, y: pivotY + t.y };
  }
}
