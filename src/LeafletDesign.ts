import type {
  AttributionRule,
  MapDesignTypeInterface,
} from '@mapconductor/js-sdk-core';
import type { TileLayerOptions } from 'leaflet';

export interface LeafletMapDesignType extends MapDesignTypeInterface<string> {
  readonly tileUrl: string | null;
  readonly tileOptions: TileLayerOptions;
}

export interface LeafletDesignParams {
  id: string;
  tileUrl: string | null;
  tileOptions?: TileLayerOptions;
  attributionRules?: readonly AttributionRule[];
}

export class LeafletDesign implements LeafletMapDesignType {
  readonly id: string;
  readonly tileUrl: string | null;
  readonly tileOptions: TileLayerOptions;
  readonly attributionRules: readonly AttributionRule[];

  constructor({
    id,
    tileUrl,
    tileOptions = {},
    attributionRules = [],
  }: LeafletDesignParams) {
    this.id = id;
    this.tileUrl = tileUrl;
    this.tileOptions = tileOptions;
    this.attributionRules = attributionRules;
  }

  getValue(): string {
    return this.tileUrl ?? '';
  }

  static readonly OpenStreetMap = new LeafletDesign({
    id: 'openstreetmap',
    tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    tileOptions: {
      maxZoom: 19,
    },
    attributionRules: [{
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }],
  });

  static readonly None = new LeafletDesign({ id: 'none', tileUrl: null });
}
