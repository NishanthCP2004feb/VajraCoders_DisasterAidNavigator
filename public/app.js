const state = {
  map: null,
  markers: [],
  routeLines: [],
  hubMarker: null,
  plan: null,
  strategy: "balanced",
  reportHistory: JSON.parse(localStorage.getItem("citizenReports") || "[]")
};

const root = document.getElementById("pageRoot");
const el = (id) => document.getElementById(id);

const riskColors = {
  Critical: "#dc2626",
  High: "#d97706",
  Moderate: "#2563eb",
  Watch: "#15803d"
};

const features = [
  {
    id: "operations",
    path: "/features/operations",
    icon: "map",
    title: "Operations Map",
    summary: "Live ranking, relief routes, resource controls, and allocation table."
  },
  {
    id: "command-council",
    path: "/features/command-council",
    icon: "brain-circuit",
    title: "AI Command Council",
    summary: "Medical, logistics, equity, and risk agents vote on priorities."
  },
  {
    id: "simulation",
    path: "/features/simulation",
    icon: "activity",
    title: "6 Hour Simulation",
    summary: "Projects severity, road access, medical pressure, and shelter stress."
  },
  {
    id: "counterfactuals",
    path: "/features/counterfactuals",
    icon: "git-compare-arrows",
    title: "Counterfactual Lab",
    summary: "Explains what would change the top-ranked disaster zone."
  },
  {
    id: "optimizer",
    path: "/features/optimizer",
    icon: "shuffle",
    title: "Reallocation Optimizer",
    summary: "Suggests controlled transfers to reduce high unmet-risk zones."
  },
  {
    id: "citizen-reports",
    path: "/features/citizen-reports",
    icon: "message-square-warning",
    title: "Citizen Report AI",
    summary: "Classifies field reports, estimates credibility, and recommends action."
  },
  {
    id: "cascade-graph",
    path: "/features/cascade-graph",
    icon: "share-2",
    title: "Cascading Risk Graph",
    summary: "Shows spillover, route pressure, and evacuation dependencies."
  },
  {
    id: "evacuation",
    path: "/features/evacuation",
    icon: "route",
    title: "Evacuation Engine",
    summary: "Matches overflow populations to accessible shelter capacity."
  },
  {
    id: "command-report",
    path: "/features/command-report",
    icon: "file-down",
    title: "Command Report",
    summary: "Exports a complete situation report for judges or responders."
  }
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

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

function currentPath() {
  return window.location.pathname.replace(/\/$/, "") || "/";
}

function renderIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function destroyMap() {
  if (state.map) {
    state.map.remove();
    state.map = null;
  }
  state.markers = [];
  state.routeLines = [];
  state.hubMarker = null;
}

function getResourceInputs() {
  return {
    foodKits: Number(el("foodKits")?.value || state.plan?.resources.foodKits || 0),
    waterUnits: Number(el("waterUnits")?.value || state.plan?.resources.waterUnits || 0),
    medicalKits: Number(el("medicalKits")?.value || state.plan?.resources.medicalKits || 0),
    rescueTeams: Number(el("rescueTeams")?.value || state.plan?.resources.rescueTeams || 0),
    ambulances: Number(el("ambulances")?.value || state.plan?.resources.ambulances || 0)
  };
}

function riskBadge(level) {
  return `<span class="risk-badge risk-${escapeHtml(level)}">${escapeHtml(level)}</span>`;
}

function unmetBadge(level) {
  return `<span class="unmet-pill unmet-${escapeHtml(level)}">${escapeHtml(level)}</span>`;
}

function pageHeader(title, kicker, actions = "") {
  return `
    <section class="page-heading">
      <div>
        <p class="eyebrow">${escapeHtml(kicker)}</p>
        <h1>${escapeHtml(title)}</h1>
      </div>
      <div class="page-actions">${actions}</div>
    </section>
  `;
}

function resourceControls() {
  const resources = state.plan?.resources || {};
  return `
    <section class="control-band" aria-label="Resource controls">
      ${[
        ["foodKits", "Food kits", 50],
        ["waterUnits", "Water units", 50],
        ["medicalKits", "Medical kits", 25],
        ["rescueTeams", "Rescue teams", 1],
        ["ambulances", "Ambulances", 1]
      ]
        .map(
          ([id, label, step]) => `
            <label>
              <span>${label}</span>
              <input id="${id}" type="number" min="0" step="${step}" value="${resources[id] || 0}">
            </label>
          `
        )
        .join("")}
      <button id="generateBtn" class="primary-button" type="button">
        <i data-lucide="calculator"></i>
        Generate plan
      </button>
    </section>
  `;
}

function strategyControls() {
  return `
    <section class="strategy-band" aria-label="Decision strategy">
      <div>
        <p class="eyebrow">Decision strategy</p>
        <div class="segmented-control" role="group" aria-label="Decision strategy">
          ${["balanced", "equity", "speed"]
            .map(
              (strategy) => `
                <button class="strategy-option ${state.strategy === strategy ? "active" : ""}" type="button" data-strategy="${strategy}">
                  ${strategy[0].toUpperCase() + strategy.slice(1)}
                </button>
              `
            )
            .join("")}
        </div>
      </div>
      <p class="strategy-summary">${escapeHtml(state.plan?.strategy.summary || "Choose how the command system should weigh competing goals.")}</p>
    </section>
  `;
}

function metricsGrid(plan) {
  const highUnmet = plan.zones.filter((zone) => zone.unmetRiskLevel === "Critical" || zone.unmetRiskLevel === "High").length;
  return `
    <section class="metrics-grid" aria-label="Plan summary">
      ${[
        ["Affected people", formatNumber(plan.totals.population)],
        ["Critical zones", formatNumber(plan.totals.criticalZones)],
        ["Weather risk", `${Math.round(plan.weather.riskScore)} / 100`],
        ["Live events", formatNumber(plan.earthquake.count)],
        ["Fairness guardrail", plan.fairnessAudit.status],
        ["High unmet zones", formatNumber(highUnmet)]
      ]
        .map(
          ([label, value]) => `
            <article class="metric-tile">
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(value)}</strong>
            </article>
          `
        )
        .join("")}
    </section>
  `;
}

