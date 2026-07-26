import {
  AbstractMarkerController,
  LocalTileServer,
  MARKER_HIT_RADIUS_MOUSE_PX,
  MarkerManager,
  MarkerTileRenderer,
  MarkerTilingOptions,
  RasterLayerSource,
  Settings,
  createDefaultIcon,
  createRasterLayerState,
  createGeoPoint,
  type GeoPoint,
  type MarkerEntity,
  type MarkerState,
  type Offset,
  type RasterLayerState,
} from '@mapconductor/js-sdk-core';
import {
  DomEvent,
  type DragEndEvent,
  type LeafletEvent,
  type LeafletMouseEvent,
  type Marker as LeafletMarker,
} from 'leaflet';
import { LeafletMarkerOverlayRenderer } from './LeafletMarkerOverlayRenderer';

export class LeafletMarkerController extends AbstractMarkerController<LeafletMarker> {
  declare readonly renderer: LeafletMarkerOverlayRenderer;

  private tileRenderer: MarkerTileRenderer<MarkerState> | null = null;
  private tileRouteId: string | null = null;
  private tileVersion = 0;
  private tileGeneration = 0;

  onRasterLayerUpdate: ((state: RasterLayerState | null) => Promise<void>) | null = null;

  constructor(
    renderer: LeafletMarkerOverlayRenderer,
    private readonly tilingOptions: MarkerTilingOptions = MarkerTilingOptions.Default,
  ) {
    super({
      markerManager: MarkerManager.defaultManager<LeafletMarker>(
        null,
        tilingOptions.minMarkerCount,
      ),
      renderer,
    });
  }

  override async update(state: MarkerState): Promise<void> {
    // Leaflet's Draggable owns the marker position while a drag is active.
    // Re-applying every MarkerState emission through setLatLng() fights the
    // native drag transform and pulls the marker back toward its old position.
    if (this.isDragging(state)) return;
    await super.update(state);
  }

  findTiled(position: GeoPoint, zoom: number): MarkerEntity<LeafletMarker> | null {
    const found = this.tileRenderer?.findNearest(position, MARKER_HIT_RADIUS_MOUSE_PX, zoom);
    return found ? this.markerManager.getEntity(found.id) : null;
  }

  /**
   * Shows/hides every native Leaflet marker. The 2D view hides them while its
   * CSS tilt hack is active (they would otherwise lie flat against the ground)
   * and draws upright canvas billboards instead. The renderer only records the
   * flag so markers added later inherit it; the live entities live here, so the
   * toggle is applied here. Hit-testing is unaffected — clicks are resolved via
   * the map tap + find(), not the native marker's own event.
   */
  setNativeMarkersVisible(visible: boolean): void {
    this.renderer.setNativeVisible(visible);
    for (const entity of this.markerManager.allEntities()) {
      entity.marker?.setOpacity(visible ? 1 : 0);
      // While flattened by the CSS tilt, the native marker's DOM hit area is
      // skewed and no longer matches the upright canvas billboard, so stop it
      // receiving clicks; clicks then fall through to the map and are resolved
      // by findAtScreen against the billboard positions.
      const element = entity.marker?.getElement();
      if (element) element.style.pointerEvents = visible ? '' : 'none';
    }
  }

  /** Whether the native DOM markers are currently visible (false while tilted). */
  isNativeMarkersVisible(): boolean {
    return this.renderer.isNativeVisible;
  }

  /** Live states of the non-tiled (native DOM) markers, for the tilt billboard canvas. */
  getNonTiledMarkerStates(): MarkerState[] {
    return this.markerManager
      .allEntities()
      .filter(entity => entity.marker !== null)
      .map(entity => entity.state);
  }

  /**
   * Hit-tests non-tiled markers against an outer-container screen point (the same
   * space the canvas billboards are drawn in). Returns the top-most marker whose
   * upright icon rectangle contains the point, falling back to the nearest within
   * the tap tolerance. Used for clicks while tilted, where the native marker DOM
   * events are unreliable. Mirrors HERE's `find`.
   */
  findAtScreen(touch: Offset): MarkerEntity<LeafletMarker> | null {
    const holder = this.renderer.holder;
    const tolerance = Settings.Default.tapTolerance;
    let bestOnIcon: MarkerEntity<LeafletMarker> | null = null;
    let bestOnIconY = -Infinity;
    let bestNear: MarkerEntity<LeafletMarker> | null = null;
    let bestNearDistSq = Infinity;
    for (const entity of this.markerManager.allEntities()) {
      if (entity.marker === null) continue; // tiled markers are hit-tested via findTiled
      const markerScreen = holder.toOuterScreenOffset(entity.state.position);
      const icon = (entity.state.icon ?? createDefaultIcon()).toBitmapIcon();
      const dx = touch.x - markerScreen.x;
      const dy = touch.y - markerScreen.y;
      const left = -icon.anchor.x * icon.size.width;
      const right = (1 - icon.anchor.x) * icon.size.width;
      const top = -icon.anchor.y * icon.size.height;
      const bottom = (1 - icon.anchor.y) * icon.size.height;
      if (dx >= left && dx <= right && dy >= top && dy <= bottom) {
        if (markerScreen.y > bestOnIconY) {
          bestOnIconY = markerScreen.y;
          bestOnIcon = entity;
        }
      } else if (dx >= left - tolerance && dx <= right + tolerance && dy >= top - tolerance && dy <= bottom + tolerance) {
        const distSq = dx * dx + dy * dy;
        if (distSq < bestNearDistSq) {
          bestNearDistSq = distSq;
          bestNear = entity;
        }
      }
    }
    return bestOnIcon ?? bestNear;
  }

