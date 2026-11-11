import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import type { EventRow } from '../lib/eonet';
import { categoryLabel, colorFor } from '../lib/eonet';

type Props = {
  events: EventRow[];
  selected: EventRow | null;
  onSelect: (event: EventRow) => void;
  fitToken: number;
};

const WORLD_CENTER: L.LatLngExpression = [26, 7];
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const tileKey = ({ coords }: L.TileEvent) => `${coords.z}/${coords.x}/${coords.y}`;

function fitEvents(current: L.Map, markers: Map<string, L.CircleMarker>, animate: boolean) {
  current.stop();
  if (!markers.size) {
    current.setView(WORLD_CENTER, 2, { animate: false });
    return;
  }
  const bounds = L.featureGroup([...markers.values()]).getBounds();
  if (bounds.isValid()) {
    current.fitBounds(bounds, {
      maxZoom: 5,
      paddingTopLeft: [30, 68],
      paddingBottomRight: [48, 54],
      animate: animate && !reducedMotion(),
    });
  }
}

export default function EventsMap({ events, selected, onSelect, fitToken }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const tileLayer = useRef<L.TileLayer | null>(null);
  const markers = useRef(new Map<string, L.CircleMarker>());
  const failedTiles = useRef(new Set<string>());
  const onSelectRef = useRef(onSelect);
  const selectedRef = useRef(selected);
  const [tileProblem, setTileProblem] = useState(false);
  const [tilesRetrying, setTilesRetrying] = useState(false);
  onSelectRef.current = onSelect;
  selectedRef.current = selected;

  const pinEvents = useMemo(() => events.filter(event =>
    event.latitude !== null && event.longitude !== null &&
    Number.isFinite(event.latitude) && Number.isFinite(event.longitude)
  ), [events]);

  useEffect(() => {
    if (!host.current || map.current) return;
    const current = L.map(host.current, {
      zoomControl: false,
      worldCopyJump: true,
      preferCanvas: true,
      minZoom: 1,
    }).setView(WORLD_CENTER, 2);
    map.current = current;
    L.control.zoom({
      position: 'bottomright',
      zoomInTitle: '地図を拡大',
      zoomOutTitle: '地図を縮小',
    }).addTo(current);
    current.attributionControl.setPrefix(false);

    const tiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> © <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 18,
    });
    tiles.on('tileerror', (event: L.TileErrorEvent) => {
      failedTiles.current.add(tileKey(event));
      setTileProblem(true);
    });
    const clearTileFailure = (event: L.TileEvent) => {
      failedTiles.current.delete(tileKey(event));
      setTileProblem(failedTiles.current.size > 0);
    };
    tiles.on('tileload', clearTileFailure);
    tiles.on('tileunload', clearTileFailure);
    tiles.on('load', () => setTilesRetrying(false));
    tiles.addTo(current);
    tileLayer.current = tiles;
    layer.current = L.layerGroup().addTo(current);

    // The map also changes size when its sibling panels or the mobile layout change.
    let resizeFrame = 0;
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => current.invalidateSize({ animate: false, pan: false }));
    });
    resize.observe(host.current);

    return () => {
      resize.disconnect();
      cancelAnimationFrame(resizeFrame);
      tiles.off();
      current.remove();
      map.current = null;
      layer.current = null;
      tileLayer.current = null;
      markers.current.clear();
      failedTiles.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!layer.current || !map.current) return;
    const group = layer.current;
    group.clearLayers();
    markers.current.clear();
    for (const event of pinEvents) {
      const isSelected = event.id === selectedRef.current?.id;
      const point = L.circleMarker([event.latitude!, event.longitude!], {
        radius: isSelected ? 9 : 6,
        weight: isSelected ? 2.5 : 1.5,
        color: isSelected ? '#ffffff' : '#0c1521',
        fillColor: colorFor(event.category_id),
        fillOpacity: isSelected ? 1 : 0.88,
        bubblingMouseEvents: false,
      });
      // Remote event titles must remain text, never Leaflet's HTML tooltip input.
      const tooltip = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = event.title;
      const category = document.createElement('div');
      category.textContent = categoryLabel(event.category_id, event.category);
      tooltip.append(title, category);
      point.bindTooltip(tooltip, { direction: 'top', className: 'event-tooltip', offset: [0, -7] });
      point.on('click', () => onSelectRef.current(event));
      point.addTo(group);
      markers.current.set(event.id, point);
    }
    fitEvents(map.current, markers.current, false);
  }, [pinEvents]);

  useEffect(() => {
    for (const [id, point] of markers.current) {
      const isSelected = id === selected?.id;
      point.setRadius(isSelected ? 9 : 6);
      point.setStyle({
        weight: isSelected ? 2.5 : 1.5,
        color: isSelected ? '#ffffff' : '#0c1521',
        fillOpacity: isSelected ? 1 : 0.88,
      });
      if (isSelected) point.bringToFront();
    }
  }, [selected?.id, pinEvents]);

  useEffect(() => {
    const current = map.current;
    if (!current || !selected || !markers.current.has(selected.id) ||
      selected.latitude === null || selected.longitude === null) return;
    current.stop();
    const center: L.LatLngExpression = [selected.latitude, selected.longitude];
    const zoom = Math.max(5, current.getZoom());
    if (reducedMotion()) current.setView(center, zoom, { animate: false });
    else current.flyTo(center, zoom, { duration: 0.65 });
  }, [selected?.id, selected?.latitude, selected?.longitude]);

  useEffect(() => {
    if (!fitToken || !map.current) return;
    fitEvents(map.current, markers.current, true);
  }, [fitToken]);

  const retryMap = () => {
    if (!tileLayer.current) return;
    failedTiles.current.clear();
    setTileProblem(false);
    setTilesRetrying(true);
    tileLayer.current.redraw();
  };

  return <>
    <div id="map" ref={host} role="region" aria-label="自然現象の世界地図。各地点の詳細はイベント一覧からも確認できます。" />
    {(tileProblem || tilesRetrying) && <div className="map-tile-notice" role="status">
      <span>{tilesRetrying ? '地図を読み込み直しています…' : '背景地図を読み込めませんでした。イベント一覧は引き続き利用できます。'}</span>
      {!tilesRetrying && <button type="button" className="map-retry" onClick={retryMap}>再読み込み</button>}
    </div>}
  </>;
}
