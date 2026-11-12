import { PolygonTiler, POLYGON_TILE_LAYER_ID, polygonTileRasterLayerState, POLYLINE_TILE_LAYER_ID, polylineTileRasterLayerState, CIRCLE_TILE_LAYER_ID, circleTileRasterLayerState } from '@mapconductor/js-sdk-core';
import {
  buildVisibleRegion,
  BaseMapViewController,
  createGeoPoint,
  createMapCameraPosition,
  computeOffset,
  MapUISettingsDiagnostics,
  isEmptyCameraRestriction,
  type MapUISettings,
  type CameraRestriction,
  type CircleCapable,
  type GeoPoint,
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
  type VisibleRegion, toNativeHeading, } from '@mapconductor/js-sdk-core';
import { point, tileLayer, type LatLng, type LeafletMouseEvent, type Map as LeafletMap, type Point, type TileLayer } from 'leaflet';
import type { LeafletMapDesignType } from './LeafletDesign';
import { LeafletMapViewHolder } from './LeafletMapViewHolder';
import { fromLeafletEvent } from './helpers';
import { LeafletMarkerController, pointerTolerance } from './marker/LeafletMarkerController';
import {
  LeafletCircleController,
  LeafletGroundImageController,
  LeafletPolygonController,
  LeafletPolylineController,
} from './vector/LeafletVectorControllers';
import { LeafletRasterLayerController } from './raster/LeafletRasterLayer';

/** Pointer travel before a press becomes a drag (a click below it). */
const DRAG_SLOP_PX = 4;

