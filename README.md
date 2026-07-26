English | [日本語](https://github.com/MapConductor/react-for-leaflet/blob/main/README.ja.md) | [Español (Latinoamérica)](https://github.com/MapConductor/react-for-leaflet/blob/main/README.es-419.md)

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

`leaflet` is bundled as a dependency; the default OpenStreetMap tiles require no API key.

![](https://raw.githubusercontent.com/mapconductor/react-for-leaflet/docs/images/hello-map.jpg)

## Hello Map tutorial

The simplest possible map app, built with MapConductor + Leaflet: click the
marker and a "Hello, MapConductor" bubble pops up. You can build it in the 5
steps below. It uses Leaflet with OpenStreetMap tiles, which needs no API key,
so you can copy-paste and it just works.

### Step 1: Create a React project

Create a React + TypeScript project with Vite.

```shell
npm create vite@latest hello-map -- --template react-ts
cd hello-map
npm install
npm run dev
```

### Step 2: Install MapConductor (Leaflet)

Install the package needed to show a map. We use Leaflet here, but you can use
other map modules too.

```shell
npm install @mapconductor/react-for-leaflet
```

- `@mapconductor/react-for-leaflet` — components / hooks for Leaflet
- `@mapconductor/js-sdk-react` / `@mapconductor/js-sdk-core` are installed
  automatically as dependencies.

### Step 3: Show the map

Create the map state with `useLeafletMapViewState` and render it with
`<LeafletMapView>`. Don't forget the style CSS import. Give the outer element a
height to make it full-screen.

```tsx
import {
  LeafletDesign,
  LeafletMapView,
  useLeafletMapViewState,
} from '@mapconductor/react-for-leaflet';
import '@mapconductor/react-for-leaflet/style.css';
import { createGeoPoint, createMapCameraPosition } from '@mapconductor/js-sdk-core';

const TOKYO = createGeoPoint({ latitude: 35.6812, longitude: 139.7671 });
const INITIAL_CAMERA = createMapCameraPosition({ position: TOKYO, zoom: 14 });

export default function App() {
  const mapViewState = useLeafletMapViewState({
    mapDesignType: LeafletDesign.OpenStreetMap,
    cameraPosition: INITIAL_CAMERA,
  });

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <LeafletMapView state={mapViewState} />
    </div>
  );
}
```

### Step 4: Place a marker

Create the marker state with `createMarkerState` and register it with
`<Marker>`. Write overlays as **child elements** of the map component.

```tsx
import { useMemo } from 'react';
import { createMarkerState } from '@mapconductor/js-sdk-core';
import { Marker } from '@mapconductor/js-sdk-react';

// ...inside App...
const marker = useMemo(
  () => createMarkerState({ id: 'hello', position: TOKYO }),
  [],
);

// ...inside return...
<LeafletMapView state={mapViewState}>
  <Marker state={marker} />
</LeafletMapView>
```

### Step 5: Show an InfoBubble on click

Track the selected state with `useState`, set it to true in the marker's
`onClick`, and render `<InfoBubble>` only while selected. This is the finished
app.

```tsx
import { useMemo, useState } from 'react';
import {
  LeafletDesign,
  LeafletMapView,
  useLeafletMapViewState,
} from '@mapconductor/react-for-leaflet';
import '@mapconductor/react-for-leaflet/style.css';
import {
  createGeoPoint,
  createMapCameraPosition,
  createMarkerState,
} from '@mapconductor/js-sdk-core';
import { InfoBubble, Marker } from '@mapconductor/js-sdk-react';

const TOKYO = createGeoPoint({ latitude: 35.6812, longitude: 139.7671 });
const INITIAL_CAMERA = createMapCameraPosition({ position: TOKYO, zoom: 14 });

export default function App() {
  const mapViewState = useLeafletMapViewState({
    mapDesignType: LeafletDesign.OpenStreetMap,
    cameraPosition: INITIAL_CAMERA,
  });

  const [selected, setSelected] = useState(false);

  const marker = useMemo(
    () => createMarkerState({
      id: 'hello',
      position: TOKYO,
      onClick: () => setSelected(true),
    }),
    [],
  );

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <LeafletMapView state={mapViewState} onMapClick={() => setSelected(false)}>
        <Marker state={marker} />
        {selected && (
          <InfoBubble marker={marker}>
            <div style={{ padding: '8px 12px', fontWeight: 600 }}>
              Hello, MapConductor
            </div>
          </InfoBubble>
        )}
      </LeafletMapView>
    </div>
  );
}
```

### Key points

- Coordinates, cameras and markers are created with `js-sdk-core` functions
  (**provider-independent**).
- The map component and hooks come from `react-for-leaflet`
  (**provider-specific**).
- Write overlays as **child elements** of the map component.
- Control show / hide with React `useState`.

## Related packages

- [`@mapconductor/js-sdk-core`](https://github.com/mapconductor/js-sdk-core) — geometry, camera, and state primitives
- [`@mapconductor/js-sdk-react`](https://github.com/mapconductor/js-sdk-react) — shared `Marker`, `Markers`, shapes, and info bubbles
