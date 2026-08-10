import { MapDesignTypeInterface, AttributionRule, MapViewStateInterface, MapViewState, MapCameraPosition, MapViewControllerInterface, MapViewBaseProps, GeoRectBounds, MarkerTilingOptions, MapViewHolderBase, GeoPointInterface, Offset, GeoPoint, AbstractMarkerOverlayRenderer, AddParams, ChangeParams, MarkerEntity, AbstractMarkerController, RasterLayerState, MarkerState, CircleController, AbstractCircleOverlayRenderer, CircleState, CircleEntity, PolylineController, AbstractPolylineOverlayRenderer, PolylineState, PolylineEntity, PolygonController, AbstractPolygonOverlayRenderer, PolygonState, PolygonEntity, GroundImageController, AbstractGroundImageOverlayRenderer, GroundImageState, GroundImageEntity, RasterLayerController, RasterHeaderSupport, RasterLayerAddParams, RasterLayerChangeParams, RasterLayerEntity, BaseMapViewController, MarkerCapable, CircleCapable, PolylineCapable, PolygonCapable, GroundImageCapable, RasterLayerCapable, MapUISettings, OnMapInitializedHandler, OnMarkerEventHandler, MarkerAnimationOverlayHost, CameraRestriction, MapConfig, MapProvider } from '@mapconductor/js-sdk-core';
import { TileLayerOptions, MapOptions, Map, Marker, Polygon, Polyline, ImageOverlay, GridLayer } from 'leaflet';
import * as react from 'react';
import { CSSProperties, ReactNode } from 'react';

interface LeafletMapDesignType extends MapDesignTypeInterface<string> {
    readonly tileUrl: string | null;
    readonly tileOptions: TileLayerOptions;
}
interface LeafletDesignParams {
    id: string;
    tileUrl: string | null;
    tileOptions?: TileLayerOptions;
    attributionRules?: readonly AttributionRule[];
}
declare class LeafletDesign implements LeafletMapDesignType {
    readonly id: string;
    readonly tileUrl: string | null;
    readonly tileOptions: TileLayerOptions;
    readonly attributionRules: readonly AttributionRule[];
    constructor({ id, tileUrl, tileOptions, attributionRules, }: LeafletDesignParams);
    getValue(): string;
    static readonly OpenStreetMap: LeafletDesign;
    static readonly None: LeafletDesign;
}

interface LeafletMapViewStateInterface extends MapViewStateInterface<LeafletMapDesignType> {
}
interface LeafletMapViewStateParams {
    id?: string;
    mapDesignType?: LeafletMapDesignType;
    cameraPosition?: MapCameraPosition;
}
declare class LeafletMapViewState extends MapViewState<LeafletMapDesignType> implements LeafletMapViewStateInterface {
    private _mapDesignType;
    constructor({ id, mapDesignType, cameraPosition, }?: LeafletMapViewStateParams);
    get mapDesignType(): LeafletMapDesignType;
    set mapDesignType(value: LeafletMapDesignType);
    /** このプロバイダは接続時にカメラを動かさない（ビュー側が別経路で初期位置を当てる）。 */
    setController(controller: MapViewControllerInterface | null): void;
}
declare function useLeafletMapViewState(params?: LeafletMapViewStateParams): LeafletMapViewStateInterface;

interface LeafletMapViewProps extends MapViewBaseProps<LeafletMapViewStateInterface> {
    maxZoom?: number;
    minZoom?: number;
    /** Restricts panning/zooming so the viewport cannot leave this rectangle. */
    restrictBounds?: GeoRectBounds;
    className?: string;
    containerStyle?: CSSProperties;
    options?: MapOptions;
    onError?: (error: Error) => void;
    children?: ReactNode;
    markerTilingOptions?: MarkerTilingOptions;
}
declare function LeafletMapView({ state, onMapLoaded, onMapClick, onMapLongClick, onCameraMoveStart, onCameraMove, onCameraMoveEnd, maxZoom, minZoom, restrictBounds, cameraRestriction, className, containerStyle, options, onError, children, markerTilingOptions, }: LeafletMapViewProps): react.JSX.Element;

