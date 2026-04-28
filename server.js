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

const AGENT_PROFILES = [
  {
    id: "medical",
    name: "Medical Agent",
    icon: "heart-pulse",
    focus: "Ambulances, medical kits, hospital distance, and triage pressure.",
    weights: {
      medicalUrgency: 0.36,
      severity: 0.22,
      vulnerability: 0.14,
      shelterGap: 0.1,
      reports: 0.08,
      accessDifficulty: 0.06,
      weather: 0.04
    }
  },
  {
    id: "logistics",
    name: "Logistics Agent",
    icon: "truck",
    focus: "Road access, route distance, blocked roads, and dispatch feasibility.",
    weights: {
      severity: 0.2,
      accessDifficulty: 0.28,
      population: 0.12,
      reports: 0.12,
      weather: 0.1,
      medicalUrgency: 0.08,
      vulnerability: 0.06,
      shelterGap: 0.04
    }
  },
  {
    id: "equity",
    name: "Equity Agent",
    icon: "scale",
    focus: "Vulnerable groups, shelter gaps, and proportional support.",
    weights: {
      vulnerability: 0.34,
      shelterGap: 0.2,
      population: 0.14,
      medicalUrgency: 0.12,
      severity: 0.1,
      accessDifficulty: 0.06,
      reports: 0.02,
      weather: 0.02
    }
  },
  {
    id: "risk",
    name: "Risk Agent",
    icon: "radar",
    focus: "Severity, live weather, incident reports, and cascading danger.",
    weights: {
      severity: 0.3,
      weather: 0.18,
      reports: 0.16,
      accessDifficulty: 0.12,
      medicalUrgency: 0.1,
      shelterGap: 0.08,
      vulnerability: 0.04,
      population: 0.02
    }
  }
];

function scoreByWeights(components, weights) {
  return round(Object.entries(weights).reduce((total, [key, weight]) => total + (components[key] || 0) * weight, 0));
}

function buildCommandCouncil(rankedZones) {
  const agentResults = AGENT_PROFILES.map((agent) => {
    const ranking = rankedZones
      .map((zone) => ({
        zoneId: zone.id,
        zoneName: zone.name,
        level: zone.level,
        score: scoreByWeights(zone.components, agent.weights),
        evidence: zone.reasoning.slice(0, 3)
      }))
      .sort((a, b) => b.score - a.score)
      .map((item, index) => ({
        ...item,
        rank: index + 1
      }));

    return {
      ...agent,
      topChoice: ranking[0]?.zoneName || "No zone",
      ranking: ranking.slice(0, 5)
    };
  });

  const consensus = rankedZones
    .map((zone) => {
      const ranks = agentResults.map((agent) => agent.ranking.find((item) => item.zoneId === zone.id)?.rank || rankedZones.length + 1);
      const averageRank = ranks.reduce((sum, value) => sum + value, 0) / ranks.length;
      const supportCount = agentResults.filter((agent) => agent.topChoice === zone.name).length;
      return {
        zoneId: zone.id,
        zoneName: zone.name,
        finalRank: zone.rank || 0,
        averageAgentRank: round(averageRank, 2),
        supportCount,
        finalScore: zone.score
      };
    })
    .sort((a, b) => a.averageAgentRank - b.averageAgentRank || b.finalScore - a.finalScore)
    .slice(0, 6);

  const topChoices = [...new Set(agentResults.map((agent) => agent.topChoice))];
  const debate = [
    `${agentResults[0].name} flags ${agentResults[0].topChoice} for immediate medical stabilization.`,
    `${agentResults[1].name} checks whether blocked roads could delay the same dispatch.`,
    `${agentResults[2].name} verifies vulnerable zones are not deprioritized by distance alone.`,
    `${agentResults[3].name} watches for weather-amplified escalation in the next operating window.`
  ];

  return {
    consensusLeader: consensus[0]?.zoneName || "No consensus",
    agreementLevel: topChoices.length === 1 ? "Unanimous" : topChoices.length === 2 ? "Strong" : "Contested",
    agents: agentResults,
    consensus,
    debate
  };
}

function riskStatus(score) {
  if (score >= 86) return "Emergency escalation";
  if (score >= 74) return "Critical watch";
  if (score >= 58) return "Operational pressure";
  return "Stable monitoring";
}

