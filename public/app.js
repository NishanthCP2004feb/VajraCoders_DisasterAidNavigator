const state = {
  map: null,
  markers: [],
  routeLines: [],
  hubMarker: null,
  plan: null,
  strategy: "balanced"
};

const el = (id) => document.getElementById(id);

const riskColors = {
  Critical: "#dc2626",
  High: "#d97706",
  Moderate: "#2563eb",
  Watch: "#15803d"
};

function formatNumber(value) {
  return new Intl.NumberFormat("en-IN").format(Number(value || 0));
}

function formatTime(iso) {
  if (!iso) return "--";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(iso));
}

function getResourceInputs() {
  return {
    foodKits: Number(el("foodKits").value || 0),
    waterUnits: Number(el("waterUnits").value || 0),
    medicalKits: Number(el("medicalKits").value || 0),
    rescueTeams: Number(el("rescueTeams").value || 0),
    ambulances: Number(el("ambulances").value || 0)
  };
}

function metricLabel(key) {
  return {
    severity: "Severity",
    population: "Population",
    vulnerability: "Vulnerability",
    accessDifficulty: "Access",
    medicalUrgency: "Medical",
    reports: "Reports",
    shelterGap: "Shelter",
    weather: "Weather"
  }[key] || key;
}

function markerIcon(level) {
  const color = riskColors[level] || "#66737d";
  return L.divIcon({
    className: "impact-marker",
    html: `<span style="background:${color};border:3px solid #fff;box-shadow:0 8px 20px rgba(0,0,0,.22);width:22px;height:22px;border-radius:50%;display:block;"></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });
}

function initMap(plan) {
  if (!window.L) {
    el("mapFallback").hidden = false;
    return;
  }

  if (!state.map) {
    state.map = L.map("map", {
      zoomControl: true,
      scrollWheelZoom: true
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(state.map);
  }

  renderMap(plan);
}

function renderMap(plan) {
  if (!state.map || !window.L) return;

  state.markers.forEach((marker) => marker.remove());
  state.routeLines.forEach((line) => line.remove());
  state.markers = [];
  state.routeLines = [];

  if (state.hubMarker) {
    state.hubMarker.remove();
  }

  const hub = plan.reliefHub;
  state.hubMarker = L.circleMarker([hub.latitude, hub.longitude], {
    radius: 9,
    color: "#0f766e",
    weight: 3,
    fillColor: "#99f6e4",
    fillOpacity: 1
  })
    .bindPopup(`<strong>${hub.name}</strong><br>Relief dispatch hub`)
    .addTo(state.map);

  const bounds = [[hub.latitude, hub.longitude]];

  plan.zones.forEach((zone) => {
    const marker = L.marker([zone.latitude, zone.longitude], {
      icon: markerIcon(zone.level),
      title: zone.name
    })
      .bindPopup(`
        <span class="popup-title">#${zone.rank} ${zone.name}</span>
        <div class="popup-grid">
          <span>Score</span><strong>${zone.score}</strong>
          <span>Risk</span><strong>${zone.level}</strong>
          <span>Food</span><strong>${formatNumber(zone.allocation.foodKits)}</strong>
          <span>Medical</span><strong>${formatNumber(zone.allocation.medicalKits)}</strong>
        </div>
      `)
      .addTo(state.map);

    state.markers.push(marker);
    bounds.push([zone.latitude, zone.longitude]);

    if (zone.rank <= 4) {
      const route = L.polyline(
        [
          [hub.latitude, hub.longitude],
          [zone.latitude, zone.longitude]
        ],
        {
          color: riskColors[zone.level] || "#66737d",
          weight: 3,
          opacity: 0.5,
          dashArray: zone.rank === 1 ? "" : "6 8"
        }
      ).addTo(state.map);
      state.routeLines.push(route);
    }
  });

  state.map.fitBounds(bounds, {
    padding: [38, 38]
  });
}

function riskBadge(level) {
  return `<span class="risk-badge risk-${level}">${level}</span>`;
}

function renderMetrics(plan) {
  el("affectedMetric").textContent = formatNumber(plan.totals.population);
  el("criticalMetric").textContent = formatNumber(plan.totals.criticalZones);
  el("weatherMetric").textContent = `${Math.round(plan.weather.riskScore)} / 100`;
  el("eventMetric").textContent = formatNumber(plan.earthquake.count);
  el("fairnessMetric").textContent = plan.fairnessAudit.status;
  el("unmetMetric").textContent = formatNumber(
    plan.zones.filter((zone) => zone.unmetRiskLevel === "Critical" || zone.unmetRiskLevel === "High").length
  );
  el("generatedAt").textContent = `Generated ${formatTime(plan.generatedAt)}`;
}

function renderTopZone(plan) {
  const top = plan.zones[0];
  if (!top) return;

  el("topZoneName").textContent = top.name;
  el("topZoneLevel").textContent = top.level;
  el("topZoneLevel").className = `risk-badge risk-${top.level}`;
  el("topZoneReasons").innerHTML = top.reasoning.map((reason) => `<span>${reason}</span>`).join("");
  el("topFood").textContent = formatNumber(top.allocation.foodKits);
  el("topWater").textContent = formatNumber(top.allocation.waterUnits);
  el("topMedical").textContent = formatNumber(top.allocation.medicalKits);
  el("topTeams").textContent = formatNumber(top.allocation.rescueTeams);
  el("scoreBreakdown").innerHTML = Object.entries(top.components)
    .map(([key, value]) => {
      const weight = plan.strategy.weights[key] || 0;
      return `
        <div class="score-row">
          <span>${metricLabel(key)}</span>
          <div class="score-track"><i style="width:${Math.round(value)}%"></i></div>
          <strong>${Math.round(value)} <small>x ${Math.round(weight * 100)}%</small></strong>
        </div>
      `;
    })
    .join("");
}

function renderSignalSummary(plan) {
  const event = plan.earthquake.events && plan.earthquake.events[0];
  const weather = plan.weather;
  const eventText = event ? `${event.title} (${plan.earthquake.source})` : `No significant weekly events (${plan.earthquake.source})`;
  el("signalSummary").textContent = `${weather.source}: ${weather.precipitationMm} mm precipitation, ${weather.windSpeedKmh} km/h wind, ${weather.temperatureC} C. ${eventText}.`;
  el("dataStatus").textContent = `${weather.source} + ${plan.earthquake.source}`;
}

function renderTable(plan) {
  el("planRows").innerHTML = plan.zones
    .map(
      (zone) => `
      <tr>
        <td><strong>#${zone.rank}</strong></td>
        <td>
          <span class="zone-name">${zone.name}</span>
          <span class="subtext">${zone.district} | ${zone.distanceFromHubKm} km from hub</span>
        </td>
        <td class="score-cell">${zone.score}</td>
        <td>${riskBadge(zone.level)}</td>
        <td>${formatNumber(zone.allocation.foodKits)}</td>
        <td>${formatNumber(zone.allocation.waterUnits)}</td>
        <td>${formatNumber(zone.allocation.medicalKits)}</td>
        <td>${formatNumber(zone.allocation.rescueTeams)}</td>
        <td>${formatNumber(zone.allocation.ambulances)}</td>
        <td>
          <span class="unmet-pill unmet-${zone.unmetRiskLevel}">${zone.unmetRiskLevel}</span>
          <span class="subtext">${zone.coverageAverage}% average coverage</span>
        </td>
        <td class="reason-cell">${zone.reasoning.join(", ")}</td>
      </tr>
    `
    )
    .join("");
}

function renderFairnessAudit(plan) {
  const audit = plan.fairnessAudit;
  el("fairnessStatus").textContent = audit.status;
  el("fairnessStatus").className = `mini-status ${audit.status === "Passing" ? "status-good" : "status-warn"}`;
  el("fairnessAudit").innerHTML = `
    <div class="audit-row">
      <span>Vulnerable population</span>
      <strong>${audit.vulnerablePopulationShare}%</strong>
    </div>
    <div class="audit-row">
      <span>High-vulnerability zone support</span>
      <strong>${audit.highVulnerabilitySupportShare}%</strong>
    </div>
    <div class="audit-row">
      <span>High-vulnerability zones</span>
      <strong>${audit.highVulnerabilityZoneCount}</strong>
    </div>
    ${
      audit.lowestCoveredVulnerableZone
        ? `<div class="audit-row">
            <span>Lowest covered vulnerable zone</span>
            <strong>${audit.lowestCoveredVulnerableZone.name}</strong>
          </div>`
        : ""
    }
    ${audit.recommendations.map((item) => `<p class="recommendation">${item}</p>`).join("")}
  `;
}

function renderBottlenecks(plan) {
  const bottlenecks = plan.bottlenecks;
  el("bottleneckList").innerHTML = `
    <p class="recommendation">${bottlenecks.recommendation}</p>
    ${bottlenecks.hotspots
      .map(
        (item) => `
        <div class="audit-row">
          <span>${item.zoneName}</span>
          <strong>${item.unmetRiskLevel} | ${item.biggestGap}</strong>
        </div>
      `
      )
      .join("")}
  `;
}

function renderMissions(plan) {
  el("missionCards").innerHTML = plan.missions
    .map(
      (mission) => `
      <article class="mission-card">
        <div class="mission-topline">
          <strong>#${mission.dispatchOrder} ${mission.zoneName}</strong>
          <span class="risk-badge risk-${mission.level}">${mission.level}</span>
        </div>
        <p>${mission.objective}</p>
        <div class="mission-meta">
          <span>${mission.routeKm} km route</span>
          <span>${mission.etaMinutes} min ETA</span>
        </div>
        <div class="mission-resources">
          <span>Food ${formatNumber(mission.resources.foodKits)}</span>
          <span>Water ${formatNumber(mission.resources.waterUnits)}</span>
          <span>Medical ${formatNumber(mission.resources.medicalKits)}</span>
          <span>Teams ${formatNumber(mission.resources.rescueTeams)}</span>
        </div>
      </article>
    `
    )
    .join("");
}

function renderScenarios(plan) {
  el("scenarioRows").innerHTML = plan.scenarios
    .map(
      (scenario) => `
      <div class="scenario-row">
        <div>
          <strong>${scenario.name}</strong>
          <span>Top: ${scenario.topZone}</span>
        </div>
        <div>
          <strong>${scenario.averageCoverage}%</strong>
          <span>Avg. coverage</span>
        </div>
        <div>
          <strong>${scenario.highUnmetZones}</strong>
          <span>High unmet</span>
        </div>
      </div>
    `
    )
    .join("");
}

function renderAdvanced(plan) {
  renderFairnessAudit(plan);
  renderBottlenecks(plan);
  renderMissions(plan);
  renderScenarios(plan);
}

function syncInputs(plan) {
  Object.entries(plan.resources).forEach(([key, value]) => {
    if (el(key)) el(key).value = value;
  });
}

async function loadPlan() {
  el("dataStatus").textContent = "Generating plan";
  el("generateBtn").disabled = true;
  el("refreshBtn").disabled = true;

  try {
    const response = await fetch("/api/plan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        resources: getResourceInputs(),
        strategy: state.strategy
      })
    });

    if (!response.ok) {
      throw new Error(`Plan request failed with ${response.status}`);
    }

    const plan = await response.json();
    state.plan = plan;
    syncInputs(plan);
    renderMetrics(plan);
    renderTopZone(plan);
    renderSignalSummary(plan);
    renderTable(plan);
    renderAdvanced(plan);
    initMap(plan);
  } catch (error) {
    console.error(error);
    el("dataStatus").textContent = "Plan unavailable";
    el("signalSummary").textContent = "The server could not generate a plan. Check the local console or Render logs.";
  } finally {
    el("generateBtn").disabled = false;
    el("refreshBtn").disabled = false;
  }
}

function setStrategy(strategy) {
  state.strategy = strategy;
  document.querySelectorAll(".strategy-option").forEach((button) => {
    button.classList.toggle("active", button.dataset.strategy === strategy);
  });
  loadPlan();
}

function downloadReport() {
  if (!state.plan) return;

  const report = {
    project: "DisasterAid Navigator",
    generatedAt: state.plan.generatedAt,
    strategy: state.plan.strategy,
    summary: state.plan.totals,
    fairnessAudit: state.plan.fairnessAudit,
    bottlenecks: state.plan.bottlenecks,
    missions: state.plan.missions,
    rankedZones: state.plan.zones.map((zone) => ({
      rank: zone.rank,
      name: zone.name,
      score: zone.score,
      level: zone.level,
      allocation: zone.allocation,
      unmetRiskLevel: zone.unmetRiskLevel,
      reasoning: zone.reasoning
    }))
  };

  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `disasteraid-situation-report-${Date.now()}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

document.addEventListener("DOMContentLoaded", () => {
  el("generateBtn").addEventListener("click", loadPlan);
  el("refreshBtn").addEventListener("click", loadPlan);
  el("downloadReportBtn").addEventListener("click", downloadReport);
  document.querySelectorAll(".strategy-option").forEach((button) => {
    button.addEventListener("click", () => setStrategy(button.dataset.strategy));
  });
  loadPlan();
});
