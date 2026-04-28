const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const zonesData = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/zones.json'), 'utf8'));

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

  // Rescue teams: top zones with rescue need first
  const rescueQueue = [...rankedZones].filter(z => z.zone.rescueNeed > 0);
  let rescueLeft = remaining.rescueTeams;
  rescueQueue.forEach(rz => {
    const give = Math.min(rz.zone.rescueNeed, rescueLeft);
    rz.allocation = rz.allocation || {};
    rz.allocation.rescueTeams = give;
    rescueLeft -= give;
  });
  remaining.rescueTeams = rescueLeft;

  // Ambulances: zones with high medical urgency
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

  // Divisible resources: proportional by score * unmet need
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
      weathercode: wc,
      precipitation: rain,
      windspeed: wind,
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
    const res = await fetch(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson'
    );
    const data = await res.json();
    return {
      count: data.features?.length || 0,
      recent: data.features?.slice(0, 3).map(f => ({
        magnitude: f.properties.mag,
        place: f.properties.place,
        time: new Date(f.properties.time).toISOString()
      })) || [],
      source: 'USGS GeoJSON Feed'
    };
  } catch {
    return { count: 2, recent: [{ magnitude: 3.2, place: 'Near Region (fallback)', time: new Date().toISOString() }], source: 'Fallback' };
  }
}

// ─── Route Handler ────────────────────────────────────────────────────────────
async function handleRequest(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Serve static frontend files
  if (!pathname.startsWith('/api')) {
    let filePath = path.join(__dirname, '../public', pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath)) filePath = path.join(__dirname, '../public/index.html');
    const ext = path.extname(filePath);
    const mimeTypes = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.setHeader('Content-Type', 'application/json');

  // GET /api/health
  if (pathname === '/api/health' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0', project: 'CrisisIQ' }));
    return;
  }

  // GET /api/zones
  if (pathname === '/api/zones' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ zones: zonesData.zones, reliefHub: zonesData.reliefHub }));
    return;
  }

  // GET /api/resources
  if (pathname === '/api/resources' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ defaultResources: zonesData.defaultResources }));
    return;
  }

  // GET /api/plan (default resources)
  if (pathname === '/api/plan' && req.method === 'GET') {
    const plan = await buildPlan(zonesData.defaultResources);
    res.writeHead(200);
    res.end(JSON.stringify(plan));
    return;
  }

  // POST /api/plan (custom resources)
  if (pathname === '/api/plan' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const customResources = JSON.parse(body);
        const resources = {
          foodKits: parseInt(customResources.foodKits) || zonesData.defaultResources.foodKits,
          waterUnits: parseInt(customResources.waterUnits) || zonesData.defaultResources.waterUnits,
          medicalKits: parseInt(customResources.medicalKits) || zonesData.defaultResources.medicalKits,
          rescueTeams: parseInt(customResources.rescueTeams) || zonesData.defaultResources.rescueTeams,
          ambulances: parseInt(customResources.ambulances) || zonesData.defaultResources.ambulances
        };
        const plan = await buildPlan(resources);
        res.writeHead(200);
        res.end(JSON.stringify(plan));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
}

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
        zone,
        score: result.total,
        scoreComponents: result.components,
        priority: zone.severity >= 8 ? 'CRITICAL' : zone.severity >= 6 ? 'HIGH' : zone.severity >= 4 ? 'MEDIUM' : 'LOW'
      };
    })
    .sort((a, b) => b.score - a.score);

  const { allocations, remaining } = allocateResources(rankedZones, { ...resources });
  const explanation = generateExplanation(rankedZones);

  return {
    generatedAt: new Date().toISOString(),
    reliefHub: zonesData.reliefHub,
    resources,
    remainingResources: remaining,
    weatherData: weather,
    earthquakeData: earthquakes,
    totalAffectedPopulation: zonesData.zones.reduce((s, z) => s + z.population, 0),
    criticalZoneCount: zonesData.zones.filter(z => z.severity >= 8).length,
    rankedZones: allocations,
    decisionExplanation: explanation
  };
}

// ─── Start Server ─────────────────────────────────────────────────────────────
const server = http.createServer(handleRequest);
server.listen(PORT, () => {
  console.log(`\n🚨 CrisisIQ Server running at http://localhost:${PORT}`);
  console.log(`   API Health:  http://localhost:${PORT}/api/health`);
  console.log(`   Zones:       http://localhost:${PORT}/api/zones`);
  console.log(`   Plan:        http://localhost:${PORT}/api/plan\n`);
});
