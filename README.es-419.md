[English](./README.md) | [日本語](./README.ja.md) | Español (Latinoamérica)

# @mapconductor/react-for-leaflet

Proveedor de Leaflet para el SDK de React de MapConductor. Renderiza un mapa de Leaflet a través de la API de cámara, marcadores y superposiciones independiente del proveedor de MapConductor, de modo que el mismo código de aplicación también puede ejecutarse en Google Maps, MapLibre, Mapbox, OpenLayers, ArcGIS, Cesium o HERE.

## Instalación

```shell
npm install @mapconductor/react-for-leaflet
```

`@mapconductor/js-sdk-core` y `@mapconductor/js-sdk-react` (usados para marcadores y otros componentes compartidos) se instalan automáticamente como dependencias. Tu código importa directamente de ambos, así que con el `node_modules` estricto (aislado) de pnpm — o siempre que prefieras declarar todo lo que importas — instálalos explícitamente:

```shell
npm install @mapconductor/react-for-leaflet @mapconductor/js-sdk-core @mapconductor/js-sdk-react
```

`leaflet` viene incluido como dependencia; las teselas predeterminadas de OpenStreetMap no requieren clave de API.

## Inicio rápido

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

## Diseños de mapa

`LeafletDesign` incluye `OpenStreetMap` (teselas ráster OSM estándar) y `None` (sin capa base, p. ej. para tus propias capas de teselas). Cambia en tiempo de ejecución asignando `state.mapDesignType = ...`.

## Paquetes relacionados

- [`@mapconductor/js-sdk-core`](../js-sdk-core) — primitivas de geometría, cámara y estado
- [`@mapconductor/js-sdk-react`](../js-sdk-react) — `Marker`, `Markers`, formas y burbujas de información compartidos
