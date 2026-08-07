import {
  AbstractMarkerOverlayRenderer,
  type AddParams,
  type ChangeParams,
  type GeoPoint,
  type MarkerEntity,
} from '@mapconductor/js-sdk-core';
import { icon, marker, type Marker as LeafletMarker } from 'leaflet';
import { LeafletMapViewHolder } from '../LeafletMapViewHolder';

export class LeafletMarkerOverlayRenderer extends AbstractMarkerOverlayRenderer<
  LeafletMapViewHolder,
  LeafletMarker
> {
  /**
   * Whether the native Leaflet DOM markers should be visible. The 2D view fakes
   * camera tilt with a CSS `rotateX` on the map plane, which lays the DOM marker
   * icons flat against the ground. While tilted the view hides these native
   * markers (via `setNativeVisible(false)`) and draws upright, billboarded icons
   * on a canvas instead. Markers created while hidden must inherit this state,
   * so onAdd applies it too.
   */
  private nativeVisible = true;

  // Leaflet places a DOM marker at a single absolute longitude and does NOT
  // replicate it across world copies (unlike the symbol layers other providers
  // use). So a marker whose position is normalized to [-180,180] renders ~360°
  // off-screen once the map is panned across the antimeridian (e.g. dropping a
  // marker on the polyline near the US west coast). We therefore render each
  // marker at the world copy nearest the current map center, tracking every
  // marker's logical position here and re-projecting them all whenever the map
  // moves so they stay visible across copies.
  private readonly logicalPositions = new Map<LeafletMarker, GeoPoint>();
  private readonly reprojectMarkers = () => {
    for (const [actual, position] of this.logicalPositions) {
      actual.setLatLng(this.nearestCopyLatLng(position));
    }
  };

  constructor(holder: LeafletMapViewHolder) {
    super({ holder });
    this.supportsAnimationOverlay = true;
    this.holder.map.on('moveend', this.reprojectMarkers);
  }

  /**
   * The marker's lat/lng shifted so its longitude lands in the same world copy
   * as the current map center (see `logicalPositions`).
   */
  private nearestCopyLatLng(position: GeoPoint): [number, number] {
    const centerLng = this.holder.map.getCenter().lng;
    const longitude = position.longitude + 360 * Math.round((centerLng - position.longitude) / 360);
    return [position.latitude, longitude];
  }

  /** Whether native markers should currently be visible (see `nativeVisible`). */
  get isNativeVisible(): boolean {
    return this.nativeVisible;
  }

  /**
   * Remembers whether native markers should be visible so markers added
   * afterwards (see onAdd) inherit the state. The live entities are owned by the
   * controller's MarkerManager, so toggling existing markers is done there
   * (LeafletMarkerController.setNativeMarkersVisible), not here.
   */
  setNativeVisible(visible: boolean): void {
    this.nativeVisible = visible;
  }

  async onAdd(data: AddParams[]): Promise<(LeafletMarker | null)[]> {
    return data.map(({ state, bitmapIcon }) => {
      const actual = marker(this.nearestCopyLatLng(state.position), {
        icon: this.toLeafletIcon(bitmapIcon),
        draggable: state.draggable,
        // Leaflet の zIndexOffset は数値必須。未指定(null)は 0（既定の重なり順）。
        zIndexOffset: state.zIndex ?? 0,
        keyboard: false,
        bubblingMouseEvents: false,
        opacity: this.nativeVisible ? 1 : 0,
      });
      this.logicalPositions.set(actual, state.position);
      actual.addTo(this.holder.map);
      // Markers created while tilted inherit the hidden, non-interactive state
      // (see LeafletMarkerController.setNativeMarkersVisible).
      if (!this.nativeVisible) {
        const element = actual.getElement();
        if (element) element.style.pointerEvents = 'none';
      }
      return actual;
    });
  }

  async onChange(data: ChangeParams<LeafletMarker>[]): Promise<(LeafletMarker | null)[]> {
    return data.map(({ current, prev, bitmapIcon }) => {
      const actual = prev.marker;
      if (!actual) return null;
      this.logicalPositions.set(actual, current.state.position);
      actual.setLatLng(this.nearestCopyLatLng(current.state.position));
      actual.setIcon(this.toLeafletIcon(bitmapIcon));
      actual.setZIndexOffset(current.state.zIndex ?? 0);
      if (current.state.draggable) actual.dragging?.enable();
      else actual.dragging?.disable();
      return actual;
    });
  }

  async onRemove(data: MarkerEntity<LeafletMarker>[]): Promise<void> {
    for (const entity of data) {
      if (entity.marker) this.logicalPositions.delete(entity.marker);
      entity.marker?.remove();
    }
  }

  async onPostProcess(): Promise<void> {}

  setMarkerPosition(entity: MarkerEntity<LeafletMarker>, position: GeoPoint): void {
    if (entity.marker) this.logicalPositions.set(entity.marker, position);
    entity.marker?.setLatLng(this.nearestCopyLatLng(position));
  }

  override setMarkerVisible(entity: MarkerEntity<LeafletMarker>, visible: boolean): void {
    // The marker-animation overlay hides the native marker during a Drop/Bounce
    // and restores it afterwards. While the CSS tilt hack is active, native
    // markers must stay hidden (canvas billboards are drawn instead), so never
    // let the restore re-show a native marker while `nativeVisible` is false.
    entity.marker?.setOpacity(visible && this.nativeVisible ? 1 : 0);
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
