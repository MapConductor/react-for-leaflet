import {
  BaseMapViewController,
  createGeoPoint,
  createGeoRectBounds,
  createMapCameraPosition,
  computeOffset,
  type CameraOptions,
  type CircleCapable,
  type CircleState,
  type GeoRectBounds,
  type GroundImageCapable,
  type GroundImageState,
  type MapCameraPosition,
  type MapViewControllerInterface,
  type MarkerAnimationOverlayHost,
  type MarkerCapable,
  type MarkerState,
  type OnCircleEventHandler,
  type OnGroundImageEventHandler,
  type OnMapInitializedHandler,
  type OnMarkerEventHandler,
  type OnPolygonEventHandler,
  type OnPolylineEventHandler,
  type PolygonCapable,
  type PolygonState,
  type PolylineCapable,
  type PolylineState,
  type RasterLayerCapable,
  type RasterLayerState,
  type VisibleRegion,
} from '@mapconductor/js-sdk-core';
import type { LeafletMouseEvent, Map as LeafletMap } from 'leaflet';
import { LeafletMapViewHolder } from './LeafletMapViewHolder';
import { fromLeafletEvent } from './helpers';
import { LeafletMarkerController } from './marker/LeafletMarkerController';
import {
  LeafletCircleController,
  LeafletGroundImageController,
  LeafletPolygonController,
  LeafletPolylineController,
} from './vector/LeafletVectorControllers';
import { LeafletRasterLayerController } from './raster/LeafletRasterLayer';

