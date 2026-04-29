const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const zonesData = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/zones.json'), 'utf8'));

// ─── JSON File Database (Render-compatible, no external DB) ──────────────────
const DB_DIR = path.join(__dirname, '../data/db');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

function dbPath(name) { return path.join(DB_DIR, name + '.json'); }

function dbRead(name, fallback = []) {
  try {
    if (fs.existsSync(dbPath(name))) return JSON.parse(fs.readFileSync(dbPath(name), 'utf8'));
  } catch (e) { console.error('DB read error:', name, e.message); }
  return fallback;
}

function dbWrite(name, data) {
  try { fs.writeFileSync(dbPath(name), JSON.stringify(data, null, 2), 'utf8'); return true; }
  catch (e) { console.error('DB write error:', name, e.message); return false; }
}

// Load from disk (persists across restarts)
const sosBeacons = dbRead('sos_beacons');
const volunteers = dbRead('volunteers');
const alerts = dbRead('alerts');
const infraReports = dbRead('infra_reports');
const healthCases = dbRead('health_cases');
const helpRequests = dbRead('help_requests');
const convoys = dbRead('convoys');
const activityLog = dbRead('activity_log');

// Seed SOS demo data if empty
if (sosBeacons.length === 0) {
  const seed = [
    { id:'SOS-001', name:'Rajesh Kumar', latitude:13.09, longitude:80.28, people:5, urgency:'critical', emergencyType:'Trapped under debris', details:'Building collapsed near main road', phone:'9876543210', timestamp:new Date().toISOString(), status:'active' },
    { id:'SOS-002', name:'Priya Nair', latitude:13.06, longitude:80.25, people:12, urgency:'high', emergencyType:'Flood — need evacuation', details:'Water rising in basement area', phone:'9123456780', timestamp:new Date().toISOString(), status:'active' },
    { id:'SOS-003', name:'Arun Sharma', latitude:13.15, longitude:80.31, people:3, urgency:'medium', emergencyType:'Medical emergency', details:'Elderly person needs urgent medication', phone:'9988776655', timestamp:new Date().toISOString(), status:'active' }
  ];
  sosBeacons.push(...seed);
  dbWrite('sos_beacons', sosBeacons);
  console.log('📡 Seeded 3 demo SOS beacons');
}

// Seed volunteer demo data if empty
if (volunteers.length === 0) {
  const vseed = [
    { id:'VOL-001', name:'Dr. Meera Patel', organization:'Red Cross India', phone:'+91-9876543210', skills:['medical','counseling'], experience:'Expert / Certified', availability:'Full-time', status:'deployed', hoursServed:48, missionsCompleted:12, avatar:'👩‍⚕️', avatarBg:'#dbeafe', assignedZone:'Riverside Delta', registeredAt:new Date().toISOString() },
    { id:'VOL-002', name:'Arjun Singh', organization:'Rapid Response Team', phone:'+91-9123456789', skills:['rescue','driving','engineering'], experience:'Experienced', availability:'Full-time', status:'deployed', hoursServed:36, missionsCompleted:8, avatar:'👨‍🚒', avatarBg:'#fde68a', assignedZone:'Old Fisherman Port', registeredAt:new Date().toISOString() },
    { id:'VOL-003', name:'Kavitha Reddy', organization:'', phone:'+91-8765432109', skills:['cooking','logistics'], experience:'Intermediate', availability:'Part-time', status:'available', hoursServed:22, missionsCompleted:5, avatar:'🧑‍🍳', avatarBg:'#d1fae5', assignedZone:'', registeredAt:new Date().toISOString() },
    { id:'VOL-004', name:'Vikram Nair', organization:'Tech4Good NGO', phone:'+91-7654321098', skills:['communication','logistics'], experience:'Experienced', availability:'On-call', status:'available', hoursServed:30, missionsCompleted:7, avatar:'👨‍💼', avatarBg:'#ede9fe', assignedZone:'', registeredAt:new Date().toISOString() },
    { id:'VOL-005', name:'Sunita Devi', organization:'Women Aid Foundation', phone:'+91-6543210987', skills:['medical','counseling'], experience:'Intermediate', availability:'Weekends only', status:'resting', hoursServed:15, missionsCompleted:3, avatar:'👩', avatarBg:'#fce7f3', assignedZone:'', registeredAt:new Date().toISOString() }
  ];
  volunteers.push(...vseed);
  dbWrite('volunteers', volunteers);
  console.log('🤝 Seeded 5 demo volunteers');
}

