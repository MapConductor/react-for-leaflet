import {
  AbstractCircleOverlayRenderer,
  AbstractGroundImageOverlayRenderer,
  AbstractPolygonOverlayRenderer,
  AbstractPolylineOverlayRenderer,
  buildUnwrappedPolygonRings,
  buildUnwrappedPolylinePath,
  circleToRing,
  closeRing,
  CircleController,
  CircleManager,
  GroundImageController,
  GroundImageManager,
  PolygonController,
  PolygonManager,
  PolylineController,
  PolylineManager,
  type CircleEntity,
  type CircleState,
  type GroundImageEntity,
  type GroundImageState,
  type GeoPoint,
  type MapCameraPosition,
  type PolygonEntity,
  type PolygonState,
  type PolylineEntity,
  type PolylineState,
} from '@mapconductor/js-sdk-core';
import {
  imageOverlay,
  latLngBounds,
  polygon,
  polyline,
  type ImageOverlay,
  type Polygon as LeafletPolygon,
  type Polyline as LeafletPolyline,
} from 'leaflet';
import { LeafletMapViewHolder } from '../LeafletMapViewHolder';
import { ensurePane } from '../helpers';

const VECTOR_BASE_Z_INDEX = 400;
const GROUND_IMAGE_BASE_Z_INDEX = 300;

function vectorPane(holder: LeafletMapViewHolder, kind: string, id: string, zIndex: number): string {
  return ensurePane(
    holder.map,
    `mc-${kind}-${id}`,
    VECTOR_BASE_Z_INDEX + Math.max(-100, Math.min(100, zIndex)),
  );
}

export class LeafletCircleRenderer extends AbstractCircleOverlayRenderer<
  LeafletMapViewHolder,
  LeafletPolygon
> {
  async createCircle(state: CircleState): Promise<LeafletPolygon> {
    // Circle polygon from the shared core geometry (circleToRing), replacing
    // Leaflet's native L.circle so the shape definition (geodesic vs planar)
    // is unified across providers. The ring is unwrapped around the center
    // longitude; Leaflet accepts out-of-range longitudes, so an
    // antimeridian-crossing circle stays continuous without splitting.
    //
    // Non-interactive so the click passes through to LeafletMapViewController's
    // map click handler, where the shared core geometric hit-test (with tap
    // tolerance) resolves it — the same overlay-click path every other provider
    // uses, instead of Leaflet's native layer click.
    const ring = closeRing(
      circleToRing(state.center, state.radiusMeters, state.geodesic),
    ).map((point): [number, number] => [point.latitude, point.longitude]);
    const actual = polygon(ring, {
      color: state.strokeColor,
      weight: state.strokeWidth,
      fillColor: state.fillColor,
      fillOpacity: 1,
      interactive: false,
      pane: vectorPane(this.holder, 'circle', state.id, state.zIndex ?? 0),
    }).addTo(this.holder.map);
    return actual;
  }

  async updateCircleProperties({
    circle: actual,
    current,
  }: {
    circle: LeafletPolygon;
    current: CircleEntity<LeafletPolygon>;
    prev: CircleEntity<LeafletPolygon>;
  }): Promise<LeafletPolygon> {
    actual.remove();
    return this.createCircle(current.state);
  }

  async removeCircle(entity: CircleEntity<LeafletPolygon>): Promise<void> {
    entity.circle.remove();
  }
}

export class LeafletCircleController extends CircleController<LeafletPolygon> {
  constructor(renderer: LeafletCircleRenderer) {
    super({ circleManager: new CircleManager(), renderer });
  }

  // Geometric hit-test from a map click (tap inside the circle radius), mirroring
  // every other provider.
  handleMapClick(clicked: GeoPoint): boolean {
    const entity = this.find(clicked);
    if (!entity || !entity.state.clickable) return false;
    this.dispatchClick({ state: entity.state, clicked });
    return true;
  }
}

export class LeafletPolylineRenderer extends AbstractPolylineOverlayRenderer<
  LeafletMapViewHolder,
  LeafletPolyline
> {
  async createPolyline(state: PolylineState): Promise<LeafletPolyline> {
    // Non-interactive: clicks are resolved by the shared core geometric hit-test
    // (with tap tolerance) in the map click handler, like every other provider.
    const actual = polyline(pathToLatLngs(state.points, state.geodesic), {
      color: state.strokeColor,
      weight: state.strokeWidth,
      interactive: false,
      pane: vectorPane(this.holder, 'polyline', state.id, state.zIndex),
    }).addTo(this.holder.map);
    return actual;
  }

  async updatePolylineProperties({
    polyline: actual,
    current,
  }: {
    polyline: LeafletPolyline;
    current: PolylineEntity<LeafletPolyline>;
    prev: PolylineEntity<LeafletPolyline>;
  }): Promise<LeafletPolyline> {
    actual.remove();
    return this.createPolyline(current.state);
  }

  async removePolyline(entity: PolylineEntity<LeafletPolyline>): Promise<void> {
    entity.polyline.remove();
  }
}

export class LeafletPolylineController extends PolylineController<LeafletPolyline> {
  constructor(renderer: LeafletPolylineRenderer) {
    super({ polylineManager: new PolylineManager(), renderer });
  }

  // Geometric hit-test from a map click, mirroring every other provider: resolve
  // the nearest polyline within the shared tap tolerance and dispatch the closest
  // point as `clicked`, instead of Leaflet's thin native path-click hit area.
  handleMapClick(clicked: GeoPoint, camera: MapCameraPosition | null): boolean {
    if (camera) void this.onCameraChanged(camera);
    const hit = this.findWithClosestPoint(clicked);
    if (!hit) return false;
    this.dispatchClick({ state: hit.entity.state, clicked: hit.closestPoint });
    return true;
  }
}