export class LeafletMapViewController
  extends BaseMapViewController
  implements
    MapViewControllerInterface,
    MarkerCapable,
    CircleCapable,
    PolylineCapable,
    PolygonCapable,
    GroundImageCapable,
    RasterLayerCapable {
  private readonly map: LeafletMap;
  private destroyed = false;
  private logicalTilt: number;
  private logicalPosition = createGeoPoint({ latitude: 0, longitude: 0 });
  private logicalZoom = 0;
  private logicalBearing = 0;
  private hasLogicalCameraOverride = false;

  constructor(
    readonly holder: LeafletMapViewHolder,
    private readonly markerController: LeafletMarkerController,
    private readonly circleController: LeafletCircleController,
    private readonly polylineController: LeafletPolylineController,
    private readonly polygonController: LeafletPolygonController,
    private readonly groundImageController: LeafletGroundImageController,
    private readonly rasterLayerController: LeafletRasterLayerController,
    initialTilt = 0,
    initialBearing = 0,
  ) {
    super();
    this.map = holder.map;
    this.logicalTilt = initialTilt;
    const initialCenter = this.map.getCenter();
    this.logicalPosition = createGeoPoint({ latitude: initialCenter.lat, longitude: initialCenter.lng });
    this.logicalZoom = this.map.getZoom();
    this.logicalBearing = initialBearing;
    this.hasLogicalCameraOverride = initialTilt !== 0 || initialBearing !== 0;
    if (this.hasLogicalCameraOverride) {
      const camera = toLeafletCamera(createMapCameraPosition({
        position: this.logicalPosition,
        zoom: this.logicalZoom,
        bearing: this.logicalBearing,
        tilt: initialTilt,
      }));
      this.map.setView([camera.position.latitude, camera.position.longitude], camera.zoom, { animate: false });
    }
    holder.setController(this);
    markerController.onRasterLayerUpdate = async state => {
      if (state) await rasterLayerController.updateInternal(state);
      else await rasterLayerController.removeInternal('mc-marker-tiles');
    };
    this.setupEvents();
  }

  getMap(): LeafletMap { return this.map; }

  private setupEvents(): void {
    this.map.on('movestart', () => {
      const camera = this.getCameraPosition();
      if (camera) this.notifyCameraMoveStart(camera);
    });
    this.map.on('move', () => {
      const camera = this.getCameraPosition();
      if (camera) this.notifyCameraMove(camera);
    });
    this.map.on('moveend', () => {
      const camera = this.getCameraPosition();
      if (!camera) return;
      void this.notifyControllersCameraChanged(camera);
      this.notifyCameraMoveEnd(camera);
    });
    this.map.on('click', (event: LeafletMouseEvent) => {
      const clicked = fromLeafletEvent(event);
      const tiled = this.markerController.findTiled(clicked, this.map.getZoom());
      if (tiled?.state.clickable) {
        this.markerController.dispatchClick(tiled.state);
        return;
      }
      this.notifyMapClick(clicked);
    });
    this.map.on('contextmenu', (event: LeafletMouseEvent) => {
      this.notifyMapLongClick(fromLeafletEvent(event));
    });

    const camera = this.getCameraPosition();
    if (camera) void this.notifyControllersCameraChanged(camera);
  }

  override setMapInitializedListener(listener: OnMapInitializedHandler | null): void {
    super.setMapInitializedListener(listener);
    if (listener && !this.destroyed) queueMicrotask(() => this.notifyMapInitialized());
  }

  async moveCamera(position: MapCameraPosition): Promise<boolean> {
    this.logicalTilt = position.tilt;
    this.logicalPosition = position.position;
    this.logicalZoom = position.zoom;
    this.logicalBearing = position.bearing;
    this.hasLogicalCameraOverride = position.tilt !== 0 || position.bearing !== 0;
    const camera = toLeafletCamera(position);
    this.map.setView(
      [camera.position.latitude, camera.position.longitude],
      camera.zoom,
      { animate: false },
    );
    return true;
  }

  async animateCamera(position: MapCameraPosition, options?: CameraOptions): Promise<boolean> {
    this.logicalTilt = position.tilt;
    this.logicalPosition = position.position;
    this.logicalZoom = position.zoom;
    this.logicalBearing = position.bearing;
    this.hasLogicalCameraOverride = position.tilt !== 0 || position.bearing !== 0;
    const camera = toLeafletCamera(position);
    const durationSeconds = (options?.duration ?? 500) / 1000;
    this.map.flyTo(
      [camera.position.latitude, camera.position.longitude],
      camera.zoom,
      { duration: durationSeconds },
    );
    return true;
  }

  async fitBounds(bounds: GeoRectBounds, options?: CameraOptions): Promise<boolean> {
    if (!bounds.southWest || !bounds.northEast) return false;
    const padding = normalizePadding(options?.padding ?? options?.paddings);
    this.map.fitBounds([
      [bounds.southWest.latitude, bounds.southWest.longitude],
      [bounds.northEast.latitude, bounds.northEast.longitude],
    ], {
      animate: (options?.duration ?? 0) > 0,
      duration: (options?.duration ?? 0) / 1000,
      paddingTopLeft: padding ? [padding.left, padding.top] : undefined,
      paddingBottomRight: padding ? [padding.right, padding.bottom] : undefined,
    });
    return true;
  }

  getCameraPosition(): MapCameraPosition {
    const center = this.map.getCenter();
    return createMapCameraPosition({
      position: this.hasLogicalCameraOverride ? this.logicalPosition : createGeoPoint({ latitude: center.lat, longitude: center.lng }),
      zoom: this.hasLogicalCameraOverride ? this.logicalZoom : this.map.getZoom(),
      bearing: this.hasLogicalCameraOverride ? this.logicalBearing : 0,
      tilt: this.logicalTilt,
      visibleRegion: this.getVisibleRegion(),
    });
  }

  getBounds(): GeoRectBounds | null {
    return this.getVisibleRegion().bounds;
  }

  private getVisibleRegion(): VisibleRegion {
    const size = this.map.getSize();
    const nearLeft = this.holder.fromScreenOffsetSync({ x: 0, y: size.y });
    const nearRight = this.holder.fromScreenOffsetSync({ x: size.x, y: size.y });
    const farLeft = this.holder.fromScreenOffsetSync({ x: 0, y: 0 });
    const farRight = this.holder.fromScreenOffsetSync({ x: size.x, y: 0 });
    const bounds = createGeoRectBounds();
    bounds.extend(nearLeft);
    bounds.extend(nearRight);
    bounds.extend(farLeft);
    bounds.extend(farRight);
    return { bounds, nearLeft, nearRight, farLeft, farRight };
  }

  private async notifyControllersCameraChanged(camera: MapCameraPosition): Promise<void> {
    await Promise.all([
      this.markerController.onCameraChanged(camera),
      this.circleController.onCameraChanged(camera),
      this.polylineController.onCameraChanged(camera),
      this.polygonController.onCameraChanged(camera),
      this.groundImageController.onCameraChanged(camera),
      this.rasterLayerController.onCameraChanged(camera),
    ]);
  }

  async compositionMarkers(data: MarkerState[]): Promise<void> { await this.markerController.composition(data); }
  async updateMarker(state: MarkerState): Promise<void> { await this.markerController.update(state); }
  hasMarker(state: MarkerState): boolean { return this.markerController.has(state); }
  setOnMarkerClickListener(listener: OnMarkerEventHandler | null): void { this.markerController.setOnClickListener(listener); }
  setOnMarkerDragStart(listener: OnMarkerEventHandler | null): void { this.markerController.setOnDragStart(listener); }
  setOnMarkerDrag(listener: OnMarkerEventHandler | null): void { this.markerController.setOnDrag(listener); }
  setOnMarkerDragEnd(listener: OnMarkerEventHandler | null): void { this.markerController.setOnDragEnd(listener); }
  setOnMarkerAnimateStart(listener: OnMarkerEventHandler | null): void { this.markerController.setOnAnimateStart(listener); }
  setOnMarkerAnimateEnd(listener: OnMarkerEventHandler | null): void { this.markerController.setOnAnimateEnd(listener); }
  setMarkerAnimationOverlayHost(host: MarkerAnimationOverlayHost | null): void { this.markerController.setMarkerAnimationOverlayHost(host); }

  async compositionCircles(data: CircleState[]): Promise<void> { await this.circleController.composition(data); }
  async updateCircle(state: CircleState): Promise<void> { await this.circleController.update(state); }
  hasCircle(state: CircleState): boolean { return this.circleController.has(state); }
  setOnCircleClickListener(listener: OnCircleEventHandler | null): void { this.circleController.setOnClickListener(listener); }

  async compositionPolylines(data: PolylineState[]): Promise<void> { await this.polylineController.composition(data); }
  async updatePolyline(state: PolylineState): Promise<void> { await this.polylineController.update(state); }
  hasPolyline(state: PolylineState): boolean { return this.polylineController.has(state); }
  setOnPolylineClickListener(listener: OnPolylineEventHandler | null): void { this.polylineController.setOnClickListener(listener); }

  async compositionPolygons(data: PolygonState[]): Promise<void> { await this.polygonController.composition(data); }
  async updatePolygon(state: PolygonState): Promise<void> { await this.polygonController.update(state); }
  hasPolygon(state: PolygonState): boolean { return this.polygonController.has(state); }
  setOnPolygonClickListener(listener: OnPolygonEventHandler | null): void { this.polygonController.setOnClickListener(listener); }

  async compositionGroundImages(data: GroundImageState[]): Promise<void> { await this.groundImageController.composition(data); }
  async updateGroundImage(state: GroundImageState): Promise<void> { await this.groundImageController.update(state); }
  hasGroundImage(state: GroundImageState): boolean { return this.groundImageController.has(state); }
  setOnGroundImageClickListener(listener: OnGroundImageEventHandler | null): void { this.groundImageController.setOnClickListener(listener); }

  async compositionRasterLayers(data: RasterLayerState[]): Promise<void> { await this.rasterLayerController.composition(data); }
  async updateRasterLayer(state: RasterLayerState): Promise<void> { await this.rasterLayerController.update(state); }
  hasRasterLayer(state: RasterLayerState): boolean { return this.rasterLayerController.has(state); }

  async clearOverlays(): Promise<void> {
    await Promise.all([
      this.markerController.clear(),
      this.circleController.clear(),
      this.polylineController.clear(),
      this.polygonController.clear(),
      this.groundImageController.clear(),
      this.rasterLayerController.clear(),
    ]);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.map.off();
    this.map.remove();
    void this.clearOverlays().finally(() => this.markerController.destroy());
  }
}

