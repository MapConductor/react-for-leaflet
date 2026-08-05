import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  InfoBubbleOverlay,
  MapContext,
  MapViewScope,
  MapViewScopeProvider,
  MarkerAnimationLayer,
  MapAttributionOverlay,
  useMapUISettings,
  type InfoBubbleEntry,
} from '@mapconductor/js-sdk-react';
import {
  MarkerTilingOptions,
  createDefaultIcon,
  type GeoPoint,
  type GeoRectBounds,
  type MapCameraPosition,
  type MapViewBaseProps,
  type MarkerAnimationOverlayEntry,
  type OverlayCollector,
} from '@mapconductor/js-sdk-core';
import type { MapOptions } from 'leaflet';
import { LeafletProvider, type LeafletConfig } from './LeafletProvider';
import type { LeafletMapViewStateInterface } from './LeafletMapViewState';
import type { LeafletMapViewController } from './LeafletMapViewController';

export interface LeafletMapViewProps extends MapViewBaseProps<LeafletMapViewStateInterface> {
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

/**
 * While the 2D view fakes tilt with a CSS `rotateX` on the map plane, native
 * Leaflet DOM markers would be flattened against the ground, so they're hidden
 * and their upright "billboards" are drawn here instead. A single `<canvas>`
 * (redrawn on a rAF so markers stay glued to the map during pans/zooms/tilts)
 * lives in the untransformed outer container and positions each icon via the
 * tilt-aware `toOuterScreenOffset`. Only non-tiled markers are drawn; tiled
 * markers are painted by the raster tile layer, which is part of the tilted
 * plane. The canvas is draw-only (`pointer-events: none`); clicks flow through
 * the map's tap handler. Mirrors HERE's `HereTiltMarkerCanvas`.
 */
function LeafletTiltMarkerCanvas({
  controller,
  active,
}: {
  controller: LeafletMapViewController;
  active: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const images = new Map<string, HTMLImageElement>();
    const imageFor = (url: string): HTMLImageElement | null => {
      let img = images.get(url);
      if (!img) {
        img = new Image();
        img.src = url;
        images.set(url, img);
      }
      return img.complete && img.naturalWidth > 0 ? img : null;
    };

    let raf = 0;
    const draw = () => {
      const parent = canvas.parentElement;
      const width = parent?.clientWidth ?? 0;
      const height = parent?.clientHeight ?? 0;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const holder = controller.holder;
      const items = controller
        .getNonTiledMarkerStates()
        // Markers currently animating (Drop/Bounce) are drawn by the screen-space
        // animation overlay; drawing them here too would leave a static duplicate.
        .filter(marker => marker.getAnimation() == null)
        .map(marker => {
          const bitmapIcon = (marker.icon ?? createDefaultIcon()).toBitmapIcon();
          const screen = holder.toOuterScreenOffset(marker.position);
          return { bitmapIcon, x: screen.x, y: screen.y };
        })
        // Nearer markers (lower on screen) paint last so they overlap those
        // behind them, matching the tilted perspective.
        .sort((a, b) => a.y - b.y);

      for (const { bitmapIcon, x, y } of items) {
        const img = imageFor(bitmapIcon.url);
        if (!img) continue;
        const { width: w, height: h } = bitmapIcon.size;
        ctx.drawImage(img, x - bitmapIcon.anchor.x * w, y - bitmapIcon.anchor.y * h, w, h);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [active, controller]);

  if (!active) return null;
  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, zIndex: 600, pointerEvents: 'none' }}
    />
  );
}

