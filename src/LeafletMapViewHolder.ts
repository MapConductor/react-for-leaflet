import {
  MapViewHolderBase,
  ProjectedUnit,
  createGeoPoint,
  type MapCoordinateSystem,
  type GeoPoint,
  type GeoPointInterface,
  type Offset,
} from '@mapconductor/js-sdk-core';
import { latLng, point, type Map as LeafletMap } from 'leaflet';
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

  /**
   * The map's CRS (`options.crs`, EPSG:3857 unless the app gave another).
   * Leaflet's built-in CRSs have no unit field, so it is read off the code;
   * `CRS.Simple` and custom CRSs without a code report a null code.
   */
  override get coordinateSystem(): MapCoordinateSystem {
    const code = this.map.options.crs?.code ?? null;
    const unit =
      code === 'EPSG:3857' || code === 'EPSG:3395' || code === 'EPSG:900913' ? ProjectedUnit.Meters
        : code === 'EPSG:4326' ? ProjectedUnit.Degrees
          : ProjectedUnit.Other;
    return { code, unit };
  }

  override toProjectedPoint(position: GeoPointInterface): Offset | null {
    const crs = this.map.options.crs;
    if (!crs) return super.toProjectedPoint(position);
    const projected = crs.project(latLng(position.latitude, position.longitude));
    return Number.isFinite(projected.x) && Number.isFinite(projected.y) ? { x: projected.x, y: projected.y } : null;
  }

  override fromProjectedPoint(projected: Offset): GeoPoint | null {
    const crs = this.map.options.crs;
    if (!crs) return super.fromProjectedPoint(projected);
    const geographic = crs.unproject(point(projected.x, projected.y));
    return Number.isFinite(geographic.lat) && Number.isFinite(geographic.lng)
      ? createGeoPoint({ latitude: geographic.lat, longitude: geographic.lng })
      : null;
  }

  // 画面（外枠）上の位置。地図は 200% の平面に描いて回転・傾斜させているので、
  // Leaflet の containerPoint（平面の変換前の座標）ではなく、変換後に外枠の上で
  // 見える位置を返す。InfoBubble もアプリが重ねる要素もこの座標で置く。
  toScreenOffset(position: GeoPointInterface): Offset {
    return this.toOuterScreenOffset(position);
  }

  fromScreenOffsetSync(offset: Offset): GeoPoint {
    const inner = this.outerToInnerOffset(offset);
    const latLng = this.map.containerPointToLatLng([inner.x, inner.y]);
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
    const centerLng = this.map.getCenter().lng;
    const lng = position.longitude + 360 * Math.round((centerLng - position.longitude) / 360);
    // Leaflet projects longitude literally (Web Mercator is linear in lng) and
    // does not pick the world copy nearest the viewport, so a position just
    // across the antimeridian would project ~360° off-screen.
    const point = this.map.latLngToContainerPoint([position.latitude, lng]);
    return this.innerToOuterOffset(point.x, point.y);
  }

  /**
   * Outer-container pixels back to the map container's own pixels: the inverse
   * of {@link toOuterScreenOffset}, read off the same computed CSS transform.
   * The plane sits at z = 0 and has no perspective, so only the 2x2 part of the
   * matrix (plus its translation) maps the plane onto the screen.
   *
   * @internal
   */
  outerToInnerOffset(offset: Offset): Offset {
    const inner = this.mapView;
    const outer = inner.parentElement;
    const innerW = inner.offsetWidth;
    const innerH = inner.offsetHeight;
    if (!outer) return { x: offset.x, y: offset.y };
    const pivotX = outer.offsetWidth / 2 + innerW / 2;
    const pivotY = outer.offsetHeight / 2 + innerH / 2;
    const transform = getComputedStyle(inner).transform;
    const m = new DOMMatrix(!transform || transform === 'none' ? undefined : transform);
    const sx = offset.x - pivotX - m.m41;
    const sy = offset.y - pivotY - m.m42;
    const det = m.m11 * m.m22 - m.m21 * m.m12;
    if (Math.abs(det) < 1e-9) return { x: innerW / 2, y: innerH / 2 };
    const dx = (sx * m.m22 - sy * m.m21) / det;
    const dy = (sy * m.m11 - sx * m.m12) / det;
    return { x: dx + innerW / 2, y: dy + innerH / 2 };
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