  override async clear(): Promise<void> {
    await super.clear();
    await this.removeTileOverlay();
  }

  override destroy(): void {
    void this.removeTileOverlay();
    super.destroy();
  }

  protected override shouldTile(state: MarkerState, totalCount: number): boolean {
    return this.tilingOptions.enabled &&
      totalCount >= this.tilingOptions.minMarkerCount &&
      !state.draggable &&
      state.getAnimation() == null;
  }

  protected override async onTiledMarkersChanged(): Promise<void> {
    await this.syncTiledOverlay();
  }

  protected override onMarkerAdded(entity: MarkerEntity<LeafletMarker>): void {
    const actual = entity.marker;
    if (!actual) return;
    const id = entity.state.id;
    const currentState = () => this.markerManager.getEntity(id)?.state ?? null;
    const updatePosition = () => {
      const state = currentState();
      if (!state) return null;
      const latLng = actual.getLatLng();
      state.setPosition(createGeoPoint({ latitude: latLng.lat, longitude: latLng.lng }));
      return state;
    };

    actual.on('click', (event: LeafletMouseEvent) => {
      // StoreMapPage closes its InfoBubble from MapView.onMapClick. Leaflet's
      // bubblingMouseEvents=false normally prevents the map click, but stop the
      // original DOM event as well so pointer/touch compatibility paths cannot
      // select the marker and immediately clear it again.
      DomEvent.stopPropagation(event.originalEvent);
      const state = currentState();
      if (state?.clickable) this.dispatchClick(state);
    });
    actual.on('dragstart', () => {
      const state = currentState();
      if (state) {
        this.setDraggingState(state, true);
        this.dispatchDragStart(state);
      }
    });
    actual.on('drag', () => {
      const state = updatePosition();
      if (state) this.dispatchDrag(state);
    });
    actual.on('dragend', (_event: DragEndEvent | LeafletEvent) => {
      const state = updatePosition();
      if (state) {
        this.setDraggingState(state, false);
        this.dispatchDragEnd(state);
        void super.update(state);
      }
    });
  }

  private async syncTiledOverlay(): Promise<void> {
    const generation = ++this.tileGeneration;
    const tiledStates = this.markerManager.allEntities()
      .filter(entity => entity.marker === null)
      .map(entity => entity.state);

    if (tiledStates.length === 0) {
      await this.removeTileOverlay();
      return;
    }

    this.tileRouteId ??= `mc-leaflet-tile-${generateId()}`;
    const server = LocalTileServer.startServer();
    const renderer = new MarkerTileRenderer(tiledStates, {
      tileSize: 256,
      iconScaleCallback: this.tilingOptions.iconScaleCallback ?? undefined,
    });
    this.tileRenderer = renderer;
    this.tileVersion++;
    server.register(this.tileRouteId, renderer);

    let template: string;
    if (LocalTileServer.isServiceWorkerSupported()) {
      server.startServiceWorker('/tile-sw.js');
      await server.waitForController();
      await server.sendSWRegisterAndWait(this.tileRouteId, await renderer.toSWData());
      template = server.urlTemplate({
        routeId: this.tileRouteId,
        tileSize: 256,
        cacheKey: String(this.tileVersion),
      });
    } else {
      await renderer.preloadIcons();
      template = `mc-local-tile://${this.tileRouteId}/256/${this.tileVersion}/{z}/{x}/{y}.png`;
    }

    if (generation !== this.tileGeneration) return;
    await this.onRasterLayerUpdate?.(createRasterLayerState({
      id: 'mc-marker-tiles',
      source: RasterLayerSource.UrlTemplate({ template, tileSize: 256 }),
    }));
  }

  private async removeTileOverlay(): Promise<void> {
    this.tileGeneration++;
    if (!this.tileRouteId) return;
    LocalTileServer.startServer().unregister(this.tileRouteId);
    this.tileRenderer = null;
    this.tileRouteId = null;
    await this.onRasterLayerUpdate?.(null);
  }
}

function generateId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
}