export function LeafletMapView({
  state,
  onMapLoaded,
  onMapClick,
  onMapLongClick,
  onCameraMoveStart,
  onCameraMove,
  onCameraMoveEnd,
  maxZoom,
  minZoom,
  restrictBounds,
  className,
  containerStyle,
  options,
  onError,
  children,
  markerTilingOptions,
}: LeafletMapViewProps) {
  const outerContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [provider] = useState(() => new LeafletProvider());
  const [scope] = useState(() => new MapViewScope());
  const [controller, setController] = useState<LeafletMapViewController | null>(null);
  const [isReady, setIsReady] = useState(false);
  const typedControllerRef = useRef<LeafletMapViewController | null>(null);
  const bridgeUnsubs = useRef<(() => void)[]>([]);
  const [bubbleEntries, setBubbleEntries] = useState<InfoBubbleEntry[]>([]);
  const [animationEntries, setAnimationEntries] = useState<MarkerAnimationOverlayEntry[]>([]);
  const [, setCameraTick] = useState(0);
  const [visualTilt, setVisualTilt] = useState(() => state.cameraPosition.tilt);
  const [visualBearing, setVisualBearing] = useState(() => state.cameraPosition.bearing);
  // Keep a larger Leaflet viewport behind the clipped container. This gives
  // the transformed plane content on every side while keeping its center
  // aligned with the camera center.
  // Negative tilt is represented by a forward target shift in the controller;
  // the rendered plane always uses the corresponding positive angle.
  const experimentalTilt = Math.min(60, Math.abs(visualTilt));
  // While tilted, the CSS `rotateX` below lays the native DOM markers flat, so
  // they're hidden and drawn as upright canvas billboards instead.
  const isTilted = experimentalTilt > 0.5;
  const mapPlaneStyle: CSSProperties = {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: '200%',
    height: '200%',
    transform: `translate(-50%, -50%) rotateZ(${-visualBearing}deg) rotateX(${experimentalTilt}deg)`,
    transformOrigin: '50% 50%',
    transformStyle: 'flat',
    willChange: 'transform',
    backfaceVisibility: 'hidden',
  };

  const onMapLoadedRef = useRef(onMapLoaded);
  const onMapClickRef = useRef(onMapClick);
  const onMapLongClickRef = useRef(onMapLongClick);
  const onCameraMoveStartRef = useRef(onCameraMoveStart);
  const onCameraMoveRef = useRef(onCameraMove);
  const onCameraMoveEndRef = useRef(onCameraMoveEnd);
  const onErrorRef = useRef(onError);
  onMapLoadedRef.current = onMapLoaded;
  onMapClickRef.current = onMapClick;
  onMapLongClickRef.current = onMapLongClick;
  onCameraMoveStartRef.current = onCameraMoveStart;
  onCameraMoveRef.current = onCameraMove;
  onCameraMoveEndRef.current = onCameraMoveEnd;
  onErrorRef.current = onError;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      typedControllerRef.current?.getMap().invalidateSize({ pan: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [experimentalTilt, visualBearing]);

  // Swap between native DOM markers (untilted) and upright canvas billboards
  // (tilted). New markers added while tilted inherit the hidden state in the
  // renderer's onAdd, so this only re-applies the toggle on tilt/controller change.
  useEffect(() => {
    controller?.setNativeMarkersVisible(!isTilted);
  }, [controller, isTilted]);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    setIsReady(false);

    const config: LeafletConfig = {
      container: containerRef.current,
      initCameraPosition: state.cameraPosition,
      mapDesignType: state.mapDesignType,
      maxZoom,
      minZoom,
      restrictBounds,
      markerTilingOptions,
      options,
    };

    provider.initialize(config).then(rawController => {
      if (cancelled) return;
      const ctrl = rawController as LeafletMapViewController;
      typedControllerRef.current = ctrl;
      // Keep the standard zoom control outside the transformed Leaflet map.
      // Moving the DOM node does not remove Leaflet's registered handlers.
      const zoomControl = containerRef.current?.querySelector<HTMLElement>('.leaflet-top.leaflet-left');
      if (zoomControl && outerContainerRef.current) outerContainerRef.current.appendChild(zoomControl);
      state.setController(ctrl);
      state.setCameraPositionChangeListener(camera => {
        setVisualTilt(camera.tilt);
        setVisualBearing(camera.bearing);
        setCameraTick(tick => tick + 1);
      });
      setController(ctrl);

      ctrl.setCameraMoveStartListener((camera: MapCameraPosition) => {
        setVisualTilt(camera.tilt);
        setVisualBearing(camera.bearing);
        state.updateCameraPosition(camera);
        onCameraMoveStartRef.current?.(camera);
      });
      ctrl.setCameraMoveListener((camera: MapCameraPosition) => {
        setVisualTilt(camera.tilt);
        setVisualBearing(camera.bearing);
        state.updateCameraPosition(camera);
        onCameraMoveRef.current?.(camera);
        setCameraTick(tick => tick + 1);
      });
      ctrl.setCameraMoveEndListener((camera: MapCameraPosition) => {
        setVisualTilt(camera.tilt);
        setVisualBearing(camera.bearing);
        state.updateCameraPosition(camera);
        onCameraMoveEndRef.current?.(camera);
        setCameraTick(tick => tick + 1);
      });
      ctrl.setMapClickListener((point: GeoPoint) => onMapClickRef.current?.(point));
      ctrl.setMapLongClickListener((point: GeoPoint) => onMapLongClickRef.current?.(point));
      ctrl.setMapInitializedListener(() => onMapLoadedRef.current?.(state));

      const registry = scope.buildRegistry();
      for (const overlay of registry.getAll()) {
        bridgeUnsubs.current.push(overlay.subscribe(data => {
          overlay.render(data, ctrl).catch(console.error);
        }));
      }

      bridgeUnsubs.current.push(scope.bubbleCollector.subscribe(entries => {
        setBubbleEntries(Array.from(entries.values()));
      }));

      ctrl.setMarkerAnimationOverlayHost(scope.markerAnimationStore.start);
      bridgeUnsubs.current.push(() => ctrl.setMarkerAnimationOverlayHost(null));
      bridgeUnsubs.current.push(scope.markerAnimationStore.subscribe(setAnimationEntries));

      const capable = ctrl as unknown as Record<string, (state: never) => unknown>;
      const setupUpdateHandler = <S extends { id: string }>(
        collector: OverlayCollector<S>,
        hasMethod: string,
        updateMethod: string,
        onUpdated?: () => void,
      ) => {
        collector.setUpdateHandler(nextState => {
          if ((capable[hasMethod] as (value: S) => boolean)?.(nextState)) {
            void (capable[updateMethod] as (value: S) => Promise<void>)?.(nextState);
            onUpdated?.();
          }
        });
        bridgeUnsubs.current.push(() => collector.setUpdateHandler(null));
      };

      setupUpdateHandler(scope.markerCollector, 'hasMarker', 'updateMarker', () => {
        setCameraTick(tick => tick + 1);
      });
      setupUpdateHandler(scope.circleCollector, 'hasCircle', 'updateCircle');
      setupUpdateHandler(scope.polylineCollector, 'hasPolyline', 'updatePolyline');
      setupUpdateHandler(scope.polygonCollector, 'hasPolygon', 'updatePolygon');
      setupUpdateHandler(scope.groundImageCollector, 'hasGroundImage', 'updateGroundImage');
      setupUpdateHandler(scope.rasterLayerCollector, 'hasRasterLayer', 'updateRasterLayer');
      setIsReady(true);
    }).catch((reason: unknown) => {
      if (cancelled) return;
      const error = reason instanceof Error ? reason : new Error(String(reason));
      console.error('Failed to initialize Leaflet:', error);
      onErrorRef.current?.(error);
    });

    return () => {
      cancelled = true;
      const zoomControl = outerContainerRef.current?.querySelector<HTMLElement>('.leaflet-control-zoom');
      zoomControl?.remove();
      state.setCameraPositionChangeListener(null);
      state.setController(null);
      typedControllerRef.current = null;
      bridgeUnsubs.current.forEach(unsubscribe => unsubscribe());
      bridgeUnsubs.current = [];
      provider.destroy();
    };
  }, [
    markerTilingOptions,
    maxZoom,
    minZoom,
    options,
    provider,
    scope,
    state,
    state.mapDesignType.id,
  ]);

  useMapUISettings(state, controller);

  return (
    <MapContext.Provider value={{ controller, isReady }}>
      <div ref={outerContainerRef} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', ...containerStyle }}>
        <div ref={containerRef} className={className} style={mapPlaneStyle} />
        {controller && <LeafletTiltMarkerCanvas controller={controller} active={isTilted} />}
        <MapAttributionOverlay
          scope={scope}
          camera={typedControllerRef.current?.getCameraPosition() ?? state.cameraPosition}
          designAttributionRules={state.mapDesignType.attributionRules}
        />
        {animationEntries.length > 0 && typedControllerRef.current && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 650, pointerEvents: 'none' }}>
            <MarkerAnimationLayer
              entries={animationEntries}
              resolveScreenOffset={entry => typedControllerRef.current!.holder.toOuterScreenOffset(entry.state.position)}
            />
          </div>
        )}
        {bubbleEntries.length > 0 && typedControllerRef.current && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 750, pointerEvents: 'none', overflow: 'hidden' }}>
            {bubbleEntries.map(entry => {
              const positionOffset = typedControllerRef.current!.holder.toOuterScreenOffset(entry.positionProvider());
              const icon = entry.icon;
              const iconPixelSize = icon ? icon.iconSize * icon.scale : 0;
              return (
                <InfoBubbleOverlay
                  key={entry.id}
                  positionOffset={positionOffset}
                  iconSize={{ width: iconPixelSize, height: iconPixelSize }}
                  iconOffset={icon ? icon.anchor : { x: 0.5, y: 0.5 }}
                  infoAnchorOffset={icon ? icon.infoAnchor : { x: 0.5, y: 0.5 }}
                  tailOffset={entry.tailOffset}
                  style={{ pointerEvents: 'auto' }}
                >
                  {entry.content as ReactNode}
                </InfoBubbleOverlay>
              );
            })}
          </div>
        )}
      </div>
      <MapViewScopeProvider scope={scope}>{children}</MapViewScopeProvider>
    </MapContext.Provider>
  );
}
