// CrisisIQ — Main Application Controller
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  const API = '';
  let currentPlan = null;
  let scenarioTimer = null;

  // ── DOM REFS ──────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);

  // ── CLOCK ─────────────────────────────────────────────────────────────────
  function tickClock() {
    const now = new Date();
    $('header-clock').textContent = now.toLocaleTimeString('en-US', { hour12: false });
  }
  setInterval(tickClock, 1000);
  tickClock();

  // ── INIT ──────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    CrisisMap.init();
    await loadInitialZones();
    setupEvents();
    startLiveFeed();
  });

  async function loadInitialZones() {
    try {
      const res = await fetch(API + '/api/zones');
      const data = await res.json();
      baseZones = data.zones; // save original zones for disaster switching
      currentHub = data.reliefHub;
      CrisisMap.renderZones(
        data.zones.map(z => ({ zone: z, priority: getPriority(z.severity) })),
        data.reliefHub,
        openZoneModal
      );
      CrisisMap.fitBounds(data.zones.map(z => ({ zone: z })));
      $('val-zones').textContent = data.zones.length;
      $('val-population').textContent = data.zones.reduce((s, z) => s + z.population, 0).toLocaleString();
      $('val-critical').textContent = data.zones.filter(z => z.severity >= 8).length;
    } catch (e) {
      console.error('Failed to load zones:', e);
    }
  }

  function getPriority(severity) {
    if (severity >= 8) return 'CRITICAL';
    if (severity >= 6) return 'HIGH';
    if (severity >= 4) return 'MEDIUM';
    return 'LOW';
  }

  // ── DISASTER TYPE PRESETS ────────────────────────────────────────────────
  const DISASTER_PRESETS = {
    flood: {
      label: '🌊 Flood & Storm',
      icon: '🌩️',
      weatherLabel: 'Severe Storm',
      scenarioLabel: '🌊 Scenario: Severe Flood & Storm',
      severityModifiers: { Z001: 9, Z002: 8, Z003: 5, Z004: 7, Z005: 6, Z006: 4, Z007: 3, Z008: 8 },
      noteOverrides: {
        Z001: 'Severe flooding, multiple buildings collapsed, rescue ops ongoing',
        Z002: 'Landslides blocking main road, hospital overwhelmed',
        Z005: 'River overflowing, low-lying areas submerged',
        Z008: 'Flash flood alert, fishing boats stranded'
      }
    },
    earthquake: {
      label: '🏚️ Earthquake',
      icon: '🏚️',
      weatherLabel: 'Post-Quake',
      scenarioLabel: '🏚️ Scenario: Major Earthquake (6.8M)',
      severityModifiers: { Z001: 10, Z002: 9, Z003: 8, Z004: 6, Z005: 4, Z006: 7, Z007: 5, Z008: 9 },
      noteOverrides: {
        Z001: 'Multiple structures collapsed, trapped survivors reported, urgent rescue needed',
        Z002: 'Hillside buildings destroyed, aftershock damage ongoing',
        Z003: 'Market buildings cracked, gas leak detected',
        Z006: 'Old infrastructure collapsed, water mains broken',
        Z008: 'Coastal structures damaged, ground liquefaction observed'
      }
    },
    cyclone: {
      label: '🌀 Cyclone',
      icon: '🌀',
      weatherLabel: 'Cyclone Cat-3',
      scenarioLabel: '🌀 Scenario: Cyclone Vardah (Category 3)',
      severityModifiers: { Z001: 9, Z002: 7, Z003: 6, Z004: 8, Z005: 9, Z006: 5, Z007: 4, Z008: 10 },
      noteOverrides: {
        Z001: 'Severe wind damage, roofs torn off, power lines down',
        Z004: 'Cyclone surge flooding industrial zone, toxic spill risk',
        Z005: 'Eye of cyclone passed nearby, extreme damage radius',
        Z008: 'Coastal port destroyed, storm surge 3m+, mass evacuation needed'
      }
    },
    wildfire: {
      label: '🔥 Wildfire',
      icon: '🔥',
      weatherLabel: 'Fire Extreme',
      scenarioLabel: '🔥 Scenario: Urban Wildfire Spread',
      severityModifiers: { Z001: 6, Z002: 10, Z003: 7, Z004: 9, Z005: 4, Z006: 8, Z007: 5, Z008: 3 },
      noteOverrides: {
        Z002: 'Hillside wildfire spreading rapidly, evacuation ordered',
        Z004: 'Industrial fire from chemical plant, toxic smoke plume',
        Z006: 'Dry vegetation fire approaching residential area',
        Z003: 'Market district fire from gas leak, multiple blocks affected'
      }
    },
    tsunami: {
      label: '🌊 Tsunami',
      icon: '🌊',
      weatherLabel: 'Tsunami Alert',
      scenarioLabel: '🌊 Scenario: Tsunami Warning (Coastal Impact)',
      severityModifiers: { Z001: 10, Z002: 4, Z003: 7, Z004: 6, Z005: 9, Z006: 5, Z007: 3, Z008: 10 },
      noteOverrides: {
        Z001: 'Tsunami wave 2.5m hit coastline, massive inundation',
        Z005: 'Riverside completely submerged by tsunami backwash',
        Z008: 'Port obliterated, ships washed ashore, search & rescue active',
        Z003: 'Inland flooding from tsunami surge reaching 1.5km'
      }
    },
    epidemic: {
      label: '🦠 Epidemic',
      icon: '🦠',
      weatherLabel: 'Outbreak Lv4',
      scenarioLabel: '🦠 Scenario: Disease Outbreak (Level 4)',
      severityModifiers: { Z001: 8, Z002: 6, Z003: 9, Z004: 7, Z005: 5, Z006: 8, Z007: 10, Z008: 4 },
      noteOverrides: {
        Z003: 'Market Square — epicenter of outbreak, quarantine zone established',
        Z006: 'Hospital ICU overflow, 200+ cases in 48hrs',
        Z007: 'Dense residential area, rapid community spread detected',
        Z001: 'Medical supply shortage critical, mobile clinics deployed'
      }
    }
  };

  let baseZones = []; // original zone data
  let currentDisaster = 'flood';

  function applyDisasterPreset(type) {
    currentDisaster = type;
    const preset = DISASTER_PRESETS[type];
    if (!preset || !baseZones.length) return;

    // Clone and modify zones based on preset
    const modifiedZones = baseZones.map(z => {
      const clone = Object.assign({}, z);
      if (preset.severityModifiers[z.id] !== undefined) {
        clone.severity = preset.severityModifiers[z.id];
      }
      if (preset.noteOverrides[z.id]) {
        clone.notes = preset.noteOverrides[z.id];
      }
      // Adjust road access for high severity
      if (clone.severity >= 9) clone.roadAccess = 'blocked';
      else if (clone.severity >= 7) clone.roadAccess = 'partial';
      else clone.roadAccess = 'clear';
      return clone;
    });

    // Re-render map
    CrisisMap.renderZones(
      modifiedZones.map(z => ({ zone: z, priority: getPriority(z.severity) })),
      currentHub,
      openZoneModal
    );
    CrisisMap.fitBounds(modifiedZones.map(z => ({ zone: z })));

    // Update metrics
    $('val-zones').textContent = modifiedZones.length;
    $('val-population').textContent = modifiedZones.reduce((s, z) => s + z.population, 0).toLocaleString();
    $('val-critical').textContent = modifiedZones.filter(z => z.severity >= 8).length;
    $('val-weather').textContent = preset.weatherLabel;
    $('sig-weather').textContent = preset.weatherLabel;

    // Update scenario banner
    $('scenario-text').textContent = preset.scenarioLabel + ' — Active';

    addFeedItem('yellow', 'Disaster scenario switched to ' + preset.label);
  }

  let currentHub = null;

  // ── EVENT HANDLERS ────────────────────────────────────────────────────────
  function setupEvents() {
    $('btn-generate-plan').addEventListener('click', generatePlan);
    $('btn-demo-scenario').addEventListener('click', toggleScenario);
    $('btn-scenario-stop').addEventListener('click', stopScenario);
    $('btn-export').addEventListener('click', exportPlan);

    // Disaster type selector
    const disasterSel = $('disaster-type');
    if (disasterSel) {
      disasterSel.addEventListener('change', (e) => {
        applyDisasterPreset(e.target.value);
      });
    }
  }

  // ── GENERATE PLAN ─────────────────────────────────────────────────────────
  async function generatePlan() {
    const btn = $('btn-generate-plan');
    const txt = $('btn-generate-text');
    const spin = $('btn-generate-spinner');
    txt.textContent = 'Computing...';
    spin.classList.remove('hidden');
    btn.disabled = true;

    const body = {
      foodKits: parseInt($('res-food').value) || 0,
      waterUnits: parseInt($('res-water').value) || 0,
      medicalKits: parseInt($('res-medical').value) || 0,
      rescueTeams: parseInt($('res-rescue').value) || 0,
      ambulances: parseInt($('res-ambulance').value) || 0
    };

    try {
      const res = await fetch(API + '/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      currentPlan = await res.json();
      renderPlan(currentPlan);
      addFeedItem('green', 'Allocation plan generated successfully');
    } catch (e) {
      console.error('Plan error:', e);
      addFeedItem('red', 'Failed to generate plan — check server');
    } finally {
      txt.textContent = '⚡ Generate Allocation Plan';
      spin.classList.add('hidden');
      btn.disabled = false;
    }
  }

  // ── RENDER PLAN ───────────────────────────────────────────────────────────
  function renderPlan(plan) {
    // Metrics
    $('val-population').textContent = plan.totalAffectedPopulation.toLocaleString();
    $('val-critical').textContent = plan.criticalZoneCount;
    $('val-weather').textContent = plan.weatherData.status;
    $('val-quakes').textContent = plan.earthquakeData.count;

    // Signals sidebar
    $('sig-weather').textContent = plan.weatherData.status;
    $('sig-rain').textContent = plan.weatherData.precipitation + ' mm';
    $('sig-wind').textContent = plan.weatherData.windspeed + ' km/h';
    $('sig-quakes').textContent = plan.earthquakeData.count + ' events (24h)';

    // Recent quakes
    const qc = $('recent-quakes');
    qc.innerHTML = plan.earthquakeData.recent.map(q =>
      `<div class="quake-item"><span class="quake-mag">M${q.magnitude}</span> ${q.place}</div>`
    ).join('');

    // Update map with ranked zones
    CrisisMap.renderZones(plan.rankedZones, plan.reliefHub, openZoneModal);
    CrisisMap.drawRoutes(plan.rankedZones, plan.reliefHub);

    // Top priority insight
    renderInsight(plan.rankedZones[0]);

    // Timestamp
    $('plan-timestamp').textContent = 'Generated: ' + new Date(plan.generatedAt).toLocaleTimeString();

    // Decision explanation
    const dec = $('decision-explanation');
    dec.textContent = '🤖 ' + plan.decisionExplanation;
    dec.classList.remove('hidden');

    // Table
    renderTable(plan.rankedZones);

    // Remaining resources
    renderRemaining(plan.remainingResources);

    // Utilization bars
    renderUtilization(plan.resources, plan.remainingResources);

    // Show export button
    $('btn-export').classList.remove('hidden');
  }

  // ── TOP PRIORITY INSIGHT ──────────────────────────────────────────────────
  function renderInsight(topZone) {
    const z = topZone.zone;
    const pct = (topZone.score * 100).toFixed(1);
    const badgeClass = 'badge-' + topZone.priority.toLowerCase();
    $('priority-insight-body').innerHTML = `
      <div class="insight-zone-name">${z.name}</div>
      <span class="insight-badge ${badgeClass}">${topZone.priority}</span>
      <div class="insight-score-bar"><div class="insight-score-fill" style="width:${pct}%"></div></div>
      <div style="font-family:'JetBrains Mono';font-size:0.85rem;font-weight:700;color:#fff">${pct}% priority score</div>
      <div class="insight-detail">${z.notes}</div>
      <div class="insight-stats">
        <div class="insight-stat"><div class="insight-stat-val">${z.population.toLocaleString()}</div><div class="insight-stat-key">Population</div></div>
        <div class="insight-stat"><div class="insight-stat-val">${z.vulnerablePeople.toLocaleString()}</div><div class="insight-stat-key">Vulnerable</div></div>
        <div class="insight-stat"><div class="insight-stat-val">${z.severity}/10</div><div class="insight-stat-key">Severity</div></div>
        <div class="insight-stat"><div class="insight-stat-val">${z.hospitalDistanceKm}km</div><div class="insight-stat-key">Hospital Dist</div></div>
      </div>`;
  }

  // ── ALLOCATION TABLE ──────────────────────────────────────────────────────
  function renderTable(zones) {
    const tbody = $('allocation-tbody');
    tbody.innerHTML = zones.map((rz, i) => {
      const z = rz.zone;
      const a = rz.allocation || {};
      const pct = (rz.score * 100).toFixed(1);
      const color = rz.priority === 'CRITICAL' ? '#ef4444' : rz.priority === 'HIGH' ? '#f97316' : rz.priority === 'MEDIUM' ? '#eab308' : '#22c55e';
      const badgeClass = 'badge-' + rz.priority.toLowerCase();
      const accessClass = z.roadAccess === 'blocked' ? 'access-blocked' : z.roadAccess === 'partial' ? 'access-partial' : 'access-open';
      return `<tr data-zone-idx="${i}" onclick="window.__openModal(${i})">
        <td><span class="rank-num ${i < 3 ? 'top' : ''}">${i + 1}</span></td>
        <td><span class="zone-name">${z.name}</span></td>
        <td><span class="zone-district">${z.district}</span></td>
        <td><span class="priority-badge ${badgeClass}">${rz.priority}</span></td>
        <td><div class="score-bar-wrap"><span class="score-cell" style="color:${color}">${pct}%</span><div class="score-bar"><div class="score-bar-fill" style="width:${pct}%;background:${color}"></div></div></div></td>
        <td>${z.population.toLocaleString()}</td>
        <td class="alloc-cell ${(a.foodKits||0)===0?'alloc-zero':''}">${a.foodKits || 0}</td>
        <td class="alloc-cell ${(a.waterUnits||0)===0?'alloc-zero':''}">${a.waterUnits || 0}</td>
        <td class="alloc-cell ${(a.medicalKits||0)===0?'alloc-zero':''}">${a.medicalKits || 0}</td>
        <td class="alloc-cell ${(a.rescueTeams||0)===0?'alloc-zero':''}">${a.rescueTeams || 0}</td>
        <td class="alloc-cell ${(a.ambulances||0)===0?'alloc-zero':''}">${a.ambulances || 0}</td>
        <td><span class="access-badge ${accessClass}">${z.roadAccess}</span></td>
      </tr>`;
    }).join('');
  }

  // ── REMAINING RESOURCES ───────────────────────────────────────────────────
  function renderRemaining(rem) {
    $('rem-food').textContent = '🍱 ' + rem.foodKits;
    $('rem-water').textContent = '💧 ' + rem.waterUnits;
    $('rem-medical').textContent = '🏥 ' + rem.medicalKits;
    $('rem-rescue').textContent = '🚒 ' + rem.rescueTeams;
    $('rem-ambulance').textContent = '🚑 ' + rem.ambulances;
    $('remaining-bar').classList.remove('hidden');
  }

  // ── UTILIZATION BARS ──────────────────────────────────────────────────────
  function renderUtilization(total, remaining) {
    const items = [
      ['food', total.foodKits, remaining.foodKits],
      ['water', total.waterUnits, remaining.waterUnits],
      ['medical', total.medicalKits, remaining.medicalKits],
      ['rescue', total.rescueTeams, remaining.rescueTeams],
      ['ambulance', total.ambulances, remaining.ambulances]
    ];
    items.forEach(([key, t, r]) => {
      const used = t - r;
      const pct = t > 0 ? ((used / t) * 100).toFixed(0) : 0;
      $('util-' + key).style.width = pct + '%';
      $('util-' + key + '-num').textContent = `${used} / ${t} (${pct}%)`;
    });
    $('utilization-section').classList.add('visible');
  }

  // ── ZONE DETAIL MODAL ─────────────────────────────────────────────────────
  window.__openModal = function (idx) {
    if (!currentPlan) return;
    openZoneModal(currentPlan.rankedZones[idx]);
  };

  function openZoneModal(zoneData) {
    const z = zoneData.zone;
    const a = zoneData.allocation || {};
    const sc = zoneData.scoreComponents || {};
    const pct = zoneData.score ? (zoneData.score * 100).toFixed(1) : '—';
    const color = (zoneData.priority === 'CRITICAL') ? '#ef4444' : (zoneData.priority === 'HIGH') ? '#f97316' : (zoneData.priority === 'MEDIUM') ? '#eab308' : '#22c55e';

    // Build score breakdown rows
    const components = [
      ['Severity', sc.severity, 0.27],
      ['Population Pressure', sc.populationPressure, 0.15],
      ['Vulnerability', sc.vulnerabilityShare, 0.16],
      ['Access Difficulty', sc.accessDifficulty, 0.14],
      ['Medical Urgency', sc.medicalUrgency, 0.11],
      ['Incident Reports', sc.incidentReports, 0.08],
      ['Shelter Gap', sc.shelterGap, 0.05],
      ['Weather Risk', sc.weatherRisk, 0.04]
    ];
    const breakdownHTML = components.map(([label, val, maxW]) => {
      const barPct = val !== undefined ? ((val / maxW) * 100).toFixed(0) : 0;
      const display = val !== undefined ? val.toFixed(4) : '—';
      return `<div class="sb-row"><span class="sb-label">${label}</span><div class="sb-bar"><div class="sb-fill" style="width:${Math.min(barPct, 100)}%"></div></div><span class="sb-val">${display}</span></div>`;
    }).join('');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <span class="modal-title" style="color:${color}">📍 ${z.name}</span>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="modal-grid">
            <div class="modal-stat"><div class="modal-stat-val">${z.population.toLocaleString()}</div><div class="modal-stat-key">Population</div></div>
            <div class="modal-stat"><div class="modal-stat-val">${z.vulnerablePeople.toLocaleString()}</div><div class="modal-stat-key">Vulnerable People</div></div>
            <div class="modal-stat"><div class="modal-stat-val" style="color:${color}">${z.severity}/10</div><div class="modal-stat-key">Severity</div></div>
            <div class="modal-stat"><div class="modal-stat-val">${pct}%</div><div class="modal-stat-key">Priority Score</div></div>
            <div class="modal-stat"><div class="modal-stat-val">${z.hospitalDistanceKm} km</div><div class="modal-stat-key">Hospital Distance</div></div>
            <div class="modal-stat"><div class="modal-stat-val">${z.shelterCapacity}</div><div class="modal-stat-key">Shelter Capacity</div></div>
            <div class="modal-stat"><div class="modal-stat-val">${z.blockedRoads}</div><div class="modal-stat-key">Blocked Roads</div></div>
            <div class="modal-stat"><div class="modal-stat-val">${z.incidentReports}</div><div class="modal-stat-key">Incident Reports</div></div>
          </div>
          ${a.foodKits !== undefined ? `
          <div class="modal-section-title">Resource Allocation</div>
          <div class="modal-grid">
            <div class="modal-stat"><div class="modal-stat-val">${a.foodKits || 0}</div><div class="modal-stat-key">🍱 Food Kits</div></div>
            <div class="modal-stat"><div class="modal-stat-val">${a.waterUnits || 0}</div><div class="modal-stat-key">💧 Water Units</div></div>
            <div class="modal-stat"><div class="modal-stat-val">${a.medicalKits || 0}</div><div class="modal-stat-key">🏥 Medical Kits</div></div>
            <div class="modal-stat"><div class="modal-stat-val">${a.rescueTeams || 0}</div><div class="modal-stat-key">🚒 Rescue Teams</div></div>
            <div class="modal-stat"><div class="modal-stat-val">${a.ambulances || 0}</div><div class="modal-stat-key">🚑 Ambulances</div></div>
          </div>` : ''}
          <div class="modal-section-title">Score Breakdown</div>
          <div class="score-breakdown">${breakdownHTML}</div>
          <div class="modal-section-title">Notes</div>
          <div class="notes-box">${z.notes || 'No additional notes.'}</div>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  // ── LIVE EVENT FEED ───────────────────────────────────────────────────────
  const FEED_EVENTS = [
    { color: 'red', text: 'Severe flooding reported at Riverside Delta — water level rising' },
    { color: 'orange', text: 'Road blocked on NH-45 near Old Fisherman Port' },
    { color: 'yellow', text: '15 evacuees arrived at Central Shelter A' },
    { color: 'blue', text: 'Rescue Team Alpha deployed to Hillcrest Valley' },
    { color: 'green', text: 'Power restored to Market Square district' },
    { color: 'red', text: 'Building structural damage reported at Port district' },
    { color: 'orange', text: 'Medical supplies running low at Midtown Camp' },
    { color: 'yellow', text: 'Weather alert: Heavy rain expected in next 2 hours' },
    { color: 'blue', text: 'Ambulance #3 dispatched to Northern Farmlands' },
    { color: 'green', text: 'Evacuation complete for Tech Park Suburb residents' },
    { color: 'red', text: 'Gas leak detected near Industrial Docklands' },
    { color: 'orange', text: 'Shelter B approaching maximum capacity (85%)' },
    { color: 'yellow', text: 'Communication lines restored in Northern Hills' },
    { color: 'blue', text: 'Water purification units deployed to contaminated zones' },
    { color: 'green', text: 'Search and rescue complete at collapsed building site' }
  ];
  let feedIdx = 0;

  function startLiveFeed() {
    $('live-feed-list').innerHTML = '';
    addFeedItem('blue', 'CrisisIQ system initialized — monitoring active');
    setInterval(() => {
      const evt = FEED_EVENTS[feedIdx % FEED_EVENTS.length];
      addFeedItem(evt.color, evt.text);
      feedIdx++;
    }, 6000);
  }

  function addFeedItem(color, text) {
    const list = $('live-feed-list');
    const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    const item = document.createElement('div');
    item.className = 'feed-item';
    item.innerHTML = `<span class="feed-dot ${color}"></span><span class="feed-text">${text}</span><span class="feed-time">${time}</span>`;
    list.insertBefore(item, list.firstChild);
    if (list.children.length > 20) list.removeChild(list.lastChild);
  }

  // ── SCENARIO MODE ─────────────────────────────────────────────────────────
  const SCENARIO_STEPS = [
    { time: 'T+0:00', text: '🌀 Hurricane Atlas warning issued — Category 3', severityMod: {} },
    { time: 'T+0:30', text: '🌊 First flooding reports from Riverside Delta', severityMod: { 'Z001': 10 } },
    { time: 'T+1:00', text: '🏚️ Building collapse at Old Fisherman Port!', severityMod: { 'Z004': 10, 'Z001': 10 } },
    { time: 'T+1:30', text: '🚧 3 major roads blocked by debris', severityMod: { 'Z002': 9, 'Z004': 10, 'Z001': 10 } },
    { time: 'T+2:00', text: '⚠️ Shelter A at capacity — overflow crisis', severityMod: { 'Z006': 9, 'Z002': 9, 'Z004': 10, 'Z001': 10 } },
    { time: 'T+2:30', text: '☢️ Gas leak near Industrial Docklands', severityMod: { 'Z008': 8, 'Z006': 9, 'Z002': 9, 'Z004': 10, 'Z001': 10 } },
    { time: 'T+3:00', text: '📉 Situation stabilizing — resources deployed', severityMod: {} }
  ];
  let scenarioStep = 0;
  let scenarioRunning = false;

  function toggleScenario() {
    if (scenarioRunning) { stopScenario(); return; }
    scenarioRunning = true;
    scenarioStep = 0;
    $('btn-demo-scenario').textContent = '⏸ Running...';
    $('btn-demo-scenario').classList.add('running');
    $('scenario-banner').classList.add('visible');
    runScenarioStep();
  }

  function runScenarioStep() {
    if (!scenarioRunning || scenarioStep >= SCENARIO_STEPS.length) {
      stopScenario();
      return;
    }
    const step = SCENARIO_STEPS[scenarioStep];
    $('scenario-text').textContent = `🌀 ${step.time} — ${step.text}`;
    $('scenario-progress-fill').style.width = ((scenarioStep + 1) / SCENARIO_STEPS.length * 100) + '%';
    addFeedItem('red', `[SCENARIO] ${step.text}`);

    // Auto-generate plan at each step
    generatePlan();

    scenarioStep++;
    scenarioTimer = setTimeout(runScenarioStep, 5000);
  }

  function stopScenario() {
    scenarioRunning = false;
    clearTimeout(scenarioTimer);
    $('btn-demo-scenario').textContent = '▶ Run Scenario';
    $('btn-demo-scenario').classList.remove('running');
    $('scenario-banner').classList.remove('visible');
  }

  // ── EXPORT ────────────────────────────────────────────────────────────────
  function exportPlan() {
    if (!currentPlan) return;
    const blob = new Blob([JSON.stringify(currentPlan, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crisisiq-plan-${new Date().toISOString().slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addFeedItem('green', 'Plan exported as JSON');
  }

})();