function buildFutureSimulation(rankedZones, weather) {
  const hours = [0, 2, 4, 6];
  const weatherMultiplier = Number(weather.riskScore || 0) / 100;
  const zoneTimelines = rankedZones.slice(0, 6).map((zone) => {
    const timeline = hours.map((hour) => {
      const delayFactor = hour / 2;
      const severity = clamp(zone.severity + delayFactor * (weatherMultiplier * 4 + zone.unmetRiskScore * 0.025 + zone.blockedRoads * 0.35), 0, 100);
      const roadAccess = clamp(zone.roadAccess - delayFactor * (zone.blockedRoads * 1.8 + weatherMultiplier * 5), 0, 100);
      const medicalRisk = clamp(zone.components.medicalUrgency + delayFactor * (zone.unmet.medicalKits / Math.max(zone.medicalNeed, 1)) * 16, 0, 100);
      const shelterStress = clamp(zone.components.shelterGap + delayFactor * 4 + weatherMultiplier * 8, 0, 100);
      const projectedScore = round(severity * 0.38 + (100 - roadAccess) * 0.18 + medicalRisk * 0.22 + shelterStress * 0.12 + zone.components.vulnerability * 0.1);

      return {
        hour,
        severity: round(severity),
        roadAccess: round(roadAccess),
        medicalRisk: round(medicalRisk),
        shelterStress: round(shelterStress),
        projectedScore,
        status: riskStatus(projectedScore)
      };
    });

    return {
      zoneId: zone.id,
      zoneName: zone.name,
      currentLevel: zone.level,
      timeline
    };
  });

  return {
    horizonHours: 6,
    assumptions: [
      "Risk increases faster when weather risk and unmet medical demand are high.",
      "Road access degrades faster when blocked-road reports are high.",
      "Shelter stress rises when vulnerable people exceed shelter capacity."
    ],
    systemRiskCurve: hours.map((hour) => {
      const points = zoneTimelines.map((zone) => zone.timeline.find((item) => item.hour === hour)?.projectedScore || 0);
      return {
        hour,
        averageRisk: round(points.reduce((sum, value) => sum + value, 0) / Math.max(points.length, 1))
      };
    }),
    zones: zoneTimelines
  };
}

function buildCounterfactuals(rankedZones) {
  const leader = rankedZones[0];
  const challengers = rankedZones.slice(1, 6);

  return {
    target: leader
      ? {
          zoneId: leader.id,
          zoneName: leader.name,
          score: leader.score,
          explanation: `${leader.name} is first because ${leader.reasoning.join(", ")}.`
        }
      : null,
    rankFlipLevers: challengers.map((zone) => {
      const margin = Math.max(leader.score - zone.score, 0);
      return {
        zoneId: zone.id,
        zoneName: zone.name,
        currentRank: zone.rank,
        margin: round(margin),
        actions: [
          `${zone.name} becomes a top contender if severity rises by about ${Math.ceil(margin / 0.27)} points.`,
          `${zone.name} can overtake if road access drops below ${Math.max(zone.roadAccess - Math.ceil(margin / 0.14), 5)}%.`,
          `${leader.name} can lose rank if it receives ${Math.max(120, leader.unmet.medicalKits)} medical kits and ${Math.max(250, leader.unmet.waterUnits)} water units first.`
        ]
      };
    })
  };
}

function cloneZones(zones) {
  return JSON.parse(JSON.stringify(zones));
}

function applyTransfer(zoneMap, transfer) {
  const from = zoneMap.get(transfer.fromZoneId);
  const to = zoneMap.get(transfer.toZoneId);
  if (!from || !to) return;
  from.allocation[transfer.resource] -= transfer.amount;
  to.allocation[transfer.resource] += transfer.amount;
}

function buildReallocationOptimizer(rankedZones) {
  const beforeHighUnmet = rankedZones.filter((zone) => zone.unmetRiskLevel === "Critical" || zone.unmetRiskLevel === "High").length;
  const optimizedZones = cloneZones(rankedZones);
  const zoneMap = new Map(optimizedZones.map((zone) => [zone.id, zone]));
  const transfers = [];
  const resourceNeeds = {
    medicalKits: "medicalNeed",
    waterUnits: "waterNeed",
    foodKits: "foodNeed"
  };

  for (const resource of Object.keys(resourceNeeds)) {
    const needName = resourceNeeds[resource];
    const receivers = [...optimizedZones].sort((a, b) => b.unmetRiskScore - a.unmetRiskScore);
    const donors = [...optimizedZones].sort((a, b) => a.score - b.score);

    for (const receiver of receivers) {
      if (receiver.unmet[resource] <= 0 || transfers.length >= 8) continue;
      const donor = donors.find((candidate) => {
        if (candidate.id === receiver.id) return false;
        const minimumKeep = Math.floor(candidate[needName] * 0.62);
        return candidate.allocation[resource] > minimumKeep && candidate.unmetRiskScore < receiver.unmetRiskScore - 12;
      });
      if (!donor) continue;

      const donorSurplus = donor.allocation[resource] - Math.floor(donor[needName] * 0.62);
      const amount = Math.max(0, Math.min(donorSurplus, receiver.unmet[resource], resource === "medicalKits" ? 120 : 260));
      if (!amount) continue;

      const transfer = {
        resource,
        amount,
        fromZoneId: donor.id,
        fromZoneName: donor.name,
        toZoneId: receiver.id,
        toZoneName: receiver.name,
        reason: `Reduces ${receiver.unmetRiskLevel.toLowerCase()} unmet risk while keeping ${donor.name} above minimum coverage.`
      };
      transfers.push(transfer);
      applyTransfer(zoneMap, transfer);
      addCoverageAndUnmetRisk(optimizedZones);
    }
  }

  addCoverageAndUnmetRisk(optimizedZones);
  const afterHighUnmet = optimizedZones.filter((zone) => zone.unmetRiskLevel === "Critical" || zone.unmetRiskLevel === "High").length;
  const beforeCoverage = round(rankedZones.reduce((sum, zone) => sum + zone.coverageAverage, 0) / Math.max(rankedZones.length, 1));
  const afterCoverage = round(optimizedZones.reduce((sum, zone) => sum + zone.coverageAverage, 0) / Math.max(optimizedZones.length, 1));

  return {
    objective: "Minimize high unmet-risk zones while preserving minimum coverage in donor zones.",
    before: {
      highUnmetZones: beforeHighUnmet,
      averageCoverage: beforeCoverage
    },
    after: {
      highUnmetZones: afterHighUnmet,
      averageCoverage: afterCoverage
    },
    transfers,
    summary:
      transfers.length > 0
        ? `Recommended ${transfers.length} controlled reallocations.`
        : "No safe internal transfer found; request external supply surge for shortage resources."
  };
}

