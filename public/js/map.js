// ── MAP MODULE ────────────────────────────────────────────────────────────────
const CrisisMap = (() => {
  let map, markersLayer, routeLines = [];

  const COLORS = {
    CRITICAL: '#ef4444', HIGH: '#f97316', MEDIUM: '#eab308', LOW: '#22c55e', HUB: '#a855f7'
  };

  function init() {
    map = L.map('map', {
      center: [13.08, 80.27],
      zoom: 11,
      zoomControl: true,
      attributionControl: true
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
  }

  function makeIcon(color, size = 14) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size*2.5}" height="${size*2.5}" viewBox="0 0 36 36">
      <circle cx="18" cy="18" r="15" fill="${color}" opacity="0.18" stroke="${color}" stroke-width="1.5"/>
      <circle cx="18" cy="18" r="9" fill="${color}" opacity="0.55"/>
      <circle cx="18" cy="18" r="5" fill="${color}"/>
    </svg>`;
    return L.divIcon({
      html: svg, className: 'custom-marker',
      iconSize: [size*2.5, size*2.5], iconAnchor: [size*1.25, size*1.25]
    });
  }

  function makeHubIcon() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
      <circle cx="20" cy="20" r="18" fill="#7c3aed" opacity="0.13" stroke="#7c3aed" stroke-width="1.5"/>
      <polygon points="20,7 33,31 7,31" fill="#7c3aed" opacity="0.85"/>
      <circle cx="20" cy="21" r="4" fill="#fff"/>
    </svg>`;
    return L.divIcon({ html: svg, className: 'custom-marker', iconSize: [40,40], iconAnchor: [20,20] });
  }

  function priorityColor(p) {
    return COLORS[p] || COLORS.LOW;
  }

  function renderZones(zones, hub, onZoneClick) {
    markersLayer.clearLayers();
    clearRoutes();

    // Hub marker
    if (hub) {
      L.marker([hub.latitude, hub.longitude], { icon: makeHubIcon() })
        .addTo(markersLayer)
        .bindPopup(`<b style="color:#7c3aed">🏠 ${hub.name}</b><br><small style="color:#64748b">${hub.address}</small>`);
    }

    // Zone markers
    zones.forEach(zoneData => {
      const zone = zoneData.zone || zoneData;
      const priority = zoneData.priority || 'LOW';
      const color = priorityColor(priority);
      const score = zoneData.score ? (zoneData.score * 100).toFixed(1) : '—';

      const marker = L.marker([zone.latitude, zone.longitude], { icon: makeIcon(color) })
        .addTo(markersLayer)
        .bindPopup(`
          <div style="min-width:180px">
            <b style="color:${color};font-size:0.9rem">${zone.name}</b>
            <span style="background:${color}15;color:${color};border:1px solid ${color}40;padding:1px 6px;border-radius:10px;font-size:0.65rem;font-weight:700;margin-left:6px">${priority}</span>
            <br><small style="color:#64748b">${zone.district}</small>
            <hr style="border-color:#e0e4ea;margin:6px 0">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:0.72rem">
              <span style="color:#64748b">Population</span><span style="font-weight:600;color:#1e293b">${zone.population?.toLocaleString()}</span>
              <span style="color:#64748b">Severity</span><span style="font-weight:600;color:#1e293b">${zone.severity}/10</span>
              <span style="color:#64748b">Priority Score</span><span style="font-weight:600;color:${color}">${score}%</span>
              <span style="color:#64748b">Road Access</span><span style="font-weight:600;color:#1e293b">${zone.roadAccess}</span>
            </div>
            <div style="margin-top:6px;font-size:0.68rem;color:#64748b;font-style:italic">${zone.notes || ''}</div>
          </div>
        `);

      if (onZoneClick) marker.on('click', () => onZoneClick(zoneData));
    });
  }

  function drawRoutes(zones, hub) {
    clearRoutes();
    if (!hub) return;
    zones.forEach((zoneData, i) => {
      const zone = zoneData.zone || zoneData;
      if (i > 4) return; // Only draw top 5 routes
      const color = priorityColor(zoneData.priority || 'LOW');
      const line = L.polyline(
        [[hub.latitude, hub.longitude], [zone.latitude, zone.longitude]],
        { color, weight: 1.5, opacity: 0.5, dashArray: '5,8' }
      ).addTo(map);
      routeLines.push(line);
    });
  }

  function clearRoutes() {
    routeLines.forEach(l => map.removeLayer(l));
    routeLines = [];
  }

  function fitBounds(zones) {
    if (!zones.length) return;
    const coords = zones.map(z => [(z.zone||z).latitude, (z.zone||z).longitude]);
    map.fitBounds(L.latLngBounds(coords).pad(0.15));
  }

  return { init, renderZones, drawRoutes, fitBounds };
})();
