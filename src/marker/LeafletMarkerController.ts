import {
  AbstractMarkerController,
  LocalTileServer,
  MARKER_HIT_RADIUS_MOUSE_PX,
  MarkerManager,
  MarkerTileRenderer,
  MarkerTilingOptions,
  RasterLayerSource,
  createRasterLayerState,
  createGeoPoint,
  type GeoPoint,
  type MarkerAnimationOverlayHost,
  type MarkerEntity,
  type MarkerState,
  type OnMarkerEventHandler,
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

  async composition(data: MarkerState[]): Promise<void> {
    await this.add(data);
  }

  override async update(state: MarkerState): Promise<void> {
    // Leaflet's Draggable owns the marker position while a drag is active.
    // Re-applying every MarkerState emission through setLatLng() fights the
    // native drag transform and pulls the marker back toward its old position.
    if (this.isDragging(state)) return;
    await super.update(state);
  }

  has(state: MarkerState): boolean {
    return this.markerManager.hasEntity(state.id);
  }

  override find(position: GeoPoint): MarkerEntity<LeafletMarker> | null {
    return this.markerManager.findNearest(position);
  }

  findTiled(position: GeoPoint, zoom: number): MarkerEntity<LeafletMarker> | null {
    const found = this.tileRenderer?.findNearest(position, MARKER_HIT_RADIUS_MOUSE_PX, zoom);
    return found ? this.markerManager.getEntity(found.id) : null;
  }

  setOnClickListener(listener: OnMarkerEventHandler | null): void { this.clickListener = listener; }
  setOnDragStart(listener: OnMarkerEventHandler | null): void { this.dragStartListener = listener; }
  setOnDrag(listener: OnMarkerEventHandler | null): void { this.dragListener = listener; }
  setOnDragEnd(listener: OnMarkerEventHandler | null): void { this.dragEndListener = listener; }
  setOnAnimateStart(listener: OnMarkerEventHandler | null): void { this.animateStartListener = listener; }
  setOnAnimateEnd(listener: OnMarkerEventHandler | null): void { this.animateEndListener = listener; }

  setMarkerAnimationOverlayHost(host: MarkerAnimationOverlayHost | null): void {
    this.renderer.animationOverlayHost = host;
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
