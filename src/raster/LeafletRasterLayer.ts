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
  type RasterHeaderSupport,
} from '@mapconductor/js-sdk-core';
import {
  GridLayer,
  TileLayer,
  tileLayer,
  type Coords,
  type DoneCallback,
  type GridLayerOptions,
  type TileLayerOptions,
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

/**
 * `extraHeaders` を載せてタイルを取りに行く TileLayer。
 *
 * Leaflet の既定は `<img src>` で、img にはヘッダを付けられない。ヘッダ指定があるときだけ
 * fetch で取って blob URL に差し替える。**指定が無いときは既定の img 経路のまま**にしてある:
 * fetch + blob はタイル 1 枚ごとに ObjectURL を作って捨てるぶん素の img より重く、
 * 何も要求していない利用者にその負担をかける理由が無い。
 */
class HeaderTileLayer extends TileLayer {
  constructor(
    urlTemplate: string,
    options: TileLayerOptions,
    private readonly headers: Record<string, string>,
  ) {
    super(urlTemplate, options);
  }

  override createTile(coords: Coords, done: DoneCallback): HTMLImageElement {
    const image = document.createElement('img');
    image.alt = '';
    void fetch(this.getTileUrl(coords), { headers: this.headers })
      .then(async response => {
        if (!response.ok) throw new Error(`Tile request failed: ${response.status}`);
        const blobUrl = URL.createObjectURL(await response.blob());
        image.addEventListener('load', () => URL.revokeObjectURL(blobUrl), { once: true });
        image.addEventListener('error', () => URL.revokeObjectURL(blobUrl), { once: true });
        image.src = blobUrl;
        done(undefined, image);
      })
      .catch((error: unknown) => {
        done(error instanceof Error ? error : new Error(String(error)), image);
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
          const options: TileLayerOptions = {
            ...baseOptions,
            tileSize: source.tileSize ?? 256,
            minZoom: source.minZoom ?? undefined,
            maxZoom: source.maxZoom ?? undefined,
            tms: source.scheme === TileScheme.TMS,
          };
          const headers = state.extraHeaders;
          layer = headers && Object.keys(headers).length > 0
            ? new HeaderTileLayer(source.template, options, headers)
            : tileLayer(source.template, options);
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
  /**
   * ヘッダ指定があるときだけ fetch でタイルを取る HeaderTileLayer に切り替える。
   *
   * userAgent はブラウザが上書きを許さないので、どのプロバイダでも web では効かない。
   */
  protected override get headerSupport(): RasterHeaderSupport {
    return { provider: 'Leaflet', extraHeaders: true };
  }

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

  async updateInternal(state: RasterLayerState): Promise<void> { await this.upsert(state); }
  async removeInternal(id: string): Promise<void> { await this.removeById(id); }
}