function renderDashboard(plan) {
  root.innerHTML = `
    ${pageHeader("Command Dashboard", "Feature launchpad")}
    ${metricsGrid(plan)}
    <section class="feature-grid" aria-label="Feature dashboard">
      ${features
        .map(
          (feature) => `
            <a class="feature-card" href="${feature.path}" data-route>
              <span class="feature-icon"><i data-lucide="${feature.icon}"></i></span>
              <strong>${escapeHtml(feature.title)}</strong>
              <span>${escapeHtml(feature.summary)}</span>
            </a>
          `
        )
        .join("")}
    </section>
  `;
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
  if (!window.L || !el("map")) {
    if (el("mapFallback")) el("mapFallback").hidden = false;
    return;
  }

  state.map = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: true
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(state.map);

  const hub = plan.reliefHub;
  state.hubMarker = L.circleMarker([hub.latitude, hub.longitude], {
    radius: 9,
    color: "#0f766e",
    weight: 3,
    fillColor: "#99f6e4",
    fillOpacity: 1
  })
    .bindPopup(`<strong>${escapeHtml(hub.name)}</strong><br>Relief dispatch hub`)
    .addTo(state.map);

  const bounds = [[hub.latitude, hub.longitude]];
  plan.zones.forEach((zone) => {
    const marker = L.marker([zone.latitude, zone.longitude], {
      icon: markerIcon(zone.level),
      title: zone.name
    })
      .bindPopup(`
        <span class="popup-title">#${zone.rank} ${escapeHtml(zone.name)}</span>
        <div class="popup-grid">
          <span>Score</span><strong>${zone.score}</strong>
          <span>Risk</span><strong>${escapeHtml(zone.level)}</strong>
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

  state.map.fitBounds(bounds, { padding: [38, 38] });
}

function renderOperations(plan) {
  const top = plan.zones[0];
  root.innerHTML = `
    ${pageHeader("Operations Map", "Live allocation control", `<button id="downloadReportBtn" class="secondary-button" type="button"><i data-lucide="file-down"></i> Export</button>`)}
    ${resourceControls()}
    ${strategyControls()}
    ${metricsGrid(plan)}
    <section class="workspace-grid">
      <div class="map-panel">
        <div id="map" class="map-canvas" role="img" aria-label="Disaster impact map"></div>
        <div id="mapFallback" class="map-fallback" hidden>Map library unavailable. The ranked table is still active.</div>
      </div>
      <aside class="insight-panel" aria-label="Decision insights">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Current top priority</p>
            <h2>${escapeHtml(top.name)}</h2>
          </div>
          ${riskBadge(top.level)}
        </div>
        <div class="reason-list">${top.reasoning.map((reason) => `<span>${escapeHtml(reason)}</span>`).join("")}</div>
        <div class="allocation-strip">
          <div><span>Food</span><strong>${formatNumber(top.allocation.foodKits)}</strong></div>
          <div><span>Water</span><strong>${formatNumber(top.allocation.waterUnits)}</strong></div>
          <div><span>Medical</span><strong>${formatNumber(top.allocation.medicalKits)}</strong></div>
          <div><span>Teams</span><strong>${formatNumber(top.allocation.rescueTeams)}</strong></div>
        </div>
        <div class="signal-box">
          <h3>Live signal layer</h3>
          <p>${escapeHtml(plan.weather.source)}: ${plan.weather.precipitationMm} mm precipitation, ${plan.weather.windSpeedKmh} km/h wind, ${plan.weather.temperatureC} C. ${escapeHtml(plan.earthquake.source)} reports ${formatNumber(plan.earthquake.count)} significant weekly events.</p>
        </div>
      </aside>
    </section>
    ${rankedTable(plan)}
  `;
  initMap(plan);
}

function rankedTable(plan) {
  return `
    <section class="table-section" aria-label="Ranked allocation plan">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Decision output</p>
          <h2>Relief priority and allocation plan</h2>
        </div>
        <span class="timestamp">Generated ${formatTime(plan.generatedAt)}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Zone</th>
              <th>Score</th>
              <th>Risk</th>
              <th>Food</th>
              <th>Water</th>
              <th>Medical</th>
              <th>Teams</th>
              <th>Amb.</th>
              <th>Unmet</th>
              <th>Decision reason</th>
            </tr>
          </thead>
          <tbody>
            ${plan.zones
              .map(
                (zone) => `
                <tr>
                  <td><strong>#${zone.rank}</strong></td>
                  <td>
                    <span class="zone-name">${escapeHtml(zone.name)}</span>
                    <span class="subtext">${escapeHtml(zone.district)} | ${zone.distanceFromHubKm} km from hub</span>
                  </td>
                  <td class="score-cell">${zone.score}</td>
                  <td>${riskBadge(zone.level)}</td>
                  <td>${formatNumber(zone.allocation.foodKits)}</td>
                  <td>${formatNumber(zone.allocation.waterUnits)}</td>
                  <td>${formatNumber(zone.allocation.medicalKits)}</td>
                  <td>${formatNumber(zone.allocation.rescueTeams)}</td>
                  <td>${formatNumber(zone.allocation.ambulances)}</td>
                  <td>${unmetBadge(zone.unmetRiskLevel)}<span class="subtext">${zone.coverageAverage}% coverage</span></td>
                  <td class="reason-cell">${zone.reasoning.map(escapeHtml).join(", ")}</td>
                </tr>
              `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderCommandCouncil(plan) {
  const council = plan.commandCouncil;
  root.innerHTML = `
    ${pageHeader("AI Command Council", "Multi-agent decision debate")}
    <section class="council-summary">
      <article class="metric-tile"><span>Consensus leader</span><strong>${escapeHtml(council.consensusLeader)}</strong></article>
      <article class="metric-tile"><span>Agreement level</span><strong>${escapeHtml(council.agreementLevel)}</strong></article>
      <article class="metric-tile"><span>Agents</span><strong>${council.agents.length}</strong></article>
    </section>
    <section class="agent-grid">
      ${council.agents
        .map(
          (agent) => `
          <article class="ops-panel">
            <div class="agent-title">
              <span class="feature-icon"><i data-lucide="${agent.icon}"></i></span>
              <div>
                <h2>${escapeHtml(agent.name)}</h2>
                <p>${escapeHtml(agent.focus)}</p>
              </div>
            </div>
            <ol class="ranking-list">
              ${agent.ranking
                .map((item) => `<li><span>#${item.rank} ${escapeHtml(item.zoneName)}</span><strong>${item.score}</strong></li>`)
                .join("")}
            </ol>
          </article>
        `
        )
        .join("")}
    </section>
    <section class="advanced-grid two">
      <article class="ops-panel">
        <p class="eyebrow">Consensus ranking</p>
        <div class="stack-list">
          ${council.consensus
            .map(
              (item) => `
              <div class="audit-row">
                <span>${escapeHtml(item.zoneName)}</span>
                <strong>Avg rank ${item.averageAgentRank}</strong>
              </div>
            `
            )
            .join("")}
        </div>
      </article>
      <article class="ops-panel">
        <p class="eyebrow">Agent debate</p>
        <div class="stack-list">${council.debate.map((line) => `<p class="recommendation">${escapeHtml(line)}</p>`).join("")}</div>
      </article>
    </section>
  `;
}

function renderSimulation(plan) {
  const sim = plan.simulation;
  root.innerHTML = `
    ${pageHeader("Next 6 Hours Simulation", "Disaster evolution forecast")}
    <section class="curve-panel">
      ${sim.systemRiskCurve
        .map(
          (point) => `
          <div class="curve-point">
            <span>+${point.hour}h</span>
            <strong>${point.averageRisk}</strong>
            <div class="score-track"><i style="width:${point.averageRisk}%"></i></div>
          </div>
        `
        )
        .join("")}
    </section>
    <section class="simulation-grid">
      ${sim.zones
        .map(
          (zone) => `
          <article class="ops-panel">
            <div class="panel-heading compact">
              <div>
                <p class="eyebrow">${escapeHtml(zone.currentLevel)}</p>
                <h2>${escapeHtml(zone.zoneName)}</h2>
              </div>
            </div>
            <div class="timeline">
              ${zone.timeline
                .map(
                  (item) => `
                  <div class="timeline-step">
                    <strong>+${item.hour}h</strong>
                    <span>${escapeHtml(item.status)}</span>
                    <small>Score ${item.projectedScore} | Road ${item.roadAccess}% | Medical ${item.medicalRisk}%</small>
                  </div>
                `
                )
                .join("")}
            </div>
          </article>
        `
        )
        .join("")}
    </section>
  `;
}

function renderCounterfactuals(plan) {
  const cf = plan.counterfactuals;
  root.innerHTML = `
    ${pageHeader("Counterfactual Lab", "Why this rank, what changes it")}
    <section class="ops-panel lead-panel">
      <p class="eyebrow">Current explanation</p>
      <h2>${escapeHtml(cf.target.zoneName)}</h2>
      <p>${escapeHtml(cf.target.explanation)}</p>
    </section>
    <section class="counter-grid">
      ${cf.rankFlipLevers
        .map(
          (item) => `
          <article class="ops-panel">
            <div class="panel-heading compact">
              <div>
                <p class="eyebrow">Rank #${item.currentRank} | gap ${item.margin}</p>
                <h2>${escapeHtml(item.zoneName)}</h2>
              </div>
            </div>
            <div class="stack-list">${item.actions.map((action) => `<p class="recommendation">${escapeHtml(action)}</p>`).join("")}</div>
          </article>
        `
        )
        .join("")}
    </section>
  `;
}

function renderOptimizer(plan) {
  const optimizer = plan.optimizer;
  root.innerHTML = `
    ${pageHeader("Resource Reallocation Optimizer", "Risk reduction through controlled transfers")}
    <section class="metrics-grid slim">
      <article class="metric-tile"><span>Before high unmet</span><strong>${optimizer.before.highUnmetZones}</strong></article>
      <article class="metric-tile"><span>After high unmet</span><strong>${optimizer.after.highUnmetZones}</strong></article>
      <article class="metric-tile"><span>Before coverage</span><strong>${optimizer.before.averageCoverage}%</strong></article>
      <article class="metric-tile"><span>After coverage</span><strong>${optimizer.after.averageCoverage}%</strong></article>
    </section>
    <section class="ops-panel">
      <p class="recommendation">${escapeHtml(optimizer.summary)} ${escapeHtml(optimizer.objective)}</p>
    </section>
    <section class="transfer-grid">
      ${optimizer.transfers.length
        ? optimizer.transfers
            .map(
              (transfer) => `
              <article class="ops-panel transfer-card">
                <span class="feature-icon"><i data-lucide="arrow-left-right"></i></span>
                <h2>${formatNumber(transfer.amount)} ${escapeHtml(transfer.resource)}</h2>
                <p><strong>${escapeHtml(transfer.fromZoneName)}</strong> to <strong>${escapeHtml(transfer.toZoneName)}</strong></p>
                <p>${escapeHtml(transfer.reason)}</p>
              </article>
            `
            )
            .join("")
        : `<article class="ops-panel"><p class="recommendation">No internal transfer is safe. Request supply surge for bottleneck resources.</p></article>`}
    </section>
  `;
}

function renderCitizenReports(plan) {
  const options = plan.zones.map((zone) => `<option value="${zone.id}">${escapeHtml(zone.name)}</option>`).join("");
  root.innerHTML = `
    ${pageHeader("Citizen Report Intelligence", "NLP-style field report triage")}
    <section class="report-layout">
      <form id="reportForm" class="ops-panel report-form">
        <label>
          <span>Zone</span>
          <select id="reportZone">
            <option value="">Auto-detect from text</option>
            ${options}
          </select>
        </label>
        <label>
          <span>Citizen report</span>
          <textarea id="reportText" rows="7" placeholder="Example: Water level rising near Creekside Nagar, 30 people trapped near the school."></textarea>
        </label>
        <button class="primary-button" type="submit"><i data-lucide="scan-text"></i> Analyze report</button>
      </form>
      <aside id="reportResult" class="ops-panel report-result">
        <p class="eyebrow">Analysis result</p>
        <p class="muted-text">Submit a field report to classify urgency, credibility, location, and suggested action.</p>
      </aside>
    </section>
    <section class="ops-panel">
      <p class="eyebrow">Recent analyzed reports</p>
      <div id="reportHistory" class="stack-list">${renderReportHistory()}</div>
    </section>
  `;
}

function renderReportHistory() {
  if (!state.reportHistory.length) {
    return `<p class="muted-text">No reports analyzed in this browser session.</p>`;
  }
  return state.reportHistory
    .slice(0, 6)
    .map(
      (report) => `
      <div class="audit-row">
        <span>${escapeHtml(report.classification)} | ${escapeHtml(report.zoneMatch?.name || "Unknown zone")}</span>
        <strong>${report.priorityImpact} impact</strong>
      </div>
    `
    )
    .join("");
}

function renderCascadeGraph(plan) {
  const graph = plan.cascadeGraph;
  const minX = Math.min(...graph.nodes.map((node) => node.x));
  const maxX = Math.max(...graph.nodes.map((node) => node.x));
  const minY = Math.min(...graph.nodes.map((node) => node.y));
  const maxY = Math.max(...graph.nodes.map((node) => node.y));
  const pos = (node) => ({
    x: 60 + ((node.x - minX) / Math.max(maxX - minX, 0.01)) * 680,
    y: 360 - ((node.y - minY) / Math.max(maxY - minY, 0.01)) * 300
  });
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));

  root.innerHTML = `
    ${pageHeader("Cascading Risk Graph", "Dependency and spillover intelligence")}
    <section class="ops-panel">
      <p class="recommendation">${escapeHtml(graph.insight)}</p>
      <svg class="risk-graph" viewBox="0 0 800 420" role="img" aria-label="Cascading risk graph">
        ${graph.edges
          .map((edge) => {
            const from = pos(nodeMap.get(edge.from));
            const to = pos(nodeMap.get(edge.to));
            return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" class="edge edge-${edge.type}" stroke-width="${Math.max(1.5, edge.strength / 28)}" />`;
          })
          .join("")}
        ${graph.nodes
          .map((node) => {
            const point = pos(node);
            return `
              <g class="graph-node graph-${node.role}">
                <circle cx="${point.x}" cy="${point.y}" r="${node.role === "risk-source" ? 16 : 12}" />
                <text x="${point.x}" y="${point.y + 30}" text-anchor="middle">${escapeHtml(node.name)}</text>
              </g>
            `;
          })
          .join("")}
      </svg>
    </section>
    <section class="edge-list">
      ${graph.edges
        .slice(0, 10)
        .map(
          (edge) => `
          <article class="ops-panel">
            <p class="eyebrow">${escapeHtml(edge.type)} | strength ${edge.strength}</p>
            <p>${escapeHtml(edge.reason)}</p>
          </article>
        `
        )
        .join("")}
    </section>
  `;
}

function renderEvacuation(plan) {
  const evacuation = plan.evacuationPlan;
  root.innerHTML = `
    ${pageHeader("Shelter Evacuation Engine", "Overflow routing and shelter capacity")}
    <section class="metrics-grid slim">
      <article class="metric-tile"><span>Planned evacuees</span><strong>${formatNumber(evacuation.totalEvacuees)}</strong></article>
      <article class="metric-tile"><span>Unassigned overflow</span><strong>${formatNumber(evacuation.unassignedOverflow)}</strong></article>
      <article class="metric-tile"><span>Movements</span><strong>${evacuation.movements.length}</strong></article>
      <article class="metric-tile"><span>Receiving shelters</span><strong>${evacuation.shelters.length}</strong></article>
    </section>
    <section class="evacuation-grid">
      <article class="ops-panel">
        <p class="eyebrow">Movement plan</p>
        <div class="stack-list">
          ${evacuation.movements.length
            ? evacuation.movements
                .map(
                  (move) => `
                  <div class="audit-row movement-row">
                    <span>${escapeHtml(move.fromZoneName)} to ${escapeHtml(move.toZoneName)}<small>${move.routeKm} km | ${escapeHtml(move.reason)}</small></span>
                    <strong>${formatNumber(move.people)}</strong>
                  </div>
                `
                )
                .join("")
            : `<p class="muted-text">No evacuation movement required under current data.</p>`}
        </div>
      </article>
      <article class="ops-panel">
        <p class="eyebrow">Shelter utilization</p>
        <div class="stack-list">
          ${evacuation.shelters
            .map(
              (shelter) => `
              <div>
                <div class="audit-row">
                  <span>${escapeHtml(shelter.zoneName)}</span>
                  <strong>${shelter.utilization}%</strong>
                </div>
                <div class="score-track"><i style="width:${shelter.utilization}%"></i></div>
              </div>
            `
            )
            .join("")}
        </div>
      </article>
    </section>
  `;
}

function buildReport(plan) {
  return {
    project: "DisasterAid Navigator",
    generatedAt: plan.generatedAt,
    strategy: plan.strategy,
    summary: plan.totals,
    weather: plan.weather,
    earthquake: plan.earthquake,
    fairnessAudit: plan.fairnessAudit,
    bottlenecks: plan.bottlenecks,
    commandCouncil: plan.commandCouncil,
    simulation: plan.simulation,
    counterfactuals: plan.counterfactuals,
    optimizer: plan.optimizer,
    cascadeGraph: plan.cascadeGraph,
    evacuationPlan: plan.evacuationPlan,
    missions: plan.missions,
    rankedZones: plan.zones.map((zone) => ({
      rank: zone.rank,
      name: zone.name,
      score: zone.score,
      level: zone.level,
      allocation: zone.allocation,
      unmetRiskLevel: zone.unmetRiskLevel,
      reasoning: zone.reasoning
    }))
  };
}

function renderCommandReport(plan) {
  root.innerHTML = `
    ${pageHeader("Command Report", "Complete export for judges and responders", `<button id="downloadReportBtn" class="primary-button" type="button"><i data-lucide="download"></i> Download JSON</button>`)}
    <section class="report-preview">
      <article class="ops-panel">
        <p class="eyebrow">Included intelligence</p>
        <div class="stack-list">
          ${[
            "Ranked relief allocation plan",
            "Multi-agent command council",
            "6 hour simulation",
            "Counterfactual explanations",
            "Reallocation optimizer",
            "Cascading risk graph",
            "Evacuation plan",
            "Fairness audit and bottlenecks"
          ]
            .map((item) => `<div class="audit-row"><span>${item}</span><strong>ready</strong></div>`)
            .join("")}
        </div>
      </article>
      <article class="ops-panel">
        <p class="eyebrow">Report snapshot</p>
        <pre class="json-preview">${escapeHtml(JSON.stringify(buildReport(plan), null, 2).slice(0, 1800))}</pre>
      </article>
    </section>
  `;
}

function renderRoute() {
  if (!state.plan) {
    root.innerHTML = `<section class="loading-panel"><i data-lucide="loader"></i><strong>Loading command intelligence</strong></section>`;
    renderIcons();
    return;
  }

  destroyMap();
  const path = currentPath();
  if (path === "/") renderDashboard(state.plan);
  else if (path === "/features/operations") renderOperations(state.plan);
  else if (path === "/features/command-council") renderCommandCouncil(state.plan);
  else if (path === "/features/simulation") renderSimulation(state.plan);
  else if (path === "/features/counterfactuals") renderCounterfactuals(state.plan);
  else if (path === "/features/optimizer") renderOptimizer(state.plan);
  else if (path === "/features/citizen-reports") renderCitizenReports(state.plan);
  else if (path === "/features/cascade-graph") renderCascadeGraph(state.plan);
  else if (path === "/features/evacuation") renderEvacuation(state.plan);
  else if (path === "/features/command-report") renderCommandReport(state.plan);
  else renderDashboard(state.plan);

  bindPageHandlers();
  renderIcons();
  root.focus({ preventScroll: true });
}

async function loadPlan() {
  const status = el("dataStatus");
  if (status) status.textContent = "Generating plan";
  const refreshBtn = el("refreshBtn");
  if (refreshBtn) refreshBtn.disabled = true;

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

    state.plan = await response.json();
    if (status) status.textContent = `${state.plan.weather.source} + ${state.plan.earthquake.source}`;
    renderRoute();
  } catch (error) {
    console.error(error);
    root.innerHTML = `<section class="ops-panel"><p class="recommendation">The server could not generate a plan. Check local logs or Render logs.</p></section>`;
    if (status) status.textContent = "Plan unavailable";
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

function navigate(path) {
  window.history.pushState({}, "", path);
  renderRoute();
}

function downloadReport() {
  if (!state.plan) return;
  const blob = new Blob([JSON.stringify(buildReport(state.plan), null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `disasteraid-command-report-${Date.now()}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function submitCitizenReport(event) {
  event.preventDefault();
  const text = el("reportText").value.trim();
  const zoneId = el("reportZone").value;
  const resultBox = el("reportResult");
  if (!text) {
    resultBox.innerHTML = `<p class="recommendation">Enter a report before analysis.</p>`;
    return;
  }

  resultBox.innerHTML = `<p class="recommendation">Analyzing field report...</p>`;
  const response = await fetch("/api/report", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text, zoneId })
  });
  const report = await response.json();
  state.reportHistory.unshift(report);
  state.reportHistory = state.reportHistory.slice(0, 10);
  localStorage.setItem("citizenReports", JSON.stringify(state.reportHistory));
  resultBox.innerHTML = `
    <p class="eyebrow">Analysis result</p>
    <h2>${escapeHtml(report.classification)} report</h2>
    <div class="stack-list">
      <div class="audit-row"><span>Matched zone</span><strong>${escapeHtml(report.zoneMatch?.name || "Unknown")}</strong></div>
      <div class="audit-row"><span>Credibility</span><strong>${report.credibility}%</strong></div>
      <div class="audit-row"><span>Priority impact</span><strong>${report.priorityImpact}</strong></div>
    </div>
    <p class="recommendation">${escapeHtml(report.recommendedAction)}</p>
  `;
  if (el("reportHistory")) el("reportHistory").innerHTML = renderReportHistory();
}

function bindPageHandlers() {
  document.querySelectorAll(".strategy-option").forEach((button) => {
    button.addEventListener("click", () => {
      state.strategy = button.dataset.strategy;
      loadPlan();
    });
  });

  if (el("generateBtn")) {
    el("generateBtn").addEventListener("click", loadPlan);
  }

  if (el("downloadReportBtn")) {
    el("downloadReportBtn").addEventListener("click", downloadReport);
  }

  if (el("reportForm")) {
    el("reportForm").addEventListener("submit", submitCitizenReport);
  }
}

document.addEventListener("click", (event) => {
  const routeLink = event.target.closest("[data-route]");
  if (!routeLink) return;
  const href = routeLink.getAttribute("href");
  if (!href || href.startsWith("http")) return;
  event.preventDefault();
  navigate(href);
});

window.addEventListener("popstate", renderRoute);

document.addEventListener("DOMContentLoaded", () => {
  el("refreshBtn").addEventListener("click", loadPlan);
  renderRoute();
  loadPlan();
});
