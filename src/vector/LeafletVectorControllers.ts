import {
  AbstractCircleOverlayRenderer,
  AbstractGroundImageOverlayRenderer,
  AbstractPolygonOverlayRenderer,
  AbstractPolylineOverlayRenderer,
  CircleController,
  CircleManager,
  createInterpolatePoints,
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
  type PolygonEntity,
  type PolygonState,
  type PolylineEntity,
  type PolylineState,
} from '@mapconductor/js-sdk-core';
import {
  circle,
  imageOverlay,
  latLngBounds,
  polygon,
  polyline,
  type Circle as LeafletCircle,
  type ImageOverlay,
  type LeafletMouseEvent,
  type Polygon as LeafletPolygon,
  type Polyline as LeafletPolyline,
} from 'leaflet';
import { LeafletMapViewHolder } from '../LeafletMapViewHolder';
import { ensurePane, fromLeafletEvent, toLatLng } from '../helpers';

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
  LeafletCircle
> {
  onClick: ((state: CircleState, event: LeafletMouseEvent) => void) | null = null;

  async createCircle(state: CircleState): Promise<LeafletCircle> {
    const actual = circle(toLatLng(state.center), {
      radius: state.radiusMeters,
      color: state.strokeColor,
      weight: state.strokeWidth,
      fillColor: state.fillColor,
      fillOpacity: 1,
      interactive: state.clickable,
      bubblingMouseEvents: false,
      pane: vectorPane(this.holder, 'circle', state.id, state.zIndex ?? 0),
    }).addTo(this.holder.map);
    actual.on('click', event => this.onClick?.(state, event));
    return actual;
  }

  async updateCircleProperties({
    circle: actual,
    current,
  }: {
    circle: LeafletCircle;
    current: CircleEntity<LeafletCircle>;
    prev: CircleEntity<LeafletCircle>;
  }): Promise<LeafletCircle> {
    actual.remove();
    return this.createCircle(current.state);
  }

  async removeCircle(entity: CircleEntity<LeafletCircle>): Promise<void> {
    entity.circle.remove();
  }
}

export class LeafletCircleController extends CircleController<LeafletCircle> {
  constructor(renderer: LeafletCircleRenderer) {
    super({ circleManager: new CircleManager(), renderer });
    renderer.onClick = (state, event) => {
      if (state.clickable) this.dispatchClick({ state, clicked: fromLeafletEvent(event) });
    };
  }
}

export class LeafletPolylineRenderer extends AbstractPolylineOverlayRenderer<
  LeafletMapViewHolder,
  LeafletPolyline
> {
  onClick: ((state: PolylineState, event: LeafletMouseEvent) => void) | null = null;

  async createPolyline(state: PolylineState): Promise<LeafletPolyline> {
    const actual = polyline(pathToLatLngs(state.points, state.geodesic), {
      color: state.strokeColor,
      weight: state.strokeWidth,
      interactive: state.onClick != null,
      bubblingMouseEvents: false,
      pane: vectorPane(this.holder, 'polyline', state.id, state.zIndex),
    }).addTo(this.holder.map);
    actual.on('click', event => this.onClick?.(state, event));
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
    renderer.onClick = (state, event) => this.dispatchClick({
      state,
      clicked: fromLeafletEvent(event),
    });
  }
}

export class LeafletPolygonRenderer extends AbstractPolygonOverlayRenderer<
  LeafletMapViewHolder,
  LeafletPolygon
