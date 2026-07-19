import {
  MapProvider,
  MarkerTilingOptions,
  type MapConfig,
  type MapViewControllerInterface,
} from '@mapconductor/js-sdk-core';
import { map as createMap, tileLayer, type MapOptions } from 'leaflet';
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
  markerTilingOptions?: MarkerTilingOptions;
  options?: MapOptions;
}

export class LeafletProvider extends MapProvider {
  async initialize(config: LeafletConfig): Promise<MapViewControllerInterface> {
    if (this.controller) return this.controller;
    const container = typeof config.container === 'string'
      ? document.getElementById(config.container)
      : config.container;
    if (!container) throw new Error('Container element not found');

    const initial = config.initCameraPosition;
    const leafletMap = createMap(container, {
      minZoom: config.minZoom,
      maxZoom: config.maxZoom,
      ...config.options,
    }).setView([
      initial?.position.latitude ?? 0,
      initial?.position.longitude ?? 0,
    ], initial?.zoom ?? 0);

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
