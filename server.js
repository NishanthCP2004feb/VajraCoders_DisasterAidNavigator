const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const ZONES_PATH = path.join(ROOT, "data", "zones.json");
const RESOURCES_PATH = path.join(ROOT, "data", "resources.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

const STRATEGIES = {
  balanced: {
    label: "Balanced response",
    summary: "Balances severity, population, vulnerability, access, medical urgency, and live risk signals.",
    weights: {
      severity: 0.27,
      population: 0.15,
      vulnerability: 0.16,
      accessDifficulty: 0.14,
      medicalUrgency: 0.11,
      reports: 0.08,
      shelterGap: 0.05,
      weather: 0.04
    }
  },
  equity: {
    label: "Equity guardrail",
    summary: "Raises the priority of zones with vulnerable people, shelter gaps, and medical access barriers.",
    weights: {
      severity: 0.22,
      population: 0.1,
      vulnerability: 0.24,
      accessDifficulty: 0.13,
      medicalUrgency: 0.13,
      reports: 0.06,
      shelterGap: 0.09,
      weather: 0.03
    }
  },
  speed: {
    label: "Fastest stabilization",
    summary: "Prioritizes zones where teams can quickly reduce severe impact and reopen access.",
    weights: {
      severity: 0.28,
      population: 0.16,
      vulnerability: 0.09,
      accessDifficulty: 0.19,
      medicalUrgency: 0.1,
      reports: 0.09,
      shelterGap: 0.03,
      weather: 0.06
    }
  }
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function haversineKm(a, b) {
  const radius = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function readJson(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content);
}

async function fetchJson(url, timeoutMs = 4500) {
  if (typeof fetch !== "function") {
    throw new Error("Fetch is unavailable in this Node runtime.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "DisasterAidNavigator/1.0"
      }
    });

    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function getFallbackWeather() {
  return {
    source: "Demo fallback",
    temperatureC: 31,
    precipitationMm: 18,
    windSpeedKmh: 28,
    riskScore: 72,
    summary: "Heavy rain risk is simulated because live weather data is unavailable."
  };
}

function weatherRiskScore(weather) {
  const rainRisk = clamp((Number(weather.precipitationMm || 0) / 40) * 100, 0, 100);
  const windRisk = clamp((Number(weather.windSpeedKmh || 0) / 70) * 100, 0, 100);
  const heatRisk = clamp(((Number(weather.temperatureC || 25) - 32) / 12) * 100, 0, 100);
  return round(rainRisk * 0.55 + windRisk * 0.3 + heatRisk * 0.15);
}

async function getWeatherForHub(hub) {
  const params = new URLSearchParams({
    latitude: hub.latitude,
    longitude: hub.longitude,
    current: "temperature_2m,precipitation,rain,wind_speed_10m",
    hourly: "precipitation_probability",
    forecast_days: "1",
    timezone: "auto"
  });

  try {
    const data = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`);
    const current = data.current || {};
    const precipitation = Number(current.precipitation ?? current.rain ?? 0);
    const weather = {
      source: "Open-Meteo live",
      temperatureC: round(Number(current.temperature_2m ?? 0)),
      precipitationMm: round(precipitation),
      windSpeedKmh: round(Number(current.wind_speed_10m ?? 0)),
      riskScore: 0,
      summary: "Live weather data is included in the relief priority score."
    };
    weather.riskScore = weatherRiskScore(weather);
    return weather;
  } catch (error) {
    return getFallbackWeather();
  }
}

async function getEarthquakeSnapshot() {
  try {
    const data = await fetchJson("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson");
    const events = Array.isArray(data.features) ? data.features.slice(0, 5) : [];
    return {
      source: "USGS live",
      count: Number(data?.metadata?.count || events.length),
      events: events.map((event) => ({
        id: event.id,
        title: event.properties?.title || "Earthquake event",
        magnitude: event.properties?.mag || 0,
        place: event.properties?.place || "Unknown location",
        time: event.properties?.time || null,
        url: event.properties?.url || ""
      }))
    };
  } catch (error) {
    return {
      source: "Demo fallback",
      count: 1,
      events: [
        {
          id: "demo-quake",
          title: "M 5.1 - simulated regional tremor",
          magnitude: 5.1,
          place: "Regional demo event",
          time: Date.now(),
          url: ""
        }
      ]
    };
  }
}

function riskLevel(score) {
  if (score >= 80) return "Critical";
  if (score >= 65) return "High";
  if (score >= 45) return "Moderate";
  return "Watch";
}

function getStrategy(strategyName) {
  return STRATEGIES[strategyName] || STRATEGIES.balanced;
}

function buildReasoning(zone, components, strategyName) {
  const reasons = [];
  if (zone.severity >= 80) reasons.push("severe field impact");
  if (components.vulnerability >= 45) reasons.push("high vulnerable population share");
  if (components.accessDifficulty >= 60) reasons.push("poor road access");
  if (zone.hospitalDistanceKm >= 8) reasons.push("far from hospital support");
  if (zone.shelterCapacity < zone.vulnerablePeople * 0.5) reasons.push("limited shelter capacity");
  if (components.weather >= 65) reasons.push("weather can worsen operations");
  if (strategyName === "equity" && components.vulnerability >= 30) reasons.push("equity mode protects vulnerable groups");
  if (strategyName === "speed" && components.accessDifficulty >= 45) reasons.push("speed mode targets access restoration");
  if (reasons.length === 0) reasons.push("balanced need across impact and access factors");
  return reasons;
}

function scoreZones(zones, hub, weather, strategyName = "balanced") {
  const maxPopulation = Math.max(...zones.map((zone) => zone.population), 1);
  const maxReports = Math.max(...zones.map((zone) => zone.incidentReports), 1);
  const weatherRisk = Number(weather.riskScore || 0);
  const strategy = getStrategy(strategyName);
  const weights = strategy.weights;

  return zones.map((zone) => {
    const populationPressure = (zone.population / maxPopulation) * 100;
    const vulnerability = (zone.vulnerablePeople / zone.population) * 100;
    const accessDifficulty = 100 - zone.roadAccess;
    const medicalUrgency = clamp(zone.hospitalDistanceKm * 7 + (zone.medicalNeed / Math.max(zone.population, 1)) * 1800, 0, 100);
    const reportPressure = (zone.incidentReports / maxReports) * 100;
    const shelterGap = clamp(((zone.vulnerablePeople - zone.shelterCapacity) / Math.max(zone.vulnerablePeople, 1)) * 100, 0, 100);
    const distanceFromHubKm = haversineKm(hub, zone);

    const components = {
      severity: zone.severity,
      population: round(populationPressure),
      vulnerability: round(vulnerability),
      accessDifficulty: round(accessDifficulty),
      medicalUrgency: round(medicalUrgency),
      reports: round(reportPressure),
      shelterGap: round(shelterGap),
      weather: weatherRisk
    };

    const score = Object.entries(weights).reduce((total, [key, weight]) => total + components[key] * weight, 0);

    return {
      ...zone,
      distanceFromHubKm: round(distanceFromHubKm, 2),
      score: round(score),
      level: riskLevel(score),
      components,
      reasoning: buildReasoning(zone, components, strategyName),
      allocation: {
        foodKits: 0,
        waterUnits: 0,
        medicalKits: 0,
        rescueTeams: 0,
        ambulances: 0
      }
    };
  });
}

function allocateDivisible(rankedZones, resourceName, needName, total) {
  const allocation = new Map(rankedZones.map((zone) => [zone.id, 0]));
  let remaining = Math.max(0, Math.floor(Number(total || 0)));
  const prioritySum = rankedZones.reduce((sum, zone) => sum + zone.score, 0) || 1;

  for (const zone of rankedZones) {
    const planned = Math.floor((total * zone.score) / prioritySum);
    const amount = Math.min(zone[needName], planned, remaining);
    allocation.set(zone.id, amount);
    remaining -= amount;
  }

  for (const zone of rankedZones) {
    if (remaining <= 0) break;
    const current = allocation.get(zone.id) || 0;
    const unmet = Math.max(zone[needName] - current, 0);
    const amount = Math.min(unmet, remaining);
    allocation.set(zone.id, current + amount);
    remaining -= amount;
  }

  for (const zone of rankedZones) {
    zone.allocation[resourceName] = allocation.get(zone.id) || 0;
  }

  return remaining;
}

function allocateInteger(rankedZones, resourceName, needName, total) {
  let remaining = Math.max(0, Math.floor(Number(total || 0)));

  for (const zone of rankedZones) {
    if (remaining <= 0) break;
    const need = Math.max(0, Math.floor(Number(zone[needName] || 0)));
    const amount = Math.min(need, remaining);
    zone.allocation[resourceName] = amount;
    remaining -= amount;
  }

  return remaining;
}

function allocateAmbulances(rankedZones, total) {
  let remaining = Math.max(0, Math.floor(Number(total || 0)));
  const medicalRank = [...rankedZones].sort((a, b) => {
    const aScore = a.components.medicalUrgency * 0.7 + a.score * 0.3;
    const bScore = b.components.medicalUrgency * 0.7 + b.score * 0.3;
    return bScore - aScore;
  });

  for (const zone of medicalRank) {
    if (remaining <= 0) break;
    if (zone.medicalNeed < 150 && zone.components.medicalUrgency < 55) continue;
    zone.allocation.ambulances += 1;
    remaining -= 1;
  }

  for (const zone of medicalRank) {
    if (remaining <= 0) break;
    if (zone.allocation.ambulances >= 2) continue;
    zone.allocation.ambulances += 1;
    remaining -= 1;
  }

  return remaining;
}

function coveragePercent(allocated, needed) {
  if (!needed) return 100;
  return round(clamp((allocated / needed) * 100, 0, 100));
}

function unmetRiskLevel(score) {
  if (score >= 72) return "Critical";
  if (score >= 52) return "High";
  if (score >= 28) return "Elevated";
  return "Controlled";
}

function addCoverageAndUnmetRisk(rankedZones) {
  for (const zone of rankedZones) {
    const unmet = {
      foodKits: Math.max(zone.foodNeed - zone.allocation.foodKits, 0),
      waterUnits: Math.max(zone.waterNeed - zone.allocation.waterUnits, 0),
      medicalKits: Math.max(zone.medicalNeed - zone.allocation.medicalKits, 0),
      rescueTeams: Math.max(zone.rescueNeed - zone.allocation.rescueTeams, 0),
      ambulances: Math.max((zone.medicalNeed >= 150 ? 1 : 0) - zone.allocation.ambulances, 0)
    };

    const coverage = {
      food: coveragePercent(zone.allocation.foodKits, zone.foodNeed),
      water: coveragePercent(zone.allocation.waterUnits, zone.waterNeed),
      medical: coveragePercent(zone.allocation.medicalKits, zone.medicalNeed),
      rescue: coveragePercent(zone.allocation.rescueTeams, zone.rescueNeed),
      transport: coveragePercent(zone.allocation.ambulances, zone.medicalNeed >= 150 ? 1 : 0)
    };

    const unmetRisk =
      (100 - coverage.food) * 0.2 +
      (100 - coverage.water) * 0.2 +
      (100 - coverage.medical) * 0.25 +
      (100 - coverage.rescue) * 0.2 +
      zone.score * 0.15;

    zone.unmet = unmet;
    zone.coverage = coverage;
    zone.coverageAverage = round((coverage.food + coverage.water + coverage.medical + coverage.rescue + coverage.transport) / 5);
    zone.unmetRiskScore = round(unmetRisk);
    zone.unmetRiskLevel = unmetRiskLevel(unmetRisk);
  }
}

function weightedSupport(zone) {
  return (
    zone.allocation.foodKits +
    zone.allocation.waterUnits * 0.6 +
    zone.allocation.medicalKits * 2.2 +
    zone.allocation.rescueTeams * 360 +
    zone.allocation.ambulances * 280
  );
}

function buildFairnessAudit(rankedZones, totals) {
  const vulnerablePopulationShare = coveragePercent(totals.vulnerablePeople, totals.population);
  const averageVulnerability = vulnerablePopulationShare;
  const highVulnerabilityZones = rankedZones.filter((zone) => zone.components.vulnerability >= averageVulnerability);
  const highVulnerabilityPopulation = highVulnerabilityZones.reduce((sum, zone) => sum + zone.population, 0);
  const highVulnerabilityPopulationShare = coveragePercent(highVulnerabilityPopulation, totals.population);
  const totalSupport = rankedZones.reduce((sum, zone) => sum + weightedSupport(zone), 0) || 1;
  const highVulnerabilitySupport = highVulnerabilityZones.reduce((sum, zone) => sum + weightedSupport(zone), 0);
  const highVulnerabilitySupportShare = coveragePercent(highVulnerabilitySupport, totalSupport);
  const lowestCovered = [...highVulnerabilityZones].sort((a, b) => a.coverageAverage - b.coverageAverage)[0];
  const passing = highVulnerabilitySupportShare + 5 >= highVulnerabilityPopulationShare;
  const recommendations = [];

  if (!passing) {
    recommendations.push("Shift food, water, or medical kits toward high-vulnerability zones before dispatch.");
  }
  if (lowestCovered && lowestCovered.unmetRiskScore >= 50) {
    recommendations.push(`Review ${lowestCovered.name}; it has high vulnerability and ${lowestCovered.unmetRiskLevel.toLowerCase()} unmet risk.`);
  }
  if (!recommendations.length) {
    recommendations.push("Current allocation is aligned with the vulnerability guardrail.");
  }

  return {
    status: passing ? "Passing" : "Needs review",
    vulnerablePopulationShare,
    highVulnerabilityPopulationShare,
    highVulnerabilitySupportShare,
    highVulnerabilityZoneCount: highVulnerabilityZones.length,
    lowestCoveredVulnerableZone: lowestCovered
      ? {
          id: lowestCovered.id,
          name: lowestCovered.name,
          coverageAverage: lowestCovered.coverageAverage,
          unmetRiskLevel: lowestCovered.unmetRiskLevel
        }
      : null,
    recommendations
  };
}

function buildMissions(rankedZones) {
  return rankedZones.slice(0, 5).map((zone, index) => {
    const etaMinutes = Math.ceil(zone.distanceFromHubKm * (zone.roadAccess < 40 ? 9 : zone.roadAccess < 60 ? 7 : 5) + 18);
    const objective =
      zone.allocation.rescueTeams > 0
        ? "Stabilize access, complete search checks, and establish a relief drop point."
        : zone.allocation.medicalKits > 150
          ? "Set up medical triage and distribute urgent care kits."
          : "Deliver essential supplies and report updated field conditions.";

    return {
      id: `mission-${zone.id}`,
      dispatchOrder: index + 1,
      zoneId: zone.id,
      zoneName: zone.name,
      level: zone.level,
      etaMinutes,
      routeKm: zone.distanceFromHubKm,
      objective,
      resources: {
        foodKits: zone.allocation.foodKits,
        waterUnits: zone.allocation.waterUnits,
        medicalKits: zone.allocation.medicalKits,
        rescueTeams: zone.allocation.rescueTeams,
        ambulances: zone.allocation.ambulances
      },
      checklist: [
        "confirm route access before dispatch",
        "update zone status after first contact",
        "record unmet need after delivery"
      ]
    };
  });
}

function buildBottlenecks(rankedZones) {
  const shortageTotals = rankedZones.reduce(
    (sum, zone) => {
      sum.foodKits += zone.unmet.foodKits;
      sum.waterUnits += zone.unmet.waterUnits;
      sum.medicalKits += zone.unmet.medicalKits;
      sum.rescueTeams += zone.unmet.rescueTeams;
      sum.ambulances += zone.unmet.ambulances;
      return sum;
    },
    { foodKits: 0, waterUnits: 0, medicalKits: 0, rescueTeams: 0, ambulances: 0 }
  );

  const hotspots = [...rankedZones]
    .sort((a, b) => b.unmetRiskScore - a.unmetRiskScore)
    .slice(0, 4)
    .map((zone) => ({
      zoneId: zone.id,
      zoneName: zone.name,
      unmetRiskScore: zone.unmetRiskScore,
      unmetRiskLevel: zone.unmetRiskLevel,
      biggestGap: Object.entries(zone.coverage)
        .sort((a, b) => a[1] - b[1])[0][0]
    }));

  const largestShortage = Object.entries(shortageTotals).sort((a, b) => b[1] - a[1])[0];

  return {
    shortageTotals,
    hotspots,
    recommendation:
      largestShortage && largestShortage[1] > 0
        ? `Largest system shortage is ${largestShortage[0]} with ${largestShortage[1]} units still unmet.`
        : "No unmet shortages remain under the current inventory."
  };
}

function buildCoverageSummary(rankedZones) {
  const needs = rankedZones.reduce(
    (sum, zone) => {
      sum.foodKits += zone.foodNeed;
      sum.waterUnits += zone.waterNeed;
      sum.medicalKits += zone.medicalNeed;
      sum.rescueTeams += zone.rescueNeed;
      sum.ambulances += zone.medicalNeed >= 150 ? 1 : 0;
      sum.foodAllocated += zone.allocation.foodKits;
      sum.waterAllocated += zone.allocation.waterUnits;
      sum.medicalAllocated += zone.allocation.medicalKits;
      sum.rescueAllocated += zone.allocation.rescueTeams;
      sum.ambulanceAllocated += zone.allocation.ambulances;
      return sum;
    },
    {
      foodKits: 0,
      waterUnits: 0,
      medicalKits: 0,
      rescueTeams: 0,
      ambulances: 0,
      foodAllocated: 0,
      waterAllocated: 0,
      medicalAllocated: 0,
      rescueAllocated: 0,
      ambulanceAllocated: 0
    }
  );

  return {
    food: coveragePercent(needs.foodAllocated, needs.foodKits),
    water: coveragePercent(needs.waterAllocated, needs.waterUnits),
    medical: coveragePercent(needs.medicalAllocated, needs.medicalKits),
    rescue: coveragePercent(needs.rescueAllocated, needs.rescueTeams),
    ambulance: coveragePercent(needs.ambulanceAllocated, needs.ambulances)
  };
}

function buildScenarioComparison(zones, hub, resources, weather, strategyName) {
  const scenarios = [
    { id: "scarcity", name: "40% resource shock", multiplier: 0.6 },
    { id: "current", name: "Current inventory", multiplier: 1 },
    { id: "surge", name: "30% supply surge", multiplier: 1.3 }
  ];

  return scenarios.map((scenario) => {
    const scaledResources = Object.fromEntries(
      Object.entries(resources).map(([key, value]) => [key, Math.floor(Number(value || 0) * scenario.multiplier)])
    );
    const rankedZones = scoreZones(zones, hub, weather, strategyName).sort((a, b) => b.score - a.score);
    allocateDivisible(rankedZones, "foodKits", "foodNeed", scaledResources.foodKits);
    allocateDivisible(rankedZones, "waterUnits", "waterNeed", scaledResources.waterUnits);
    allocateDivisible(rankedZones, "medicalKits", "medicalNeed", scaledResources.medicalKits);
    allocateInteger(rankedZones, "rescueTeams", "rescueNeed", scaledResources.rescueTeams);
    allocateAmbulances(rankedZones, scaledResources.ambulances);
    addCoverageAndUnmetRisk(rankedZones);

    return {
      ...scenario,
      resources: scaledResources,
      topZone: rankedZones[0]?.name || "None",
      averageCoverage: round(rankedZones.reduce((sum, zone) => sum + zone.coverageAverage, 0) / Math.max(rankedZones.length, 1)),
      highUnmetZones: rankedZones.filter((zone) => zone.unmetRiskLevel === "Critical" || zone.unmetRiskLevel === "High").length,
      coverage: buildCoverageSummary(rankedZones)
    };
  });
}

function buildPlan(zones, hub, resources, weather, earthquake, strategyName = "balanced") {
  const strategy = getStrategy(strategyName);
  const rankedZones = scoreZones(zones, hub, weather, strategyName).sort((a, b) => b.score - a.score);

  const remaining = {
    foodKits: allocateDivisible(rankedZones, "foodKits", "foodNeed", resources.foodKits),
    waterUnits: allocateDivisible(rankedZones, "waterUnits", "waterNeed", resources.waterUnits),
    medicalKits: allocateDivisible(rankedZones, "medicalKits", "medicalNeed", resources.medicalKits),
    rescueTeams: allocateInteger(rankedZones, "rescueTeams", "rescueNeed", resources.rescueTeams),
    ambulances: allocateAmbulances(rankedZones, resources.ambulances)
  };

  addCoverageAndUnmetRisk(rankedZones);

  const totals = rankedZones.reduce(
    (sum, zone) => {
      sum.population += zone.population;
      sum.vulnerablePeople += zone.vulnerablePeople;
      sum.foodAllocated += zone.allocation.foodKits;
      sum.waterAllocated += zone.allocation.waterUnits;
      sum.medicalAllocated += zone.allocation.medicalKits;
      sum.rescueTeamsAllocated += zone.allocation.rescueTeams;
      sum.ambulancesAllocated += zone.allocation.ambulances;
      if (zone.level === "Critical") sum.criticalZones += 1;
      return sum;
    },
    {
      population: 0,
      vulnerablePeople: 0,
      criticalZones: 0,
      foodAllocated: 0,
      waterAllocated: 0,
      medicalAllocated: 0,
      rescueTeamsAllocated: 0,
      ambulancesAllocated: 0
    }
  );

  return {
    generatedAt: new Date().toISOString(),
    strategy: {
      id: STRATEGIES[strategyName] ? strategyName : "balanced",
      label: strategy.label,
      summary: strategy.summary,
      weights: strategy.weights
    },
    reliefHub: hub,
    resources,
    remaining,
    weather,
    earthquake,
    totals,
    fairnessAudit: buildFairnessAudit(rankedZones, totals),
    bottlenecks: buildBottlenecks(rankedZones),
    missions: buildMissions(rankedZones),
    scenarios: buildScenarioComparison(zones, hub, resources, weather, strategyName),
    zones: rankedZones.map((zone, index) => ({
      ...zone,
      rank: index + 1
    }))
  };
}

async function parseBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw || "{}");
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(data, null, 2));
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, { error: message });
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, service: "DisasterAid Navigator" });
    return;
  }

  const zones = await readJson(ZONES_PATH);
  const resourceData = await readJson(RESOURCES_PATH);

  if (url.pathname === "/api/zones") {
    sendJson(response, 200, zones);
    return;
  }

  if (url.pathname === "/api/resources") {
    sendJson(response, 200, resourceData);
    return;
  }

  if (url.pathname === "/api/plan") {
    const custom = request.method === "POST" ? await parseBody(request) : {};
    const strategyName = typeof custom.strategy === "string" ? custom.strategy : "balanced";
    const resources = {
      ...resourceData.resources,
      ...(custom.resources || {})
    };
    const hub = {
      ...resourceData.reliefHub,
      ...(custom.reliefHub || {})
    };
    const [weather, earthquake] = await Promise.all([getWeatherForHub(hub), getEarthquakeSnapshot()]);
    const plan = buildPlan(zones, hub, resources, weather, earthquake, strategyName);
    sendJson(response, 200, plan);
    return;
  }

  sendError(response, 404, "API route not found.");
}

async function serveStatic(response, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const normalized = path.normalize(safePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, normalized);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendError(response, 403, "Forbidden.");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600"
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      const index = await fs.readFile(path.join(PUBLIC_DIR, "index.html"));
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end(index);
      return;
    }
    throw error;
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    await serveStatic(response, url.pathname);
  } catch (error) {
    console.error(error);
    sendError(response, 500, "Internal server error.");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`DisasterAid Navigator running on http://localhost:${PORT}`);
});
