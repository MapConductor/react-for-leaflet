import {
  MapProvider,
  MarkerTilingOptions,
  type GeoRectBounds,
  type MapConfig,
  type MapViewControllerInterface,
} from '@mapconductor/js-sdk-core';
import { map as createMap, tileLayer, type LatLngBoundsExpression, type MapOptions } from 'leaflet';
import type { LeafletMapDesignType } from './LeafletDesign';
import { LeafletMapViewController } from './LeafletMapViewController';
import { LeafletMapViewHolder } from './LeafletMapViewHolder';
import { LeafletMarkerController } from './marker/LeafletMarkerController';
import { LeafletMarkerOverlayRenderer } from './marker/LeafletMarkerOverlayRenderer';
import {
  LeafletCircleController,
  LeafletCircleRenderer,
  LeafletGroundImageController,
  LeafletGroundImageRenderer,
  LeafletPolygonController,
  LeafletPolygonRenderer,
  LeafletPolylineController,
  LeafletPolylineRenderer,
} from './vector/LeafletVectorControllers';
import {
  LeafletRasterLayerController,
  LeafletRasterLayerRenderer,
} from './raster/LeafletRasterLayer';

export interface LeafletConfig extends MapConfig {
  mapDesignType: LeafletMapDesignType;
  maxZoom?: number;
  minZoom?: number;
  /** Restricts panning/zooming so the viewport cannot leave this rectangle. */
  restrictBounds?: GeoRectBounds;
  markerTilingOptions?: MarkerTilingOptions;
  options?: MapOptions;
}

function toLatLngBounds(bounds: GeoRectBounds | undefined): LatLngBoundsExpression | undefined {
  if (!bounds?.southWest || !bounds.northEast) return undefined;
  return [
    [bounds.southWest.latitude, bounds.southWest.longitude],
    [bounds.northEast.latitude, bounds.northEast.longitude],
  ];
}

export class LeafletProvider extends MapProvider {
  async initialize(config: LeafletConfig): Promise<MapViewControllerInterface> {
    if (this.controller) return this.controller;
    const container = typeof config.container === 'string'
      ? document.getElementById(config.container)
      : config.container;
    if (!container) throw new Error('Container element not found');

    const initial = config.initCameraPosition;
    const restrictBounds = toLatLngBounds(config.restrictBounds);
    const leafletMap = createMap(container, {
      minZoom: config.minZoom,
      maxZoom: config.maxZoom,
      maxBounds: restrictBounds,
      // Unlike the other providers' bounds restriction, Leaflet's maxBounds
      // by itself only clamps the pan CENTER — it does not stop the user
      // from zooming out far enough to see well beyond the box (confirmed
      // empirically: without this, zooming out fully still showed half the
      // globe). maxBoundsViscosity makes the pan clamp immediate instead of
      // elastic; the minZoom below (see after container sizing) is what
      // actually stops zooming out past the box.
      ...(restrictBounds ? { maxBoundsViscosity: 1.0 } : {}),
      ...config.options,
    }).setView([
      initial?.position.latitude ?? 0,
      initial?.position.longitude ?? 0,
    ], initial?.zoom ?? 0);

    if (restrictBounds && config.minZoom === undefined) {
      // getBoundsZoom needs the container's rendered size, which is only
      // available once the map has been attached above — this is the
      // smallest zoom at which the box still fills the viewport, matching
      // Google Maps' strictBounds / ArcGIS's geometry constraint behaviour.
      leafletMap.setMinZoom(leafletMap.getBoundsZoom(restrictBounds, false));
    }

    const design = config.mapDesignType;
    if (design.tileUrl) tileLayer(design.tileUrl, design.tileOptions).addTo(leafletMap);

    const holder = new LeafletMapViewHolder(container, leafletMap);
    const markerRenderer = new LeafletMarkerOverlayRenderer(holder);
    const markerController = new LeafletMarkerController(markerRenderer, config.markerTilingOptions);
    const circleController = new LeafletCircleController(new LeafletCircleRenderer(holder));
    const polylineController = new LeafletPolylineController(new LeafletPolylineRenderer(holder));
    const polygonController = new LeafletPolygonController(new LeafletPolygonRenderer(holder));
    const groundImageController = new LeafletGroundImageController(new LeafletGroundImageRenderer(holder));
    const rasterLayerController = new LeafletRasterLayerController(new LeafletRasterLayerRenderer(holder));

    this.controller = new LeafletMapViewController(
      holder,
      markerController,
      circleController,
      polylineController,
      polygonController,
      groundImageController,
      rasterLayerController,
      initial?.tilt ?? 0,
      initial?.bearing ?? 0,
    );
    return this.controller;
  }

  destroy(): void {
    this.controller?.destroy();
    this.controller = null;
  }
}