const NEGATIVE_TILT_TARGET_DISTANCE_SCALE = 1.83;
const NEGATIVE_TILT_ZOOM_OFFSET_AT_MAX_TILT = -0.9;
const ZOOM0_ALTITUDE = 171_319_879;

/**
 * Leaflet cannot pitch the camera upward. For negative tilt, move the ground
 * target forward and render the equivalent positive CSS tilt instead.
 */
function toLeafletCamera(position: MapCameraPosition): MapCameraPosition {
  if (position.tilt >= 0) return position;

  const tiltAbs = Math.min(Math.max(Math.abs(position.tilt), 0), 60);
  const tiltRadians = (tiltAbs * Math.PI) / 180;
  const latitudeRadians = (Math.max(-85, Math.min(85, position.position.latitude)) * Math.PI) / 180;
  const altitude = Math.min(
    Math.max((ZOOM0_ALTITUDE * Math.max(Math.abs(Math.cos(latitudeRadians)), 0.01)) / (2 ** position.zoom), 100),
    50_000_000,
  );
  const distanceForward = altitude
    * Math.cos(tiltRadians)
    * Math.tan(tiltRadians)
    * NEGATIVE_TILT_TARGET_DISTANCE_SCALE;
  const target = computeOffset({
    origin: position.position,
    distance: distanceForward,
    heading: position.bearing,
  });

  return position.copy({
    position: target,
    zoom: position.zoom + NEGATIVE_TILT_ZOOM_OFFSET_AT_MAX_TILT * (tiltAbs / 60),
    tilt: tiltAbs,
  });
}

function normalizePadding(value: CameraOptions['padding'] | CameraOptions['paddings']) {
  if (typeof value === 'number') {
    return { top: value, left: value, bottom: value, right: value };
  }
  return value;
}
