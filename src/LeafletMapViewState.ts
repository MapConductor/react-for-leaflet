import { useState } from 'react';
import {
  MapCameraPosition as MapCameraPositionNS,
  MapViewState,
  createRandomId,
  type GeoPoint,
  type MapCameraPosition,
  type MapViewControllerInterface,
  type GeoRectBounds,
  type MapViewHolder,
  type MapViewStateInterface,
} from '@mapconductor/js-sdk-core';
import { LeafletDesign, type LeafletMapDesignType } from './LeafletDesign';

export interface LeafletMapViewStateInterface
  extends MapViewStateInterface<LeafletMapDesignType> {}

export interface LeafletMapViewStateParams {
  id?: string;
  mapDesignType?: LeafletMapDesignType;
  cameraPosition?: MapCameraPosition;
}

export class LeafletMapViewState
  extends MapViewState<LeafletMapDesignType>
  implements LeafletMapViewStateInterface {
  readonly id: string;
  private _cameraPosition: MapCameraPosition;
  private _mapDesignType: LeafletMapDesignType;
  private _controller: MapViewControllerInterface | null = null;
  private _cameraPositionChangeListener: ((camera: MapCameraPosition) => void) | null = null;

  constructor({
    id = createRandomId(),
    mapDesignType = LeafletDesign.OpenStreetMap,
    cameraPosition = MapCameraPositionNS.Default,
  }: LeafletMapViewStateParams = {}) {
    super();
    this.id = id;
    this._cameraPosition = cameraPosition;
    this._mapDesignType = mapDesignType;
  }

  override get cameraPosition(): MapCameraPosition {
    return this._cameraPosition;
  }

  override get mapDesignType(): LeafletMapDesignType {
    return this._mapDesignType;
  }

  override set mapDesignType(value: LeafletMapDesignType) {
    this._mapDesignType = value;
  }

  override moveCameraTo(position: GeoPoint, durationMillis?: number): void;
  override moveCameraTo(cameraPosition: MapCameraPosition, durationMillis?: number): void;
  override moveCameraTo(positionOrCamera: GeoPoint | MapCameraPosition, durationMillis?: number): void {
    const next = 'zoom' in positionOrCamera
      ? this.resolveCameraPosition(positionOrCamera as MapCameraPosition)
      : this._cameraPosition.copy({ position: positionOrCamera as GeoPoint });

    if (!this._controller) {
      this._cameraPosition = next;
      return;
    }

    if (!durationMillis) {
      void this._controller.moveCamera(next);
    } else {
      void this._controller.animateCamera(next, { duration: durationMillis });
    }
    this._cameraPosition = next;
    this._cameraPositionChangeListener?.(next);
  }

  override getMapViewHolder(): MapViewHolder<unknown, unknown> | null {
    return this._controller?.holder ?? null;
  }

  override fitBounds(bounds: GeoRectBounds, padding: number = 0): void {
    void this._controller?.fitBounds(bounds, { padding });
  }

  setController(controller: MapViewControllerInterface | null): void {
    this._controller = controller;
  }

  updateCameraPosition(camera: MapCameraPosition): void {
    this._cameraPosition = camera;
    this._cameraPositionChangeListener?.(camera);
  }

  setCameraPositionChangeListener(listener: ((camera: MapCameraPosition) => void) | null): void {
    this._cameraPositionChangeListener = listener;
  }

  private resolveCameraPosition(target: MapCameraPosition): MapCameraPosition {
    const isUnspecified = target.zoom === 0 && target.bearing === 0 && target.tilt === 0;
    return isUnspecified
      ? this._cameraPosition.copy({ position: target.position })
      : target;
  }
}

export function useLeafletMapViewState(
  params: LeafletMapViewStateParams = {},
): LeafletMapViewState {
  const [state] = useState(() => new LeafletMapViewState(params));
  return state;
}