declare class LeafletMapViewHolder extends MapViewHolderBase<HTMLElement, Map> {
    readonly mapView: HTMLElement;
    readonly map: Map;
    private controller;
    constructor(mapView: HTMLElement, map: Map);
    getController(): LeafletMapViewController | null;
    setController(controller: LeafletMapViewController): void;
    toScreenOffset(position: GeoPointInterface): Offset;
    fromScreenOffsetSync(offset: Offset): GeoPoint;
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
    toOuterScreenOffset(position: GeoPointInterface): Offset;
    /**
     * Apply the inner container's CSS transform to convert inner-local pixels
     * (relative to the inner's pre-transform top-left) into outer-local pixels
     * (relative to the visible wrapper that hosts the screen-space overlays).
     */
    private innerToOuterOffset;
}

declare class LeafletMarkerOverlayRenderer extends AbstractMarkerOverlayRenderer<LeafletMapViewHolder, Marker> {
    /**
     * Whether the native Leaflet DOM markers should be visible. The 2D view fakes
     * camera tilt with a CSS `rotateX` on the map plane, which lays the DOM marker
     * icons flat against the ground. While tilted the view hides these native
     * markers (via `setNativeVisible(false)`) and draws upright, billboarded icons
     * on a canvas instead. Markers created while hidden must inherit this state,
     * so onAdd applies it too.
     */
    private nativeVisible;
    private readonly logicalPositions;
    private readonly reprojectMarkers;
    constructor(holder: LeafletMapViewHolder);
    /**
     * The marker's lat/lng shifted so its longitude lands in the same world copy
     * as the current map center (see `logicalPositions`).
     */
    private nearestCopyLatLng;
    /** Whether native markers should currently be visible (see `nativeVisible`). */
    get isNativeVisible(): boolean;
    /**
     * Remembers whether native markers should be visible so markers added
     * afterwards (see onAdd) inherit the state. The live entities are owned by the
     * controller's MarkerManager, so toggling existing markers is done there
     * (LeafletMarkerController.setNativeMarkersVisible), not here.
     */
    setNativeVisible(visible: boolean): void;
    onAdd(data: AddParams[]): Promise<(Marker | null)[]>;
    onChange(data: ChangeParams<Marker>[]): Promise<(Marker | null)[]>;
    onRemove(data: MarkerEntity<Marker>[]): Promise<void>;
    onPostProcess(): Promise<void>;
    setMarkerPosition(entity: MarkerEntity<Marker>, position: GeoPoint): void;
    setMarkerVisible(entity: MarkerEntity<Marker>, visible: boolean): void;
    private toLeafletIcon;
}

declare class LeafletMarkerController extends AbstractMarkerController<Marker> {
    private readonly tilingOptions;
    readonly renderer: LeafletMarkerOverlayRenderer;
    private tileRenderer;
    private tileRouteId;
    private tileVersion;
    private tileGeneration;
    onRasterLayerUpdate: ((state: RasterLayerState | null) => Promise<void>) | null;
    constructor(renderer: LeafletMarkerOverlayRenderer, tilingOptions?: MarkerTilingOptions);
    update(state: MarkerState): Promise<void>;
    findTiled(position: GeoPoint, zoom: number): MarkerEntity<Marker> | null;
    /**
     * Shows/hides every native Leaflet marker. The 2D view hides them while its
     * CSS tilt hack is active (they would otherwise lie flat against the ground)
     * and draws upright canvas billboards instead. The renderer only records the
     * flag so markers added later inherit it; the live entities live here, so the
     * toggle is applied here. Hit-testing is unaffected — clicks are resolved via
     * the map tap + find(), not the native marker's own event.
     */
    setNativeMarkersVisible(visible: boolean): void;
    /** Whether the native DOM markers are currently visible (false while tilted). */
    isNativeMarkersVisible(): boolean;
    /** Live states of the non-tiled (native DOM) markers, for the tilt billboard canvas. */
    getNonTiledMarkerStates(): MarkerState[];
    /**
     * Hit-tests non-tiled markers against an outer-container screen point (the same
     * space the canvas billboards are drawn in). Returns the top-most marker whose
     * upright icon rectangle contains the point, falling back to the nearest within
     * the tap tolerance. Used for clicks while tilted, where the native marker DOM
     * events are unreliable. Mirrors HERE's `find`.
     */
    findAtScreen(touch: Offset): MarkerEntity<Marker> | null;
    clear(): Promise<void>;
    destroy(): void;
    protected shouldTile(state: MarkerState, totalCount: number): boolean;
    protected onTiledMarkersChanged(): Promise<void>;
    protected onMarkerAdded(entity: MarkerEntity<Marker>): void;
    private syncTiledOverlay;
    private removeTileOverlay;
}

