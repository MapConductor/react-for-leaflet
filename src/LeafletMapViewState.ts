import {
  useState } from 'react';
import {
  MapCameraPosition as MapCameraPositionNS,
  MapViewState,
  createRandomId,
  type MapCameraPosition,
  type MapViewControllerInterface,
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
  private _mapDesignType: LeafletMapDesignType;

  constructor({
    id = createRandomId(),
    mapDesignType = LeafletDesign.OpenStreetMap,
    cameraPosition = MapCameraPositionNS.Default,
  }: LeafletMapViewStateParams = {}) {
    super({ id, cameraPosition });
    this._mapDesignType = mapDesignType;
  }

  override get mapDesignType(): LeafletMapDesignType {
    return this._mapDesignType;
  }

  override set mapDesignType(value: LeafletMapDesignType) {
    this._mapDesignType = value;
  }

  /** このプロバイダは接続時にカメラを動かさない（ビュー側が別経路で初期位置を当てる）。 */
  override setController(controller: MapViewControllerInterface | null): void {
    this.attachController(controller, false);
  }
}

export function useLeafletMapViewState(
  params: LeafletMapViewStateParams = {},
): LeafletMapViewStateInterface {
  const [state] = useState(() => new LeafletMapViewState(params));
  return state;
}