function buildCascadeGraph(rankedZones) {
  const nodes = rankedZones.map((zone) => {
    const spareShelter = Math.max(zone.shelterCapacity - zone.vulnerablePeople, 0);
    return {
      id: zone.id,
      name: zone.name,
      level: zone.level,
      score: zone.score,
      role: spareShelter > 500 && zone.roadAccess >= 70 ? "shelter-hub" : zone.unmetRiskScore >= 60 ? "risk-source" : "support-zone",
      x: zone.longitude,
      y: zone.latitude
    };
  });

  const edges = [];
  for (const source of rankedZones) {
    for (const target of rankedZones) {
      if (source.id === target.id) continue;
      const distance = haversineKm(source, target);
      const targetSpare = target.shelterCapacity - target.vulnerablePeople;

      if (distance <= 4.8 && source.score >= 65 && edges.length < 18) {
        edges.push({
          from: source.id,
          to: target.id,
          strength: round(clamp((5 - distance) * 18 + source.score * 0.25, 10, 100)),
          type: "spillover",
          reason: `${source.name} can increase demand pressure in nearby ${target.name}.`
        });
      } else if (source.components.shelterGap > 20 && targetSpare > 300 && target.roadAccess > 60 && edges.length < 18) {
        edges.push({
          from: source.id,
          to: target.id,
          strength: round(clamp(targetSpare / 25, 10, 100)),
          type: "evacuation-link",
          reason: `${target.name} can absorb evacuees from ${source.name}.`
        });
      }
    }
  }

  return {
    nodes,
    edges,
    insight:
      edges.length > 0
        ? "The graph highlights zones where failure can spill into nearby demand or evacuation routes."
        : "No critical cascade edges detected under current sample data."
  };
}

function buildEvacuationPlan(rankedZones) {
  const sources = rankedZones
    .filter((zone) => zone.components.shelterGap > 0 || zone.level === "Critical")
    .map((zone) => ({
      ...zone,
      overflow: Math.max(zone.vulnerablePeople - zone.shelterCapacity, Math.ceil(zone.vulnerablePeople * (zone.level === "Critical" ? 0.18 : 0.08)))
    }))
    .filter((zone) => zone.overflow > 0)
    .sort((a, b) => b.score - a.score);

  const shelters = rankedZones
    .map((zone) => ({
      zoneId: zone.id,
      zoneName: zone.name,
      roadAccess: zone.roadAccess,
      capacity: zone.shelterCapacity,
      occupied: Math.min(zone.vulnerablePeople, zone.shelterCapacity),
      spare: Math.max(zone.shelterCapacity - Math.min(zone.vulnerablePeople, zone.shelterCapacity), 0)
    }))
    .filter((shelter) => shelter.spare > 100 && shelter.roadAccess >= 55)
    .sort((a, b) => b.roadAccess + b.spare / 50 - (a.roadAccess + a.spare / 50));

  const movements = [];
  let unassigned = 0;

  for (const source of sources) {
    let remaining = source.overflow;
    for (const shelter of shelters) {
      if (remaining <= 0) break;
      if (shelter.zoneId === source.id || shelter.spare <= 0) continue;
      const amount = Math.min(remaining, shelter.spare, 900);
      shelter.spare -= amount;
      shelter.occupied += amount;
      remaining -= amount;
      movements.push({
        fromZoneId: source.id,
        fromZoneName: source.name,
        toZoneId: shelter.zoneId,
        toZoneName: shelter.zoneName,
        people: amount,
        routeKm: round(haversineKm(source, rankedZones.find((zone) => zone.id === shelter.zoneId) || source), 2),
        priority: source.level,
        reason: `${source.name} has shelter stress; ${shelter.zoneName} has accessible spare capacity.`
      });
    }
    unassigned += remaining;
  }

  return {
    totalEvacuees: movements.reduce((sum, move) => sum + move.people, 0),
    unassignedOverflow: unassigned,
    movements,
    shelters: shelters.map((shelter) => ({
      ...shelter,
      utilization: coveragePercent(shelter.occupied, shelter.capacity)
    }))
  };
}