export class LeafletPolygonRenderer extends AbstractPolygonOverlayRenderer<
  LeafletMapViewHolder,
  LeafletPolygon
> {
  async createPolygon(state: PolygonState): Promise<LeafletPolygon> {
    // Non-interactive: clicks are resolved by the shared core geometric hit-test
    // (point-in-polygon) in the map click handler, like every other provider.
    const actual = polygon(polygonLatLngs(state), {
      color: state.strokeColor,
      weight: state.strokeWidth,
      fillColor: state.fillColor,
      fillOpacity: 1,
      interactive: false,
      pane: vectorPane(this.holder, 'polygon', state.id, state.zIndex),
    }).addTo(this.holder.map);
    return actual;
  }

  async updatePolygonProperties({
    polygon: actual,
    current,
  }: {
    polygon: LeafletPolygon;
    current: PolygonEntity<LeafletPolygon>;
    prev: PolygonEntity<LeafletPolygon>;
  }): Promise<LeafletPolygon> {
    const state = current.state;
    // Keep the Leaflet Path and SVG renderer mounted while its vertices move.
    // Drag events can arrive every frame, so rebuilding the layer for each point
    // would add avoidable DOM and renderer churn.
    actual.setLatLngs(polygonLatLngs(state));
    actual.setStyle({
      color: state.strokeColor,
      weight: state.strokeWidth,
      fillColor: state.fillColor,
      fillOpacity: 1,
    });
    vectorPane(this.holder, 'polygon', state.id, state.zIndex);
    return actual;
  }

  async removePolygon(entity: PolygonEntity<LeafletPolygon>): Promise<void> {
    entity.polygon.remove();
  }
}

function polygonLatLngs(state: PolygonState): [number, number][][] {
  // Core pipeline: densify each ring (geodesic great-circle or straight-in-
  // lat/lng linear interpolation, matching the Android renderers) and unwrap
  // the longitudes into the outer ring's world copy. Leaflet accepts unwrapped
  // longitudes and auto-closes rings, so the open rings are passed as-is.
  const { outerRings, holeRings } = buildUnwrappedPolygonRings(
    state.points,
    state.holes,
    state.geodesic,
  );
  return [...outerRings, ...holeRings].map(ring =>
    ring.map((point): [number, number] => [point.latitude, point.longitude]),
  );
}

function pathToLatLngs(points: GeoPoint[], geodesic: boolean): [number, number][] {
  // Core pipeline for both modes: densification (great-circle when geodesic,
  // linear lat/lng otherwise — Android's straight-line semantics) + longitude
  // unwrap. Leaflet accepts unwrapped longitudes, so a segment crossing the
  // antimeridian stays in the same world copy instead of being drawn the long
  // way around the map.
  return buildUnwrappedPolylinePath(points, geodesic).map(
    (point): [number, number] => [point.latitude, point.longitude],
  );
}

export class LeafletPolygonController extends PolygonController<LeafletPolygon> {
  constructor(renderer: LeafletPolygonRenderer) {
    super({ polygonManager: new PolygonManager(), renderer });
  }

  // Geometric hit-test from a map click (inside the polygon fill), mirroring
  // every other provider.
  handleMapClick(clicked: GeoPoint): boolean {
    const entity = this.find(clicked);
    if (!entity) return false;
    this.dispatchClick({ state: entity.state, clicked });
    return true;
  }
}

export class LeafletGroundImageRenderer extends AbstractGroundImageOverlayRenderer<
  LeafletMapViewHolder,
  ImageOverlay
> {
  async createGroundImage(state: GroundImageState): Promise<ImageOverlay | null> {
    const { southWest, northEast } = state.bounds;
    if (!southWest || !northEast) return null;
    const pane = ensurePane(
      this.holder.map,
      `mc-ground-image-${state.id}`,
      GROUND_IMAGE_BASE_Z_INDEX,
    );
    // Non-interactive: clicks are resolved by the shared core geometric hit-test
    // (inside the image bounds) in the map click handler, like every other provider.
    const actual = imageOverlay(state.imageUrl, latLngBounds(
      [southWest.latitude, southWest.longitude],
      [northEast.latitude, northEast.longitude],
    ), {
      opacity: state.opacity,
      interactive: false,
      pane,
    }).addTo(this.holder.map);
    return actual;
  }

  async updateGroundImageProperties({
    groundImage: actual,
    current,
  }: {
    groundImage: ImageOverlay;
    current: GroundImageEntity<ImageOverlay>;
    prev: GroundImageEntity<ImageOverlay>;
  }): Promise<ImageOverlay | null> {
    actual.remove();
    return this.createGroundImage(current.state);
  }

  async removeGroundImage(entity: GroundImageEntity<ImageOverlay>): Promise<void> {
    entity.groundImage.remove();
  }
}

export class LeafletGroundImageController extends GroundImageController<ImageOverlay> {
  constructor(renderer: LeafletGroundImageRenderer) {
    super({ groundImageManager: new GroundImageManager(), renderer });
  }

  // Geometric hit-test from a map click (inside the ground image bounds),
  // mirroring every other provider.
  handleMapClick(clicked: GeoPoint): boolean {
    const entity = this.find(clicked);
    if (!entity) return false;
    this.dispatchClick({ state: entity.state, clicked });
    return true;
  }
}