> {
  onClick: ((state: PolygonState, event: LeafletMouseEvent) => void) | null = null;

  async createPolygon(state: PolygonState): Promise<LeafletPolygon> {
    const actual = polygon(polygonLatLngs(state), {
      color: state.strokeColor,
      weight: state.strokeWidth,
      fillColor: state.fillColor,
      fillOpacity: 1,
      interactive: state.onClick != null,
      bubblingMouseEvents: false,
      pane: vectorPane(this.holder, 'polygon', state.id, state.zIndex),
    }).addTo(this.holder.map);
    actual.on('click', event => this.onClick?.(state, event));
    return actual;
  }

  async updatePolygonProperties({
    polygon: actual,
    current,
    prev,
  }: {
    polygon: LeafletPolygon;
    current: PolygonEntity<LeafletPolygon>;
    prev: PolygonEntity<LeafletPolygon>;
  }): Promise<LeafletPolygon> {
    const state = current.state;
    if ((prev.state.onClick != null) !== (state.onClick != null)) {
      actual.remove();
      return this.createPolygon(state);
    }

    // Keep the Leaflet Path and SVG renderer mounted while its vertices move.
    // Drag events can arrive every frame, so rebuilding the layer and its event
    // target for each point would add avoidable DOM and renderer churn.
    actual.setLatLngs(polygonLatLngs(state));
    actual.setStyle({
      color: state.strokeColor,
      weight: state.strokeWidth,
      fillColor: state.fillColor,
      fillOpacity: 1,
    });
    vectorPane(this.holder, 'polygon', state.id, state.zIndex);
    actual.off('click');
    actual.on('click', event => this.onClick?.(state, event));
    return actual;
  }

  async removePolygon(entity: PolygonEntity<LeafletPolygon>): Promise<void> {
    entity.polygon.remove();
  }
}

function polygonLatLngs(state: PolygonState): [number, number][][] {
  return [state.points, ...state.holes].map(ring =>
    polygonRingToLatLngs(ring, state.geodesic),
  );
}

function polygonRingToLatLngs(points: GeoPoint[], geodesic: boolean): [number, number][] {
  if (points.length === 0) return [];

  const closedPoints = samePoint(points[0], points[points.length - 1])
    ? points
    : [...points, points[0]];
  return pathToLatLngs(closedPoints, geodesic);
}

function pathToLatLngs(points: GeoPoint[], geodesic: boolean): [number, number][] {
  if (points.length === 0) return [];

  const renderedPoints = geodesic ? createInterpolatePoints(points) : points;

  // Geographic interpolation normalizes longitude to [-180, 180]. Leaflet
  // accepts unwrapped longitudes, so keep adjacent points in the same world
  // copy to avoid drawing a geodesic segment across the whole map when it
  // crosses the antimeridian.
  let previousLongitude: number | null = null;
  return renderedPoints.map(point => {
    let longitude = point.normalize().longitude;
    if (previousLongitude != null) {
      while (longitude - previousLongitude > 180) longitude -= 360;
      while (longitude - previousLongitude < -180) longitude += 360;
    }
    previousLongitude = longitude;
    return [point.latitude, longitude];
  });
}

function samePoint(a: GeoPoint, b: GeoPoint): boolean {
  return a.latitude === b.latitude && a.longitude === b.longitude;
}

export class LeafletPolygonController extends PolygonController<LeafletPolygon> {
  constructor(renderer: LeafletPolygonRenderer) {
    super({ polygonManager: new PolygonManager(), renderer });
    renderer.onClick = (state, event) => this.dispatchClick({
      state,
      clicked: fromLeafletEvent(event),
    });
  }
}

export class LeafletGroundImageRenderer extends AbstractGroundImageOverlayRenderer<
  LeafletMapViewHolder,
  ImageOverlay
> {
  onClick: ((state: GroundImageState, event: LeafletMouseEvent) => void) | null = null;

  async createGroundImage(state: GroundImageState): Promise<ImageOverlay | null> {
    const { southWest, northEast } = state.bounds;
    if (!southWest || !northEast) return null;
    const pane = ensurePane(
      this.holder.map,
      `mc-ground-image-${state.id}`,
      GROUND_IMAGE_BASE_Z_INDEX,
    );
    const actual = imageOverlay(state.imageUrl, latLngBounds(
      [southWest.latitude, southWest.longitude],
      [northEast.latitude, northEast.longitude],
    ), {
      opacity: state.opacity,
      interactive: state.onClick != null,
      bubblingMouseEvents: false,
      pane,
    }).addTo(this.holder.map);
    actual.on('click', event => this.onClick?.(state, event));
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
    renderer.onClick = (state, event) => this.dispatchClick({
      state,
      clicked: fromLeafletEvent(event),
    });
  }
}