function analyzeCitizenReport(text, zoneId, zones) {
  const content = String(text || "").trim();
  const lower = content.toLowerCase();
  const matchedZone =
    zones.find((zone) => zone.id === zoneId) ||
    zones.find((zone) => lower.includes(zone.name.toLowerCase())) ||
    zones.find((zone) => lower.includes(zone.district.toLowerCase()));

  const classifiers = [
    { type: "Rescue", keywords: ["trapped", "stranded", "collapse", "evacuate", "rescue"], urgency: 88 },
    { type: "Medical", keywords: ["injured", "medicine", "doctor", "ambulance", "bleeding", "sick"], urgency: 82 },
    { type: "Road Block", keywords: ["road", "bridge", "blocked", "traffic", "landslide"], urgency: 72 },
    { type: "Water/Food", keywords: ["water", "food", "hungry", "ration", "milk"], urgency: 64 },
    { type: "Shelter", keywords: ["shelter", "camp", "homeless", "school", "relocation"], urgency: 68 },
    { type: "Flood", keywords: ["flood", "rain", "water level", "overflow", "drain"], urgency: 78 }
  ];

  const matches = classifiers
    .map((item) => ({
      ...item,
      hits: item.keywords.filter((keyword) => lower.includes(keyword)).length
    }))
    .filter((item) => item.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.urgency - a.urgency);

  const primary = matches[0] || { type: "General", urgency: 45, hits: 0, keywords: [] };
  const hasNumber = /\d+/.test(content);
  const credibility = clamp(
    35 +
      (matchedZone ? 22 : 0) +
      (hasNumber ? 14 : 0) +
      Math.min(content.length / 8, 18) +
      Math.min(primary.hits * 8, 20),
    0,
    98
  );
  const priorityImpact = clamp(primary.urgency * 0.58 + credibility * 0.32 + (matchedZone?.severity || 50) * 0.1, 0, 100);

  return {
    receivedAt: new Date().toISOString(),
    originalText: content,
    classification: primary.type,
    secondarySignals: matches.slice(1, 4).map((item) => item.type),
    credibility: round(credibility),
    urgencyScore: round(primary.urgency),
    priorityImpact: round(priorityImpact),
    zoneMatch: matchedZone
      ? {
          id: matchedZone.id,
          name: matchedZone.name,
          district: matchedZone.district
        }
      : null,
    recommendedAction:
      priorityImpact >= 80
        ? "Escalate to command council and request field verification immediately."
        : priorityImpact >= 62
          ? "Add to incident queue and ask nearest mission team for confirmation."
          : "Monitor and request more precise location or evidence.",
    suggestedDataUpdate: matchedZone
      ? {
          incidentReportsDelta: Math.ceil(priorityImpact / 18),
          severityDelta: primary.type === "Rescue" || primary.type === "Flood" ? 4 : 2,
          roadAccessDelta: primary.type === "Road Block" ? -8 : 0
        }
      : null
  };
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

  const rankedWithRank = rankedZones.map((zone, index) => ({
    ...zone,
    rank: index + 1
  }));

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
    fairnessAudit: buildFairnessAudit(rankedWithRank, totals),
    bottlenecks: buildBottlenecks(rankedWithRank),
    missions: buildMissions(rankedWithRank),
    scenarios: buildScenarioComparison(zones, hub, resources, weather, strategyName),
    commandCouncil: buildCommandCouncil(rankedWithRank),
    simulation: buildFutureSimulation(rankedWithRank, weather),
    counterfactuals: buildCounterfactuals(rankedWithRank),
    optimizer: buildReallocationOptimizer(rankedWithRank),
    cascadeGraph: buildCascadeGraph(rankedWithRank),
    evacuationPlan: buildEvacuationPlan(rankedWithRank),
    zones: rankedWithRank
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

  if (url.pathname === "/api/report") {
    if (request.method !== "POST") {
      sendError(response, 405, "Report analysis requires POST.");
      return;
    }
    const body = await parseBody(request);
    sendJson(response, 200, analyzeCitizenReport(body.text, body.zoneId, zones));
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