function save(name, data) {
  if (!dbWrite(name, data)) {
    throw new Error('Failed to persist ' + name + ' to disk');
  }
}

// ─── Cross-Module Interlinking Engine ─────────────────────────────────────────
function logActivity(type, source, message, linkedId) {
  const entry = { id:'ACT-'+String(activityLog.length+1).padStart(4,'0'), type, source, message, linkedId, timestamp:new Date().toISOString() };
  activityLog.unshift(entry);
  if (activityLog.length > 200) activityLog.length = 200;
  save('activity_log', activityLog);
  return entry;
}

function autoDispatchConvoy(sourceType, sourceId, name, location, need, people) {
  const cargoMap = {
    food: ['🍱 '+Math.max(people*5,50)+' Food Kits','💧 '+Math.max(people*3,30)+' Water Units'],
    water: ['💧 '+Math.max(people*5,50)+' Water Units','🍱 '+Math.max(people*2,20)+' Food Kits'],
    medical: ['🏥 Medical Team','💉 '+Math.max(people*2,10)+' Med Kits','🚑 Ambulance'],
    rescue: ['👷 '+Math.max(Math.ceil(people/3),2)+' Rescue Teams','🔧 Heavy Equipment','🏥 First Aid'],
    sos: ['🚑 Emergency Response','🏥 Medical Kit','👷 Rescue Team','💧 Water Supply']
  };
  const convoy = {
    id: 'CV-'+String(convoys.length+1).padStart(3,'0'),
    sourceType, sourceId, 
    destination: name+' ('+sourceId+')',
    location: location || 'GPS Coordinates',
    type: need==='medical'||need==='sos'?'ambulance':need==='rescue'?'rescue':'supply',
    cargo: cargoMap[need] || cargoMap.sos,
    status: 'transit',
    progress: 0,
    people: people||1,
    dispatchedAt: new Date().toISOString(),
    eta: Math.ceil(Math.random()*20+10)+' min'
  };
  convoys.push(convoy);
  save('convoys', convoys);
  logActivity('convoy_dispatch','system','Auto-dispatched convoy '+convoy.id+' for '+sourceId+' → '+convoy.destination, convoy.id);
  return convoy;
}


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
        foodKits: customResources.foodKits != null ? parseInt(customResources.foodKits) : zonesData.defaultResources.foodKits,
        waterUnits: customResources.waterUnits != null ? parseInt(customResources.waterUnits) : zonesData.defaultResources.waterUnits,
        medicalKits: customResources.medicalKits != null ? parseInt(customResources.medicalKits) : zonesData.defaultResources.medicalKits,
        rescueTeams: customResources.rescueTeams != null ? parseInt(customResources.rescueTeams) : zonesData.defaultResources.rescueTeams,
        ambulances: customResources.ambulances != null ? parseInt(customResources.ambulances) : zonesData.defaultResources.ambulances
      };
      const plan = await buildPlan(resources);
      return jsonRes(res, 200, plan);
    }

    // ── SOS Beacon API ──
    if (pathname === '/api/sos' && req.method === 'GET') {
      return jsonRes(res, 200, { beacons: sosBeacons, total: sosBeacons.length, active: sosBeacons.filter(b => b.status === 'active').length });
    }
    if (pathname === '/api/sos' && req.method === 'POST') {
      const beacon = await parseBody(req);
      beacon.id = 'SOS-' + String(sosBeacons.length + 1).padStart(3, '0');
      beacon.timestamp = new Date().toISOString();
      beacon.status = beacon.status || 'active';
      sosBeacons.unshift(beacon);
      save('sos_beacons', sosBeacons);
      return jsonRes(res, 201, { success: true, beacon });
    }
    if (pathname.startsWith('/api/sos/') && req.method === 'PUT') {
      const id = pathname.split('/').pop();
      const update = await parseBody(req);
      const beacon = sosBeacons.find(b => b.id === id);
      if (!beacon) return jsonRes(res, 404, { error: 'Beacon not found' });
      const prevStatus = beacon.status;
      beacon.status = update.status || beacon.status;
      beacon.adminResponse = update.adminResponse || '';
      beacon.respondedAt = new Date().toISOString();
      save('sos_beacons', sosBeacons);
      logActivity('sos_'+beacon.status, 'admin', 'SOS '+id+' → '+beacon.status, id);
      // AUTO-INTERLINK: dispatch convoy when SOS is dispatched
      let convoy = null;
      if (beacon.status === 'dispatched' && prevStatus !== 'dispatched') {
        convoy = autoDispatchConvoy('sos', id, beacon.name, beacon.latitude+','+beacon.longitude, 'sos', beacon.people);
        // Auto-deploy available volunteer with matching skills
        const availVol = volunteers.find(v => v.status === 'available' && (v.skills?.includes('rescue') || v.skills?.includes('medical')));
        if (availVol) {
          availVol.status = 'deployed';
          availVol.assignedZone = 'SOS: '+beacon.name;
          availVol.missionsCompleted = (availVol.missionsCompleted||0)+1;
          save('volunteers', volunteers);
          logActivity('volunteer_auto_deploy','system','Auto-deployed '+availVol.name+' for '+id, availVol.id);
        }
      }
      // AUTO-INTERLINK: resolve linked convoys when SOS is resolved
      if (beacon.status === 'resolved') {
        convoys.filter(c => c.sourceId === id && c.status === 'transit').forEach(c => {
          c.status = 'delivered';
          c.progress = 1;
          c.updatedAt = new Date().toISOString();
          logActivity('convoy_delivered','system','Auto-delivered convoy '+c.id+' (SOS '+id+' resolved)', c.id);
        });
        save('convoys', convoys);
      }
      return jsonRes(res, 200, { success: true, beacon, convoy });
    }

    // ── Volunteer API ──
    if (pathname === '/api/volunteers' && req.method === 'GET') {
      return jsonRes(res, 200, {
        volunteers, total: volunteers.length,
        available: volunteers.filter(v => v.status === 'available').length,
        deployed: volunteers.filter(v => v.status === 'deployed').length,
        resting: volunteers.filter(v => v.status === 'resting').length
      });
    }
    if (pathname === '/api/volunteers' && req.method === 'POST') {
      const vol = await parseBody(req);
      vol.id = 'VOL-' + String(volunteers.length + 1).padStart(3, '0');
      vol.registeredAt = new Date().toISOString();
      vol.status = 'available';
      vol.missionsCompleted = 0;
      vol.hoursServed = 0;
      vol.assignedZone = '';
      volunteers.push(vol);
      save('volunteers', volunteers);
      return jsonRes(res, 201, { success: true, volunteer: vol });
    }
    if (pathname.startsWith('/api/volunteers/') && req.method === 'PUT') {
      const id = pathname.split('/').pop();
      const update = await parseBody(req);
      const vol = volunteers.find(v => v.id === id);
      if (!vol) return jsonRes(res, 404, { error: 'Volunteer not found' });
      if (update.status) vol.status = update.status;
      if (update.assignedZone !== undefined) vol.assignedZone = update.assignedZone;
      if (update.hoursServed !== undefined) vol.hoursServed = update.hoursServed;
      if (update.missionsCompleted !== undefined) vol.missionsCompleted = update.missionsCompleted;
      vol.updatedAt = new Date().toISOString();
      save('volunteers', volunteers);
      return jsonRes(res, 200, { success: true, volunteer: vol });
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
      save('alerts', alerts);
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
      save('infra_reports', infraReports);
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
      save('health_cases', healthCases);
      return jsonRes(res, 201, { success: true, case: hcase });
    }

    // ── NASA EONET Events ──
    if (pathname === '/api/satellite/events' && req.method === 'GET') {
      const data = await fetchNasaEONET();
      return jsonRes(res, 200, data);
    }

    // ── Help Requests API ──
    if (pathname === '/api/help-requests' && req.method === 'GET') {
      return jsonRes(res, 200, { requests: helpRequests, total: helpRequests.length, pending: helpRequests.filter(r => r.status === 'pending').length });
    }
    if (pathname === '/api/help-requests' && req.method === 'POST') {
      const hr = await parseBody(req);
      hr.id = 'HR-' + String(helpRequests.length + 1).padStart(3, '0');
      hr.status = 'pending';
      hr.submittedAt = new Date().toISOString();
      helpRequests.push(hr);
      save('help_requests', helpRequests);
      return jsonRes(res, 201, { success: true, request: hr });
    }
    if (pathname.startsWith('/api/help-requests/') && req.method === 'PUT') {
      const id = pathname.split('/').pop();
      const update = await parseBody(req);
      const hr = helpRequests.find(r => r.id === id);
      if (!hr) return jsonRes(res, 404, { error: 'Request not found' });
      const prevStatus = hr.status;
      hr.status = update.status || hr.status;
      hr.adminNote = update.adminNote || '';
      hr.respondedAt = new Date().toISOString();
      save('help_requests', helpRequests);
      logActivity('help_'+hr.status, 'admin', 'Help Request '+id+' → '+hr.status, id);
      // AUTO-INTERLINK: dispatch convoy when help request is dispatched
      let convoy = null;
      if (hr.status === 'dispatched' && prevStatus !== 'dispatched') {
        convoy = autoDispatchConvoy('help_request', id, hr.name, hr.location, hr.need, hr.people);
      }
      // AUTO-INTERLINK: resolve linked convoys when HR is resolved
      if (hr.status === 'resolved' || hr.status === 'accepted') {
        convoys.filter(c => c.sourceId === id && c.status === 'transit').forEach(c => {
          c.status = 'delivered';
          c.progress = 1;
          c.updatedAt = new Date().toISOString();
          logActivity('convoy_delivered','system','Auto-delivered convoy '+c.id+' (HR '+id+' '+hr.status+')', c.id);
        });
        save('convoys', convoys);
      }
      return jsonRes(res, 200, { success: true, request: hr, convoy });
    }

    // ── Convoy API (auto-created + manual) ──
    if (pathname === '/api/convoys' && req.method === 'GET') {
      return jsonRes(res, 200, { convoys, total:convoys.length, inTransit:convoys.filter(c=>c.status==='transit').length, delivered:convoys.filter(c=>c.status==='delivered').length });
    }
    if (pathname.startsWith('/api/convoys/') && req.method === 'PUT') {
      const id = pathname.split('/').pop();
      const update = await parseBody(req);
      const c = convoys.find(cv=>cv.id===id);
      if(!c)return jsonRes(res,404,{error:'Convoy not found'});
      if(update.status)c.status=update.status;
      if(update.progress!==undefined)c.progress=update.progress;
      c.updatedAt=new Date().toISOString();
      save('convoys',convoys);
      logActivity('convoy_'+c.status,'admin','Convoy '+id+' → '+c.status,id);
      return jsonRes(res,200,{success:true,convoy:c});
    }

    // ── Activity Log API ──
    if (pathname === '/api/activity' && req.method === 'GET') {
      return jsonRes(res, 200, { activities: activityLog.slice(0,50), total:activityLog.length });
    }

    // ── Dashboard Stats (enhanced with interlinking) ──
    if (pathname === '/api/stats' && req.method === 'GET') {
      return jsonRes(res, 200, {
        zones: zonesData.zones.length,
        population: zonesData.zones.reduce((s, z) => s + z.population, 0),
        criticalZones: zonesData.zones.filter(z => z.severity >= 8).length,
        activeBeacons: sosBeacons.filter(b => b.status === 'active').length,
        totalSOS: sosBeacons.length,
        volunteers: volunteers.length,
        deployedVolunteers: volunteers.filter(v=>v.status==='deployed').length,
        activeAlerts: alerts.filter(a => !a.acknowledged).length,
        infraReports: infraReports.length,
        healthCases: healthCases.length,
        pendingRequests: helpRequests.filter(r => r.status === 'pending').length,
        totalRequests: helpRequests.length,
        activeConvoys: convoys.filter(c=>c.status==='transit').length,
        totalConvoys: convoys.length,
        recentActivity: activityLog.slice(0,5)
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
  console.log(`\n🚨 CrisisIQ Server v3.5 running at http://localhost:${PORT}`);
  console.log(`   API Health:      http://localhost:${PORT}/api/health`);
  console.log(`   Zones:           http://localhost:${PORT}/api/zones`);
  console.log(`   Plan:            http://localhost:${PORT}/api/plan`);
  console.log(`   SOS Beacons:     http://localhost:${PORT}/api/sos`);
  console.log(`   Volunteers:      http://localhost:${PORT}/api/volunteers`);
  console.log(`   Alerts:          http://localhost:${PORT}/api/alerts`);
  console.log(`   Infrastructure:  http://localhost:${PORT}/api/infrastructure`);
  console.log(`   Health Data:     http://localhost:${PORT}/api/health-data`);
  console.log(`   Help Requests:   http://localhost:${PORT}/api/help-requests`);
  console.log(`   Satellite:       http://localhost:${PORT}/api/satellite/events\n`);
});
