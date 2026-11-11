import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import type { EventRow } from '../lib/eonet';
import { colorFor } from '../lib/eonet';

type Props = { events: EventRow[]; selected: EventRow | null; onSelect: (event: EventRow) => void; fitToken: number };
export default function EventsMap({ events, selected, onSelect, fitToken }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const markers = useRef<Map<string,L.CircleMarker>>(new Map());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const pinEvents = useMemo(() => events.filter(e => e.latitude !== null && e.longitude !== null),[events]);
  useEffect(() => {
    if (!host.current || map.current) return;
    const current = L.map(host.current,{ zoomControl:false, worldCopyJump:true, preferCanvas:true }).setView([26,7],2);
    map.current = current;
    L.control.zoom({position:'bottomright'}).addTo(current);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap contributors © CARTO', subdomains:'abcd', maxZoom:18
    }).addTo(current);
    layer.current = L.layerGroup().addTo(current);
    return () => { current.remove(); map.current = null; layer.current = null; markers.current.clear(); };
  },[]);
  useEffect(() => {
    if (!layer.current || !map.current) return;
    const group = layer.current;
    group.clearLayers(); markers.current.clear();
    for (const item of pinEvents) {
      const point = L.circleMarker([item.latitude!,item.longitude!],{
        radius:6, weight:1.5, color:'#0c1521', fillColor:colorFor(item.category_id),fillOpacity:.9
      });
      point.on('click',()=>onSelectRef.current(item));point.addTo(group);markers.current.set(item.id,point);
    }
    if (pinEvents.length) {
      const bounds = L.featureGroup([...markers.current.values()]).getBounds();
      if (bounds.isValid()) map.current.fitBounds(bounds.pad(.14),{maxZoom:5,animate:false});
    }
  },[pinEvents]);
  useEffect(() => {
    if (selected?.latitude !== null && selected?.latitude !== undefined && selected.longitude !== null && map.current) {
      map.current.flyTo([selected.latitude,selected.longitude],Math.max(4,map.current.getZoom()),{duration:.8});
    }
  },[selected]);
  useEffect(() => {
    if (!fitToken || !map.current || !markers.current.size) return;
    const bounds = L.featureGroup([...markers.current.values()]).getBounds();
    if (bounds.isValid()) map.current.fitBounds(bounds.pad(.14),{maxZoom:5,animate:true});
  },[fitToken]);
  return <div id="map" ref={host} aria-label="NASA自然現象イベントの世界地図" />;
}