declare class LeafletCircleRenderer extends AbstractCircleOverlayRenderer<LeafletMapViewHolder, Polygon> {
    createCircle(state: CircleState): Promise<Polygon>;
    updateCircleProperties({ circle: actual, current, }: {
        circle: Polygon;
        current: CircleEntity<Polygon>;
        prev: CircleEntity<Polygon>;
    }): Promise<Polygon>;
    removeCircle(entity: CircleEntity<Polygon>): Promise<void>;
}
declare class LeafletCircleController extends CircleController<Polygon> {
    constructor(renderer: LeafletCircleRenderer);
    handleMapClick(clicked: GeoPoint): boolean;
}
declare class LeafletPolylineRenderer extends AbstractPolylineOverlayRenderer<LeafletMapViewHolder, Polyline> {
    createPolyline(state: PolylineState): Promise<Polyline>;
    updatePolylineProperties({ polyline: actual, current, }: {
        polyline: Polyline;
        current: PolylineEntity<Polyline>;
        prev: PolylineEntity<Polyline>;
    }): Promise<Polyline>;
    removePolyline(entity: PolylineEntity<Polyline>): Promise<void>;
}
declare class LeafletPolylineController extends PolylineController<Polyline> {
    constructor(renderer: LeafletPolylineRenderer);
    handleMapClick(clicked: GeoPoint, camera: MapCameraPosition | null): boolean;
}
declare class LeafletPolygonRenderer extends AbstractPolygonOverlayRenderer<LeafletMapViewHolder, Polygon> {
    createPolygon(state: PolygonState): Promise<Polygon>;
    updatePolygonProperties({ polygon: actual, current, }: {
        polygon: Polygon;
        current: PolygonEntity<Polygon>;
        prev: PolygonEntity<Polygon>;
    }): Promise<Polygon>;
    removePolygon(entity: PolygonEntity<Polygon>): Promise<void>;
}
declare class LeafletPolygonController extends PolygonController<Polygon> {
    constructor(renderer: LeafletPolygonRenderer);
    handleMapClick(clicked: GeoPoint): boolean;
}
declare class LeafletGroundImageRenderer extends AbstractGroundImageOverlayRenderer<LeafletMapViewHolder, ImageOverlay> {
    createGroundImage(state: GroundImageState): Promise<ImageOverlay | null>;
    updateGroundImageProperties({ groundImage: actual, current, }: {
        groundImage: ImageOverlay;
        current: GroundImageEntity<ImageOverlay>;
        prev: GroundImageEntity<ImageOverlay>;
    }): Promise<ImageOverlay | null>;
    removeGroundImage(entity: GroundImageEntity<ImageOverlay>): Promise<void>;
}
declare class LeafletGroundImageController extends GroundImageController<ImageOverlay> {
    constructor(renderer: LeafletGroundImageRenderer);
    handleMapClick(clicked: GeoPoint): boolean;
}

declare class LeafletRasterLayerRenderer {
    readonly holder: LeafletMapViewHolder;
    constructor(holder: LeafletMapViewHolder);
    onAdd(data: RasterLayerAddParams[]): Promise<(GridLayer | null)[]>;
    onChange(data: RasterLayerChangeParams<GridLayer>[]): Promise<(GridLayer | null)[]>;
    onRemove(data: RasterLayerEntity<GridLayer>[]): Promise<void>;
    onCameraChanged(_mapCameraPosition: MapCameraPosition): Promise<void>;
    onPostProcess(): Promise<void>;
    private create;
}
declare class LeafletRasterLayerController extends RasterLayerController<GridLayer> {
    /**
     * ヘッダ指定があるときだけ fetch でタイルを取る HeaderTileLayer に切り替える。
     *
     * userAgent はブラウザが上書きを許さないので、どのプロバイダでも web では効かない。
     */
    protected get headerSupport(): RasterHeaderSupport;
    constructor(renderer: LeafletRasterLayerRenderer);
    composition(data: RasterLayerState[]): Promise<void>;
    update(state: RasterLayerState): Promise<void>;
    updateInternal(state: RasterLayerState): Promise<void>;
    removeInternal(id: string): Promise<void>;
}

