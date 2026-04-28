const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const zonesData = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/zones.json'), 'utf8'));

// ─── In-Memory Stores ────────────────────────────────────────────────────────
const sosBeacons = [];
const volunteers = [];
const alerts = [];
const infraReports = [];
const healthCases = [];

// ─── Priority Score Engine ────────────────────────────────────────────────────
function calcPriorityScore(zone, weatherRisk = 0) {
  const populationPressure = Math.min(zone.population / 15000, 1);
  const vulnerabilityShare = zone.vulnerablePeople / zone.population;
  const accessDifficulty = zone.roadAccess === 'blocked' ? 1 : zone.roadAccess === 'partial' ? 0.5 : 0;
  const medicalUrgency = Math.min(zone.hospitalDistanceKm / 50, 1);
  const incidentScore = Math.min(zone.incidentReports / 60, 1);
  const shelterGap = Math.max(0, (zone.population - zone.shelterCapacity) / zone.population);
  const severityNorm = zone.severity / 10;

  const score =
    severityNorm * 0.27 +
    populationPressure * 0.15 +
    vulnerabilityShare * 0.16 +
    accessDifficulty * 0.14 +
    medicalUrgency * 0.11 +
    incidentScore * 0.08 +
    shelterGap * 0.05 +
    weatherRisk * 0.04;

  return {
    total: parseFloat(score.toFixed(4)),
    components: {
      severity: parseFloat((severityNorm * 0.27).toFixed(4)),
      populationPressure: parseFloat((populationPressure * 0.15).toFixed(4)),
      vulnerabilityShare: parseFloat((vulnerabilityShare * 0.16).toFixed(4)),
      accessDifficulty: parseFloat((accessDifficulty * 0.14).toFixed(4)),
      medicalUrgency: parseFloat((medicalUrgency * 0.11).toFixed(4)),
      incidentReports: parseFloat((incidentScore * 0.08).toFixed(4)),
      shelterGap: parseFloat((shelterGap * 0.05).toFixed(4)),
      weatherRisk: parseFloat((weatherRisk * 0.04).toFixed(4))
    }
  };
}

// ─── Resource Allocator ───────────────────────────────────────────────────────
function allocateResources(rankedZones, resources) {
  let remaining = { ...resources };
  const allocations = [];

  const rescueQueue = [...rankedZones].filter(z => z.zone.rescueNeed > 0);
  let rescueLeft = remaining.rescueTeams;
  rescueQueue.forEach(rz => {
    const give = Math.min(rz.zone.rescueNeed, rescueLeft);
    rz.allocation = rz.allocation || {};
    rz.allocation.rescueTeams = give;
    rescueLeft -= give;
  });
  remaining.rescueTeams = rescueLeft;

  const ambQueue = [...rankedZones].sort((a, b) =>
    b.scoreComponents.medicalUrgency - a.scoreComponents.medicalUrgency
  );
  let ambLeft = remaining.ambulances;
  ambQueue.forEach(rz => {
    const need = Math.ceil(rz.zone.medicalNeed / 20);
    const give = Math.min(need, ambLeft);
    rz.allocation = rz.allocation || {};
    rz.allocation.ambulances = give;
    ambLeft -= give;
  });
  remaining.ambulances = ambLeft;

  const totalScore = rankedZones.reduce((s, rz) => s + rz.score, 0);
  rankedZones.forEach(rz => {
    const share = rz.score / totalScore;
    rz.allocation = rz.allocation || {};
    rz.allocation.foodKits = Math.min(Math.floor(remaining.foodKits * share), rz.zone.foodNeed);
    rz.allocation.waterUnits = Math.min(Math.floor(remaining.waterUnits * share), rz.zone.waterNeed);
    rz.allocation.medicalKits = Math.min(Math.floor(remaining.medicalKits * share), rz.zone.medicalNeed);
    allocations.push(rz);
  });

  remaining.foodKits = Math.max(0, remaining.foodKits - allocations.reduce((s, rz) => s + (rz.allocation.foodKits || 0), 0));
  remaining.waterUnits = Math.max(0, remaining.waterUnits - allocations.reduce((s, rz) => s + (rz.allocation.waterUnits || 0), 0));
  remaining.medicalKits = Math.max(0, remaining.medicalKits - allocations.reduce((s, rz) => s + (rz.allocation.medicalKits || 0), 0));

  return { allocations, remaining };
}

