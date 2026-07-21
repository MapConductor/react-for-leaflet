English | [日本語](./README.ja.md) | [Español (Latinoamérica)](./README.es-419.md)

# @mapconductor/react-for-leaflet

Leaflet provider for the MapConductor React SDK. Renders a Leaflet map through
MapConductor's provider-independent camera, marker, and overlay API, so the
same application code can also run on Google Maps, MapLibre, Mapbox,
OpenLayers, ArcGIS, Cesium, or HERE.

## Installation

```shell
npm install @mapconductor/react-for-leaflet
```

`@mapconductor/js-sdk-core` and `@mapconductor/js-sdk-react` (used for markers and
other shared components) are installed automatically as dependencies. Your
code imports from both directly, so with pnpm's strict (isolated)
`node_modules` — or whenever you prefer to declare everything you import —
install them explicitly instead:

```shell
npm install @mapconductor/react-for-leaflet @mapconductor/js-sdk-core @mapconductor/js-sdk-react
```

`leaflet` is bundled as a dependency; the default OpenStreetMap tiles require no
API key.

## Quick start

```tsx
import { createGeoPoint, createMapCameraPosition } from '@mapconductor/js-sdk-core';
import { Marker } from '@mapconductor/js-sdk-react';
import {
  LeafletDesign,
  LeafletMapView,
  useLeafletMapViewState,
} from '@mapconductor/react-for-leaflet';
import '@mapconductor/react-for-leaflet/style.css';

const TOKYO = createGeoPoint({ latitude: 35.6812, longitude: 139.7671 });

export function App() {
  const state = useLeafletMapViewState({
    mapDesignType: LeafletDesign.OpenStreetMap,
    cameraPosition: createMapCameraPosition({ position: TOKYO, zoom: 12 }),
  });

  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <LeafletMapView
        state={state}
        onMapClick={point => console.log('clicked', point.latitude, point.longitude)}
        onCameraMoveEnd={camera => console.log('zoom', camera.zoom)}
      >
        <Marker position={TOKYO} />
      </LeafletMapView>
    </div>
  );
}
```

## Map designs

`LeafletDesign` ships `OpenStreetMap` (standard OSM raster tiles) and `None`
(no base layer, e.g. for your own tile layers). Switch at runtime by assigning
`state.mapDesignType = ...`.

## Related packages

- [`@mapconductor/js-sdk-core`](../js-sdk-core) — geometry, camera, and state primitives
- [`@mapconductor/js-sdk-react`](../js-sdk-react) — shared `Marker`, `Markers`, shapes, and info bubbles
