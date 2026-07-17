import {
  BaseMapViewController,
  createGeoPoint,
  createGeoRectBounds,
  createMapCameraPosition,
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

  constructor(
    readonly holder: LeafletMapViewHolder,
    private readonly markerController: LeafletMarkerController,
    private readonly circleController: LeafletCircleController,
    private readonly polylineController: LeafletPolylineController,
    private readonly polygonController: LeafletPolygonController,
    private readonly groundImageController: LeafletGroundImageController,
    private readonly rasterLayerController: LeafletRasterLayerController,
  ) {
    super();
    this.map = holder.map;
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
    this.map.setView(
      [position.position.latitude, position.position.longitude],
      position.zoom,
      { animate: false },
    );
    return true;
  }

  async animateCamera(position: MapCameraPosition, options?: CameraOptions): Promise<boolean> {
    const durationSeconds = (options?.duration ?? 500) / 1000;
    this.map.flyTo(
      [position.position.latitude, position.position.longitude],
      position.zoom,
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
      position: createGeoPoint({ latitude: center.lat, longitude: center.lng }),
      zoom: this.map.getZoom(),
      bearing: 0,
      tilt: 0,
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

function normalizePadding(value: CameraOptions['padding'] | CameraOptions['paddings']) {
  if (typeof value === 'number') {
    return { top: value, left: value, bottom: value, right: value };
  }
  return value;
}