/** Zoom levels for one wheel event: a mouse notch is about one level. */
function wheelZoomDelta(event: WheelEvent): number {
  const pixels = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY;
  return Math.max(-1, Math.min(1, -pixels / 100));
}

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
  /** The basemap tile layer, or null for `LeafletDesign.None`. */
  private baseLayer: TileLayer | null;
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
    baseLayer: TileLayer | null = null,
  ) {
    super();
    this.baseLayer = baseLayer;

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
    // Many polygons are drawn as tiles by the tile service worker and shown
    // as one raster layer; taps still resolve against the original shapes.
    this.polygonController.tiler = new PolygonTiler();
    this.polygonController.tiler.onTemplate = async (template, tileSize) => {
      if (template) await this.rasterLayerController.upsert(polygonTileRasterLayerState(template, tileSize));
      else await this.rasterLayerController.removeById(POLYGON_TILE_LAYER_ID);
    };
    // Many polylines are drawn as tiles too (the tiler is set by the provider, with the map's
    // PolylineTilingOptions) and shown as one raster layer, in the polyline band.
    if (this.polylineController.tiler) {
      this.polylineController.tiler.onTemplate = async (template, tileSize) => {
        if (template) await this.rasterLayerController.upsert(polylineTileRasterLayerState(template, tileSize));
        else await this.rasterLayerController.removeById(POLYLINE_TILE_LAYER_ID);
      };
    }
    // Many circles are drawn as tiles too (the tiler is set by the provider, with the map's
    // CircleTilingOptions) and shown as one raster layer, at the bottom of the circle band.
    if (this.circleController.tiler) {
      this.circleController.tiler.onTemplate = async (template, tileSize) => {
        if (template) await this.rasterLayerController.upsert(circleTileRasterLayerState(template, tileSize));
        else await this.rasterLayerController.removeById(CIRCLE_TILE_LAYER_ID);
      };
    }
    markerController.onRasterLayerUpdate = async state => {
      if (state) await rasterLayerController.updateInternal(state);
      else await rasterLayerController.removeInternal('mc-marker-tiles');
    };
    this.setupEvents();
    this.uninstallTransformedGestures = this.installTransformedGestures();
  }

  getMap(): LeafletMap { return this.map; }

  /**
   * Swaps the basemap tile layer in place. Overlays live in panes of their
   * own (see the raster renderer), so the new layer slots in underneath
   * them. Called by the view state's `mapDesignType` setter.
   */
  setMapDesignType(design: LeafletMapDesignType): void {
    this.baseLayer?.remove();
    this.baseLayer = design.tileUrl ? tileLayer(design.tileUrl, design.tileOptions).addTo(this.map) : null;
  }

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
      const clicked = this.eventGeoPoint(event);
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
        const entity = outer ? this.markerController.findAtScreen(outer, pointerTolerance(event.originalEvent)) : null;
        if (entity?.state.clickable) {
          this.markerController.dispatchClick(entity.state);
          return;
        }
      }
      // オーバーレイのクリックはコアの幾何ヒットテスト（タップ許容つき）で解決する。
      // Leaflet のオーバーレイ層は non-interactive で描いてあるので、クリックは
      // Leaflet 自身の細いパスヒットではなくここへ落ちてくる。
      //
      // 順序と先勝ちはコアの dispatchOverlayTap が持つ
      // （circle → groundImage → polyline → polygon）。移行前はここで
      // polyline → polygon → circle → groundImage の独自順だった。
      const camera = this.getCameraPosition() ?? null;
      if (camera) void this.polylineController.onCameraChanged(camera);
      if (this.dispatchOverlayTap(clicked)) return;
      this.notifyMapClick(clicked);
    });
    this.map.on('contextmenu', (event: LeafletMouseEvent) => {
      this.notifyMapLongClick(this.eventGeoPoint(event));
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

  /** @internal */
  private isPlaneTransformed(): boolean {
    return Math.min(60, Math.abs(this.logicalTilt)) > 0.5 || Math.abs(this.logicalBearing) > 0.01;
  }

  /** @internal */
  private outerToContainerPoint(offset: Offset): Point {
    const inner = this.holder.outerToInnerOffset(offset);
    return point(inner.x, inner.y);
  }

  /**
   * The ground point of a map event. Leaflet reads the pointer against the
   * container's bounding box, which the plane's CSS rotation/tilt throws off,
   * so while the plane is transformed the point is reprojected from the
   * pointer's position in the outer container.
   *
   * @internal
   */
  private eventGeoPoint(event: LeafletMouseEvent): GeoPoint {
    if (this.isPlaneTransformed()) {
      const outer = this.outerOffsetFromEvent(event.originalEvent);
      if (outer) {
        const latLng = this.map.containerPointToLatLng(this.outerToContainerPoint(outer));
        return createGeoPoint({ latitude: latLng.lat, longitude: latLng.lng });
      }
    }
    return fromLeafletEvent(event);
  }

  /** @internal */
  private uninstallTransformedGestures: () => void = () => {};

  /**
   * Pans, wheel-zooms and drags markers by hand while the plane is rotated or
   * tilted.
   *
   * Leaflet's dragging and wheel zoom read the pointer in the plane's
   * untransformed pixels, so on a rotated map the map slides off at the
   * bearing's angle and zooms toward the wrong point. The native markers are
   * hidden meanwhile (upright billboards are drawn instead), so their drag
   * cannot start either. While the plane is transformed:
   *
   * - a press on a draggable marker drags it, keeping the grab offset on
   *   screen, once the pointer has moved past `DRAG_SLOP_PX`;
   * - any other press pans, keeping the grabbed ground point under the pointer;
   * - the wheel zooms about the ground under the cursor.
   *
   * With dragging switched off, Leaflet would treat the release after a pan
   * or marker drag as a click, so that click is swallowed. A flat, north-up
   * map keeps Leaflet's own gestures (and its inertia). Listens in the capture
   * phase on the plane's parent so it runs before Leaflet's own pointer
   * handling. Returns the uninstaller.
   *
   * @internal
   */
  private installTransformedGestures(): () => void {
    const outer = this.holder.mapView.parentElement;
    if (!outer) return () => {};
    let pointerId: number | null = null;
    let down: Offset | null = null;
    let moved = false;
    let swallowClick = false;
    let resumeDragging = false;
    // Pan: the ground point grabbed. Marker drag: the marker and the pointer's
    // offset from its anchor on screen.
    let anchor: LatLng | null = null;
    let marker: { state: MarkerState; grab: Offset; started: boolean } | null = null;
    let wheelZoom = 0;

    const screenOffset = (event: MouseEvent): Offset => {
      const rect = outer.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const latLngAt = (offset: Offset) => this.map.containerPointToLatLng(this.outerToContainerPoint(offset));

    const end = () => {
      if (pointerId == null) return;
      pointerId = null;
      down = null;
      anchor = null;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      if (marker?.started) this.markerController.endScreenDrag(marker.state);
      marker = null;
      swallowClick = moved;
      if (resumeDragging) this.map.dragging?.enable();
      resumeDragging = false;
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      const at = screenOffset(event);
      if (!moved && down && Math.hypot(at.x - down.x, at.y - down.y) >= DRAG_SLOP_PX) moved = true;
      if (marker) {
        if (!marker.started) {
          if (!moved) return;
          marker.started = true;
          this.markerController.beginScreenDrag(marker.state);
        }
        const latLng = latLngAt({ x: at.x - marker.grab.x, y: at.y - marker.grab.y });
        this.markerController.moveScreenDrag(marker.state, createGeoPoint({ latitude: latLng.lat, longitude: latLng.lng }));
        return;
      }
      if (!anchor) return;
      // Both points in the container's own pixels: move the view by the gap
      // between where the anchor is and where the pointer now is.
      const anchorPx = this.map.latLngToContainerPoint(anchor);
      const pointerPx = this.outerToContainerPoint(at);
      this.map.panBy(anchorPx.subtract(pointerPx), { animate: false });
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId === pointerId) end();
    };
    const onDown = (event: PointerEvent) => {
      swallowClick = false;
      if (pointerId != null) {
        // A second finger: leave the gesture (pinch) to Leaflet.
        end();
        return;
      }
      if (!event.isPrimary || event.button !== 0 || !this.isPlaneTransformed()) return;
      const at = screenOffset(event);
      const hit = this.markerController.isNativeMarkersVisible()
        ? null
        : this.markerController.findAtScreen(at, pointerTolerance(event));
      if (hit?.state.draggable) {
        const anchorScreen = this.holder.toOuterScreenOffset(hit.state.position);
        marker = { state: hit.state, grab: { x: at.x - anchorScreen.x, y: at.y - anchorScreen.y }, started: false };
      } else if (this.map.dragging?.enabled()) {
        anchor = latLngAt(at);
      } else {
        // Dragging switched off by the app's UI settings: no panning at all.
        return;
      }
      pointerId = event.pointerId;
      down = at;
      moved = false;
      if (this.map.dragging?.enabled()) {
        this.map.dragging.disable();
        resumeDragging = true;
      }
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onUp, true);
    };
    const onClick = (event: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.stopPropagation();
      event.preventDefault();
    };

    // Wheel zoom anchors on the pointer read the same untransformed way, so it
    // zooms toward the wrong point; zoom about the ground under the cursor.
    const onWheel = (event: WheelEvent) => {
      if (!this.isPlaneTransformed() || !this.map.scrollWheelZoom?.enabled()) return;
      event.preventDefault();
      event.stopPropagation();
      // Leaflet snaps zoom to `zoomSnap`, so a trackpad's small steps are
      // gathered until they add up to one.
      wheelZoom += wheelZoomDelta(event);
      const snap = this.map.options.zoomSnap ?? 1;
      const step = snap > 0 ? Math.trunc(wheelZoom / snap) * snap : wheelZoom;
      if (step === 0) return;
      wheelZoom -= step;
      this.map.setZoomAround(this.outerToContainerPoint(screenOffset(event)), this.map.getZoom() + step, { animate: false });
    };

    outer.addEventListener('pointerdown', onDown, true);
    outer.addEventListener('click', onClick, true);
    outer.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => {
      end();
      outer.removeEventListener('pointerdown', onDown, true);
      outer.removeEventListener('click', onClick, true);
      outer.removeEventListener('wheel', onWheel, true);
    };
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

  /** レイアウト前（幅か高さが 0）は null。他プロバイダと同じ契約にそろえた。 */
  private getVisibleRegion(): VisibleRegion | null {
    // holder の screen offset は外枠（見えている画面）の座標。地図は 200% の
    // 平面に描いているので、平面ではなく外枠の 4 隅を逆投影する。
    const outer = this.holder.mapView.parentElement;
    const size = this.map.getSize();
    const width = outer?.offsetWidth || size.x;
    const height = outer?.offsetHeight || size.y;
    // 4 隅の逆投影と bounds の組み立てはコアの buildVisibleRegion が持つ。
    return buildVisibleRegion(this.holder, { width, height });
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
    await this.clearOverlayControllers([
      this.markerController,
      this.circleController,
      this.polylineController,
      this.polygonController,
      this.groundImageController,
      this.rasterLayerController,
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
    this.uninstallTransformedGestures();
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
    heading: toNativeHeading(position.bearing),
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
