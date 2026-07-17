import {
  AbstractMarkerOverlayRenderer,
  type AddParams,
  type ChangeParams,
  type GeoPoint,
  type MarkerEntity,
} from '@mapconductor/js-sdk-core';
import { icon, marker, type Marker as LeafletMarker } from 'leaflet';
import { LeafletMapViewHolder } from '../LeafletMapViewHolder';
import { toLatLng } from '../helpers';

export class LeafletMarkerOverlayRenderer extends AbstractMarkerOverlayRenderer<
  LeafletMapViewHolder,
  LeafletMarker
> {
  constructor(holder: LeafletMapViewHolder) {
    super({ holder });
    this.supportsAnimationOverlay = true;
  }

  async onAdd(data: AddParams[]): Promise<(LeafletMarker | null)[]> {
    return data.map(({ state, bitmapIcon }) => {
      const actual = marker(toLatLng(state.position), {
        icon: this.toLeafletIcon(bitmapIcon),
        draggable: state.draggable,
        zIndexOffset: state.zIndex,
        keyboard: false,
        bubblingMouseEvents: false,
      });
      actual.addTo(this.holder.map);
      return actual;
    });
  }

  async onChange(data: ChangeParams<LeafletMarker>[]): Promise<(LeafletMarker | null)[]> {
    return data.map(({ current, prev, bitmapIcon }) => {
      const actual = prev.marker;
      if (!actual) return null;
      actual.setLatLng(toLatLng(current.state.position));
      actual.setIcon(this.toLeafletIcon(bitmapIcon));
      actual.setZIndexOffset(current.state.zIndex);
      if (current.state.draggable) actual.dragging?.enable();
      else actual.dragging?.disable();
      return actual;
    });
  }

  async onRemove(data: MarkerEntity<LeafletMarker>[]): Promise<void> {
    for (const entity of data) entity.marker?.remove();
  }

  async onPostProcess(): Promise<void> {}

  setMarkerPosition(entity: MarkerEntity<LeafletMarker>, position: GeoPoint): void {
    entity.marker?.setLatLng(toLatLng(position));
  }

  override setMarkerVisible(entity: MarkerEntity<LeafletMarker>, visible: boolean): void {
    entity.marker?.setOpacity(visible ? 1 : 0);
  }

  private toLeafletIcon(bitmapIcon: AddParams['bitmapIcon']) {
    return icon({
      iconUrl: bitmapIcon.url,
      iconSize: [bitmapIcon.size.width, bitmapIcon.size.height],
      iconAnchor: [
        bitmapIcon.size.width * bitmapIcon.anchor.x,
        bitmapIcon.size.height * bitmapIcon.anchor.y,
      ],
    });
  }
}
