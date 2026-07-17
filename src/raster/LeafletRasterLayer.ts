import {
  LocalTileServer,
  RasterLayerController,
  RasterLayerManager,
  TileScheme,
  type MapCameraPosition,
  type RasterLayerAddParams,
  type RasterLayerChangeParams,
  type RasterLayerEntity,
  type RasterLayerState,
} from '@mapconductor/js-sdk-core';
import {
  GridLayer,
  tileLayer,
  type Coords,
  type DoneCallback,
  type GridLayerOptions,
} from 'leaflet';
import { LeafletMapViewHolder } from '../LeafletMapViewHolder';
import { ensurePane } from '../helpers';

const EMPTY_TILE = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

interface LocalTileTemplate {
  routeId: string;
  tileSize: number;
}

function tileZoomForTileSize(zoom: number, tileSize: number): number {
  const offset = Math.log2(tileSize / 256);
  if (!Number.isFinite(offset) || !Number.isInteger(offset)) return zoom;
  return Math.max(0, zoom - offset);
}

function parseLocalTileTemplate(template: string): LocalTileTemplate | null {
  if (template.startsWith('mc-local-tile://')) {
    const url = new URL(template);
    const tileSize = Number(url.pathname.split('/').filter(Boolean)[0]);
    return Number.isFinite(tileSize) ? { routeId: url.hostname, tileSize } : null;
  }
  const match = template.match(/^\/?__tiles\/([^/]+)\/(\d+)\//);
  return match ? { routeId: match[1], tileSize: Number(match[2]) } : null;
}

class LocalTileLayer extends GridLayer {
  constructor(
    private readonly local: LocalTileTemplate,
    options: GridLayerOptions,
  ) {
    super(options);
  }

  override createTile(coords: Coords, done: DoneCallback): HTMLElement {
    const image = document.createElement('img');
    image.alt = '';
    // Leaflet derives tile coordinates from tileSize, but coords.z remains the
    // display zoom. A 512px grid at display zoom 10 therefore uses the x/y
    // range of zoom 9. Pass that canonical tile zoom to MapConductor renderers.
    const tileZoom = tileZoomForTileSize(coords.z, this.local.tileSize);
    const scale = 2 ** tileZoom;
    const x = ((coords.x % scale) + scale) % scale;
    if (coords.y < 0 || coords.y >= scale) {
      image.src = EMPTY_TILE;
      queueMicrotask(() => done(undefined, image));
      return image;
    }

    const server = LocalTileServer.startServer();
    const request = { x, y: coords.y, z: tileZoom };
    const dataUrl = server.handleFetchDataUrl(this.local.routeId, request);
    if (dataUrl) {
      image.onload = () => done(undefined, image);
      image.onerror = () => done(new Error('Failed to load local tile'), image);
      image.src = dataUrl;
      return image;
    }

    void server.handleFetch(this.local.routeId, request).then(bytes => {
      if (!bytes) {
        image.src = EMPTY_TILE;
        done(undefined, image);
        return;
      }
      const blobUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      image.onload = () => {
        URL.revokeObjectURL(blobUrl);
        done(undefined, image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        done(new Error('Failed to load local tile'), image);
      };
      image.src = blobUrl;
    });
    return image;
  }
}

interface TileJsonDocument {
  tiles?: string[];
  minzoom?: number;
  maxzoom?: number;
  attribution?: string;
}

export class LeafletRasterLayerRenderer {
  constructor(readonly holder: LeafletMapViewHolder) {}

  async onAdd(data: RasterLayerAddParams[]): Promise<(GridLayer | null)[]> {
    return Promise.all(data.map(({ state }) => state.visible ? this.create(state) : null));
  }

  async onChange(data: RasterLayerChangeParams<GridLayer>[]): Promise<(GridLayer | null)[]> {
    return Promise.all(data.map(async ({ current, prev }) => {
      prev.layer.remove();
      return current.state.visible ? this.create(current.state) : null;
    }));
  }

  async onRemove(data: RasterLayerEntity<GridLayer>[]): Promise<void> {
    for (const entity of data) entity.layer.remove();
  }

  async onCameraChanged(_mapCameraPosition: MapCameraPosition): Promise<void> {}
  async onPostProcess(): Promise<void> {}

  private async create(state: RasterLayerState): Promise<GridLayer | null> {
    const pane = ensurePane(
      this.holder.map,
      `mc-raster-${state.id}`,
      250 + Math.max(-100, Math.min(100, state.zIndex)),
      'none',
    );
    const baseOptions = { pane, opacity: state.opacity };
    const { source } = state;
    let layer: GridLayer;

    switch (source.type) {
      case 'UrlTemplate': {
        const local = parseLocalTileTemplate(source.template);
        if (local) {
          layer = new LocalTileLayer(local, {
            ...baseOptions,
            tileSize: source.tileSize ?? local.tileSize,
            minZoom: source.minZoom ?? undefined,
            maxZoom: source.maxZoom ?? undefined,
          });
        } else {
          layer = tileLayer(source.template, {
            ...baseOptions,
            tileSize: source.tileSize ?? 256,
            minZoom: source.minZoom ?? undefined,
            maxZoom: source.maxZoom ?? undefined,
            tms: source.scheme === TileScheme.TMS,
          });
        }
        break;
      }
      case 'ArcGisService':
        layer = tileLayer(`${source.serviceUrl.replace(/\/+$/, '')}/tile/{z}/{y}/{x}`, baseOptions);
        break;
      case 'TileJson': {
        const response = await fetch(source.url);
        if (!response.ok) throw new Error(`Failed to load TileJSON: ${response.status}`);
        const json = await response.json() as TileJsonDocument;
        if (!json.tiles?.[0]) throw new Error('TileJSON does not contain a tile template');
        layer = tileLayer(json.tiles[0], {
          ...baseOptions,
          minZoom: json.minzoom,
          maxZoom: json.maxzoom,
          attribution: json.attribution,
        });
        break;
      }
    }

    layer.addTo(this.holder.map);
    return layer;
  }
}

export class LeafletRasterLayerController extends RasterLayerController<GridLayer> {
  constructor(renderer: LeafletRasterLayerRenderer) {
    super({ rasterLayerManager: new RasterLayerManager(), renderer });
  }

  async composition(data: RasterLayerState[]): Promise<void> {
    await this.add(data);
    for (const state of data) {
      if (!state.visible) this.rasterLayerManager.removeEntity(state.id);
    }
  }

  override async update(state: RasterLayerState): Promise<void> {
    await super.update(state);
    if (!state.visible) this.rasterLayerManager.removeEntity(state.id);
  }

  has(state: RasterLayerState): boolean { return this.rasterLayerManager.hasEntity(state.id); }
  async updateInternal(state: RasterLayerState): Promise<void> { await this.upsert(state); }
  async removeInternal(id: string): Promise<void> { await this.removeById(id); }
}