declare class LeafletMapViewController extends BaseMapViewController implements MapViewControllerInterface, MarkerCapable, CircleCapable, PolylineCapable, PolygonCapable, GroundImageCapable, RasterLayerCapable {
    readonly holder: LeafletMapViewHolder;
    private readonly markerController;
    private readonly circleController;
    private readonly polylineController;
    private readonly polygonController;
    private readonly groundImageController;
    private readonly rasterLayerController;
    private readonly map;
    private destroyed;
    private logicalTilt;
    private logicalPosition;
    private logicalZoom;
    private logicalBearing;
    constructor(holder: LeafletMapViewHolder, markerController: LeafletMarkerController, circleController: LeafletCircleController, polylineController: LeafletPolylineController, polygonController: LeafletPolygonController, groundImageController: LeafletGroundImageController, rasterLayerController: LeafletRasterLayerController, initialTilt?: number, initialBearing?: number);
    getMap(): Map;
    /**
     * Leaflet has no rotation or tilt of its own — MapConductor fakes both with a
     * CSS transform on the map pane, so there is no gesture to switch off. Pan and
     * zoom are real Leaflet handlers.
     */
    applyUISettings(settings: MapUISettings): void;
    private setupEvents;
    setMapInitializedListener(listener: OnMapInitializedHandler | null): void;
    /**
     * The pointer position of a DOM event in the outer (untransformed) container's
     * pixel space — the same space the tilt billboard canvas and `findAtScreen`
     * use (see LeafletMapViewHolder.toOuterScreenOffset).
     */
    private outerOffsetFromEvent;
    moveCamera(position: MapCameraPosition): Promise<boolean>;
    animateCamera(position: MapCameraPosition, durationMillis: number): Promise<boolean>;
    fitBounds(bounds: GeoRectBounds, padding: number): Promise<boolean>;
    getCameraPosition(): MapCameraPosition;
    private getVisibleRegion;
    private notifyControllersCameraChanged;
    setOnMarkerClickListener(listener: OnMarkerEventHandler | null): void;
    setOnMarkerDragStart(listener: OnMarkerEventHandler | null): void;
    setOnMarkerDrag(listener: OnMarkerEventHandler | null): void;
    setOnMarkerDragEnd(listener: OnMarkerEventHandler | null): void;
    setOnMarkerAnimateStart(listener: OnMarkerEventHandler | null): void;
    setOnMarkerAnimateEnd(listener: OnMarkerEventHandler | null): void;
    setMarkerAnimationOverlayHost(host: MarkerAnimationOverlayHost | null): void;
    /** Hide/show native DOM markers when the CSS tilt hack is toggled (see LeafletMapView). */
    setNativeMarkersVisible(visible: boolean): void;
    /** Live states of the non-tiled markers, drawn as upright billboards while tilted. */
    getNonTiledMarkerStates(): MarkerState[];
    clearOverlays(): Promise<void>;
    /**
     * Leaflet はネイティブの範囲制限 API を持つので直接適用する。
     *
     * Leaflet の `maxBounds` は単体ではパン中心しかクランプせず、ズームアウトで矩形外まで
     * 見えてしまう（LeafletProvider の生成時コメント参照）。生成時と同じく
     * `maxBoundsViscosity` はプロバイダ側で設定済みなので、ここでは矩形とズーム上下限のみ扱う。
     */
    setCameraRestriction(restriction: CameraRestriction | null): void;
    destroy(): void;
}

interface LeafletConfig extends MapConfig {
    mapDesignType: LeafletMapDesignType;
    maxZoom?: number;
    minZoom?: number;
    /** Restricts panning/zooming so the viewport cannot leave this rectangle. */
    restrictBounds?: GeoRectBounds;
    markerTilingOptions?: MarkerTilingOptions;
    options?: MapOptions;
}
declare class LeafletProvider extends MapProvider {
    initialize(config: LeafletConfig): Promise<MapViewControllerInterface>;
    destroy(): void;
}

export { type LeafletConfig, LeafletDesign, type LeafletMapDesignType, LeafletMapView, LeafletMapViewController, LeafletMapViewHolder, type LeafletMapViewProps, LeafletMapViewState, type LeafletMapViewStateInterface, type LeafletMapViewStateParams, LeafletProvider, useLeafletMapViewState };