// ─── Explanation Generator ────────────────────────────────────────────────────
function generateExplanation(rankedZones) {
  const top = rankedZones[0];
  const critical = rankedZones.filter(rz => rz.zone.severity >= 8);
  return `${top.zone.name} is the highest-priority zone with a score of ${(top.score * 100).toFixed(1)}%. ` +
    `${critical.length} critical zones (severity ≥ 8) require immediate attention. ` +
    `Resource allocation prioritizes zones with blocked road access and high vulnerability populations. ` +
    `Total affected population across all zones: ${rankedZones.reduce((s, rz) => s + rz.zone.population, 0).toLocaleString()} people.`;
}

// ─── Live Data Fetchers ───────────────────────────────────────────────────────
async function fetchWeather(lat, lon) {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=precipitation,weathercode,windspeed_10m&timezone=auto`
    );
    const data = await res.json();
    const wc = data.current?.weathercode || 0;
    const rain = data.current?.precipitation || 0;
    const wind = data.current?.windspeed_10m || 0;
    const risk = Math.min((rain * 0.4 + (wc > 60 ? 0.6 : wc > 40 ? 0.3 : 0) + wind / 200), 1);
    return {
      weathercode: wc, precipitation: rain, windspeed: wind,
      riskScore: parseFloat(risk.toFixed(2)),
      status: wc >= 80 ? 'Severe Storm' : wc >= 60 ? 'Heavy Rain' : wc >= 40 ? 'Moderate Rain' : 'Clear',
      source: 'Open-Meteo API'
    };
  } catch {
    return { weathercode: 0, precipitation: 0, windspeed: 0, riskScore: 0.1, status: 'Unknown (fallback)', source: 'Fallback' };
  }
}

async function fetchEarthquakes() {
  try {
    const res = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson');
    const data = await res.json();
    return {
      count: data.features?.length || 0,
      recent: data.features?.slice(0, 3).map(f => ({
        magnitude: f.properties.mag, place: f.properties.place,
        time: new Date(f.properties.time).toISOString()
      })) || [],
      source: 'USGS GeoJSON Feed'
    };
  } catch {
    return { count: 2, recent: [{ magnitude: 3.2, place: 'Near Region (fallback)', time: new Date().toISOString() }], source: 'Fallback' };
  }
}

async function fetchNasaEONET() {
  try {
    const res = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?limit=20&status=open');
    const data = await res.json();
    return { events: data.events || [], source: 'NASA EONET v3' };
  } catch {
    return { events: [], source: 'Fallback' };
  }
}

// ─── Build Plan ───────────────────────────────────────────────────────────────
async function buildPlan(resources) {
  const hub = zonesData.reliefHub;
  const [weather, earthquakes] = await Promise.all([
    fetchWeather(hub.latitude, hub.longitude),
    fetchEarthquakes()
  ]);

  const rankedZones = zonesData.zones
    .map(zone => {
      const result = calcPriorityScore(zone, weather.riskScore);
      return {
        zone, score: result.total, scoreComponents: result.components,
        priority: zone.severity >= 8 ? 'CRITICAL' : zone.severity >= 6 ? 'HIGH' : zone.severity >= 4 ? 'MEDIUM' : 'LOW'
      };
    })
    .sort((a, b) => b.score - a.score);

  const { allocations, remaining } = allocateResources(rankedZones, { ...resources });
  const explanation = generateExplanation(rankedZones);

  return {
    generatedAt: new Date().toISOString(),
    reliefHub: zonesData.reliefHub,
    resources, remainingResources: remaining,
    weatherData: weather, earthquakeData: earthquakes,
    totalAffectedPopulation: zonesData.zones.reduce((s, z) => s + z.population, 0),
    criticalZoneCount: zonesData.zones.filter(z => z.severity >= 8).length,
    rankedZones: allocations, decisionExplanation: explanation
  };
}

// ─── Helper: Parse JSON Body ──────────────────────────────────────────────────
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
  });
}

function jsonRes(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ─── Route Handler ────────────────────────────────────────────────────────────
async function handleRequest(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Serve static frontend files
  if (!pathname.startsWith('/api')) {
    let filePath = path.join(__dirname, '../public', pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath)) filePath = path.join(__dirname, '../public/index.html');
    const ext = path.extname(filePath);
    const mimeTypes = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.setHeader('Content-Type', 'application/json');

  try {
    // ── Original Endpoints ──
    if (pathname === '/api/health' && req.method === 'GET') {
      return jsonRes(res, 200, { status: 'ok', timestamp: new Date().toISOString(), version: '2.5.0', project: 'CrisisIQ', modules: ['command-center','ai-chat','sos','convoys','analytics','scenarios','social-monitor','reports','satellite','volunteers','alerts','infrastructure','health-tracker'] });
    }

    if (pathname === '/api/zones' && req.method === 'GET') {
      return jsonRes(res, 200, { zones: zonesData.zones, reliefHub: zonesData.reliefHub });
    }

    if (pathname === '/api/resources' && req.method === 'GET') {
      return jsonRes(res, 200, { defaultResources: zonesData.defaultResources });
    }

    if (pathname === '/api/plan' && req.method === 'GET') {
      const plan = await buildPlan(zonesData.defaultResources);
      return jsonRes(res, 200, plan);
    }

    if (pathname === '/api/plan' && req.method === 'POST') {
      const customResources = await parseBody(req);
      const resources = {
        foodKits: parseInt(customResources.foodKits) || zonesData.defaultResources.foodKits,
        waterUnits: parseInt(customResources.waterUnits) || zonesData.defaultResources.waterUnits,
        medicalKits: parseInt(customResources.medicalKits) || zonesData.defaultResources.medicalKits,
        rescueTeams: parseInt(customResources.rescueTeams) || zonesData.defaultResources.rescueTeams,
        ambulances: parseInt(customResources.ambulances) || zonesData.defaultResources.ambulances
      };
      const plan = await buildPlan(resources);
      return jsonRes(res, 200, plan);
    }

    // ── SOS Beacon API ──
    if (pathname === '/api/sos' && req.method === 'GET') {
      return jsonRes(res, 200, { beacons: sosBeacons, total: sosBeacons.length });
    }
    if (pathname === '/api/sos' && req.method === 'POST') {
      const beacon = await parseBody(req);
      beacon.id = 'SOS-' + String(sosBeacons.length + 1).padStart(3, '0');
      beacon.timestamp = new Date().toISOString();
      beacon.status = beacon.status || 'active';
      sosBeacons.unshift(beacon);
      return jsonRes(res, 201, { success: true, beacon });
    }

    // ── Volunteer API ──
    if (pathname === '/api/volunteers' && req.method === 'GET') {
      return jsonRes(res, 200, { volunteers, total: volunteers.length });
    }
    if (pathname === '/api/volunteers' && req.method === 'POST') {
      const vol = await parseBody(req);
      vol.id = 'VOL-' + String(volunteers.length + 1).padStart(3, '0');
      vol.registeredAt = new Date().toISOString();
      vol.status = 'available';
      vol.missionsCompleted = 0;
      vol.hoursServed = 0;
      volunteers.push(vol);
      return jsonRes(res, 201, { success: true, volunteer: vol });
    }
    if (pathname === '/api/volunteers/match' && req.method === 'GET') {
      const matches = volunteers.filter(v => v.status === 'available').map(v => {
        const zone = zonesData.zones.find(z => {
          if (v.skills?.includes('medical') && z.medicalNeed > 50) return true;
          if (v.skills?.includes('rescue') && z.rescueNeed > 3) return true;
          if (v.skills?.includes('logistics') && z.foodNeed > 500) return true;
          return z.severity >= 7;
        });
        return { volunteer: v, suggestedZone: zone || zonesData.zones[0], matchScore: Math.random() * 40 + 60 };
      });
      return jsonRes(res, 200, { matches });
    }

    // ── Alert API ──
    if (pathname === '/api/alerts' && req.method === 'GET') {
      return jsonRes(res, 200, { alerts, total: alerts.length });
    }
    if (pathname === '/api/alerts' && req.method === 'POST') {
      const alert = await parseBody(req);
      alert.id = 'ALT-' + String(alerts.length + 1).padStart(3, '0');
      alert.createdAt = new Date().toISOString();
      alert.acknowledged = false;
      alerts.unshift(alert);
      return jsonRes(res, 201, { success: true, alert });
    }

    // ── Infrastructure API ──
    if (pathname === '/api/infrastructure' && req.method === 'GET') {
      return jsonRes(res, 200, { reports: infraReports, total: infraReports.length });
    }
    if (pathname === '/api/infrastructure' && req.method === 'POST') {
      const report = await parseBody(req);
      report.id = 'INF-' + String(infraReports.length + 1).padStart(3, '0');
      report.reportedAt = new Date().toISOString();
      infraReports.push(report);
      return jsonRes(res, 201, { success: true, report });
    }

    // ── Health Tracker API ──
    if (pathname === '/api/health-data' && req.method === 'GET') {
      return jsonRes(res, 200, { cases: healthCases, total: healthCases.length });
    }
    if (pathname === '/api/health-data' && req.method === 'POST') {
      const hcase = await parseBody(req);
      hcase.id = 'HC-' + String(healthCases.length + 1).padStart(3, '0');
      hcase.reportedAt = new Date().toISOString();
      healthCases.push(hcase);
      return jsonRes(res, 201, { success: true, case: hcase });
    }

    // ── NASA EONET Events ──
    if (pathname === '/api/satellite/events' && req.method === 'GET') {
      const data = await fetchNasaEONET();
      return jsonRes(res, 200, data);
    }

    // ── Dashboard Stats ──
    if (pathname === '/api/stats' && req.method === 'GET') {
      return jsonRes(res, 200, {
        zones: zonesData.zones.length,
        population: zonesData.zones.reduce((s, z) => s + z.population, 0),
        criticalZones: zonesData.zones.filter(z => z.severity >= 8).length,
        activeBeacons: sosBeacons.filter(b => b.status === 'active').length,
        volunteers: volunteers.length,
        activeAlerts: alerts.filter(a => !a.acknowledged).length,
        infraReports: infraReports.length,
        healthCases: healthCases.length
      });
    }

    jsonRes(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error('API Error:', e);
    jsonRes(res, 500, { error: 'Internal server error' });
  }
}

// ─── Start Server ─────────────────────────────────────────────────────────────
const server = http.createServer(handleRequest);
server.listen(PORT, () => {
  console.log(`\n🚨 CrisisIQ Server v2.5 running at http://localhost:${PORT}`);
  console.log(`   API Health:      http://localhost:${PORT}/api/health`);
  console.log(`   Zones:           http://localhost:${PORT}/api/zones`);
  console.log(`   Plan:            http://localhost:${PORT}/api/plan`);
  console.log(`   SOS Beacons:     http://localhost:${PORT}/api/sos`);
  console.log(`   Volunteers:      http://localhost:${PORT}/api/volunteers`);
  console.log(`   Alerts:          http://localhost:${PORT}/api/alerts`);
  console.log(`   Infrastructure:  http://localhost:${PORT}/api/infrastructure`);
  console.log(`   Health Data:     http://localhost:${PORT}/api/health-data`);
  console.log(`   Satellite:       http://localhost:${PORT}/api/satellite/events\n`);
});
