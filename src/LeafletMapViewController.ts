import {
  BaseMapViewController,
  createGeoPoint,
  createGeoRectBounds,
  createMapCameraPosition,
  computeOffset,
  MapUISettingsDiagnostics,
  isEmptyCameraRestriction,
  type MapUISettings,
  type CameraRestriction,
  type CircleCapable,
  type GeoRectBounds,
  type GroundImageCapable,
  type MapCameraPosition,
  type MapViewControllerInterface,
  type MarkerAnimationOverlayHost,
  type MarkerCapable,
  type MarkerState,
  type Offset,
  type OnMapInitializedHandler,
  type OnMarkerEventHandler,
  type PolygonCapable,
  type PolylineCapable,
  type RasterLayerCapable,
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

    // Capable ファサードの既定実装がここから kind で引く。

    // **登録を忘れると composition が黙って捨てられる。**

    this.registerOverlayController(this.markerController);

    this.registerOverlayController(this.circleController);

    this.registerOverlayController(this.polylineController);

    this.registerOverlayController(this.polygonController);

    this.registerOverlayController(this.groundImageController);

    this.registerOverlayController(this.rasterLayerController);
    this.map = holder.map;
    this.logicalTilt = initialTilt;
    const initialCenter = this.map.getCenter();
    this.logicalPosition = createGeoPoint({ latitude: initialCenter.lat, longitude: initialCenter.lng });
    this.logicalZoom = this.map.getZoom();
    this.logicalBearing = initialBearing;
    if (initialTilt !== 0 || initialBearing !== 0) {
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

  /**
   * Leaflet has no rotation or tilt of its own — MapConductor fakes both with a
   * CSS transform on the map pane, so there is no gesture to switch off. Pan and
   * zoom are real Leaflet handlers.
   */
  applyUISettings(settings: MapUISettings): void {
    const toggle = (handler: { enable(): void; disable(): void } | undefined, enabled: boolean) => {
      if (!handler) return;
      if (enabled) handler.enable();
      else handler.disable();
    };

    toggle(this.map.dragging, settings.scrollGesture);
    toggle(this.map.scrollWheelZoom, settings.zoomGesture);
    toggle(this.map.doubleClickZoom, settings.zoomGesture);
    toggle(this.map.touchZoom, settings.zoomGesture);
    toggle(this.map.boxZoom, settings.zoomGesture);
    toggle(this.map.keyboard, settings.scrollGesture || settings.zoomGesture);

    MapUISettingsDiagnostics.warnIfRequested(
      settings.rotateGesture, 'rotate', 'Leaflet',
      'bearing is emulated with a CSS transform, so there is no rotate gesture',
    );
    MapUISettingsDiagnostics.warnIfRequested(
      settings.tiltGesture, 'tilt', 'Leaflet',
      'tilt is emulated with a CSS transform, so there is no tilt gesture',
    );
  }

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
      // While tilted, native markers are hidden and non-interactive (drawn as
      // upright canvas billboards), so resolve non-tiled marker clicks in the
      // billboards' screen space instead of via the flattened native DOM events.
      if (!this.markerController.isNativeMarkersVisible()) {
        const outer = this.outerOffsetFromEvent(event.originalEvent);
        const entity = outer ? this.markerController.findAtScreen(outer) : null;
        if (entity?.state.clickable) {
          this.markerController.dispatchClick(entity.state);
          return;
        }
      }
      // Overlay clicks are resolved here by the shared core geometric hit-tests
      // (with tap tolerance), exactly like every other provider. The Leaflet
      // overlay layers are rendered non-interactive so clicks pass through to
      // this handler instead of hitting Leaflet's thin native path/shape click.
      // Order: polyline, polygon, circle, ground image.
      const camera = this.getCameraPosition() ?? null;
      if (this.polylineController.handleMapClick(clicked, camera)) return;
      if (this.polygonController.handleMapClick(clicked)) return;
      if (this.circleController.handleMapClick(clicked)) return;
      if (this.groundImageController.handleMapClick(clicked)) return;
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

  /**
   * The pointer position of a DOM event in the outer (untransformed) container's
   * pixel space — the same space the tilt billboard canvas and `findAtScreen`
   * use (see LeafletMapViewHolder.toOuterScreenOffset).
   */
  private outerOffsetFromEvent(originalEvent: Event | undefined): Offset | null {
    const source = originalEvent as MouseEvent | undefined;
    if (!source || typeof source.clientX !== 'number') return null;
    const outer = this.holder.mapView.parentElement;
    if (!outer) return null;
    const rect = outer.getBoundingClientRect();
    return { x: source.clientX - rect.left, y: source.clientY - rect.top };
  }

  async moveCamera(position: MapCameraPosition): Promise<boolean> {
    this.logicalTilt = position.tilt;
    this.logicalPosition = position.position;
    this.logicalZoom = position.zoom;
    this.logicalBearing = position.bearing;
    const camera = toLeafletCamera(position);
    this.map.setView(
      [camera.position.latitude, camera.position.longitude],
      camera.zoom,
      { animate: false },
    );
    return true;
  }

  async animateCamera(position: MapCameraPosition, durationMillis: number): Promise<boolean> {
    this.logicalTilt = position.tilt;
    this.logicalPosition = position.position;
    this.logicalZoom = position.zoom;
    this.logicalBearing = position.bearing;
    const camera = toLeafletCamera(position);
    const durationSeconds = (durationMillis ?? 500) / 1000;
    this.map.flyTo(
      [camera.position.latitude, camera.position.longitude],
      camera.zoom,
      { duration: durationSeconds },
    );
    return true;
  }

  async fitBounds(bounds: GeoRectBounds, padding: number): Promise<boolean> {
    if (!bounds.southWest || !bounds.northEast) return false;
    const paddings = normalizePadding(padding);
    this.map.fitBounds([
      [bounds.southWest.latitude, bounds.southWest.longitude],
      [bounds.northEast.latitude, bounds.northEast.longitude],
    ], {
      // android-sdk の fitBounds(bounds, padding) と同じくアニメーションはしない。
      animate: false,
      paddingTopLeft: paddings ? [paddings.left, paddings.top] : undefined,
      paddingBottomRight: paddings ? [paddings.right, paddings.bottom] : undefined,
    });
    return true;
  }

  getCameraPosition(): MapCameraPosition {
    // Negative tilt is faked by shifting the real Leaflet center/zoom away from
    // the logical camera (see toLeafletCamera below), so only that case needs
    // to report the logical values instead of the map's live center/zoom.
    // Positive tilt and bearing are purely cosmetic CSS transforms — Leaflet's
    // own center/zoom are never touched for them, so live user pan/zoom must
    // always be read from the map itself or it appears frozen.
    const usesNegativeTiltOffset = this.logicalTilt < 0;
    const center = this.map.getCenter();
    return createMapCameraPosition({
      position: usesNegativeTiltOffset ? this.logicalPosition : createGeoPoint({ latitude: center.lat, longitude: center.lng }),
      zoom: usesNegativeTiltOffset ? this.logicalZoom : this.map.getZoom(),
      bearing: this.logicalBearing,
      tilt: this.logicalTilt,
      visibleRegion: this.getVisibleRegion(),
    });
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

  setOnMarkerClickListener(listener: OnMarkerEventHandler | null): void { this.markerController.setOnClickListener(listener); }
  setOnMarkerDragStart(listener: OnMarkerEventHandler | null): void { this.markerController.setOnDragStart(listener); }
  setOnMarkerDrag(listener: OnMarkerEventHandler | null): void { this.markerController.setOnDrag(listener); }
  setOnMarkerDragEnd(listener: OnMarkerEventHandler | null): void { this.markerController.setOnDragEnd(listener); }
  setOnMarkerAnimateStart(listener: OnMarkerEventHandler | null): void { this.markerController.setOnAnimateStart(listener); }
  setOnMarkerAnimateEnd(listener: OnMarkerEventHandler | null): void { this.markerController.setOnAnimateEnd(listener); }
  setMarkerAnimationOverlayHost(host: MarkerAnimationOverlayHost | null): void { this.markerController.setMarkerAnimationOverlayHost(host); }

  /** Hide/show native DOM markers when the CSS tilt hack is toggled (see LeafletMapView). */
  setNativeMarkersVisible(visible: boolean): void { this.markerController.setNativeMarkersVisible(visible); }
  /** Live states of the non-tiled markers, drawn as upright billboards while tilted. */
  getNonTiledMarkerStates(): MarkerState[] { return this.markerController.getNonTiledMarkerStates(); }

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

  /**
   * Leaflet はネイティブの範囲制限 API を持つので直接適用する。
   *
   * Leaflet の `maxBounds` は単体ではパン中心しかクランプせず、ズームアウトで矩形外まで
   * 見えてしまう（LeafletProvider の生成時コメント参照）。生成時と同じく
   * `maxBoundsViscosity` はプロバイダ側で設定済みなので、ここでは矩形とズーム上下限のみ扱う。
   */
  override setCameraRestriction(restriction: CameraRestriction | null): void {
    // super は呼ばない。基底クラスに保持させるとカメラ停止時のクランプ補正まで走ってしまう。
    // ネイティブ API 側で既に制限されているので二重適用になる（android-sdk と同じ振り分け）。
    const effective = isEmptyCameraRestriction(restriction) ? null : restriction;

    const sw = effective?.bounds?.southWest ?? null;
    const ne = effective?.bounds?.northEast ?? null;
    if (sw != null && ne != null) {
      this.map.setMaxBounds([
        [sw.latitude, sw.longitude],
        [ne.latitude, ne.longitude],
      ]);
    } else {
      // Leaflet は解除に undefined を渡す（型定義上は LatLngBoundsExpression 必須）。
      (this.map as unknown as { setMaxBounds(b: undefined): void }).setMaxBounds(undefined);
    }

    // Leaflet のズームは統一ズーム（Google 準拠）と同一体系なので変換不要。
    this.map.setMinZoom(effective?.minZoom ?? 0);
    this.map.setMaxZoom(effective?.maxZoom ?? Infinity);
  }

  destroy(): void {
    super.destroy();
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
 * Quantize a programmatic zoom target to the nearest integer, mirroring how
 * Google Maps 2D (the project-wide camera reference) snaps zoom. Keeps Leaflet
 * aligned with Google at fractional demo zooms (Oahu 9.5 -> 10, Kiribati
 * 4.5 -> 5) instead of rendering the true half level Google never shows.
 */
function snapZoomToGoogle(zoom: number): number {
  return Math.round(zoom);
}

/**
 * Leaflet cannot pitch the camera upward. For negative tilt, move the ground
 * target forward and render the equivalent positive CSS tilt instead.
 */
function toLeafletCamera(position: MapCameraPosition): MapCameraPosition {
  // Google Maps 2D (the project-wide reference) snaps zoom to the nearest
  // integer (9.5 -> 10, 4.5 -> 5); Leaflet renders the true fractional zoom,
  // leaving the two up to half a level apart at fractional targets (e.g. Oahu
  // 9.5). Quantize programmatic targets the way Google does. Live zoom reported
  // from gestures (map.getZoom in getCameraPosition) stays fractional.
  if (position.tilt >= 0) return position.copy({ zoom: snapZoomToGoogle(position.zoom) });

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

function normalizePadding(value: number | undefined) {
  if (typeof value === 'number') {
    return { top: value, left: value, bottom: value, right: value };
  }
  return value;
}
