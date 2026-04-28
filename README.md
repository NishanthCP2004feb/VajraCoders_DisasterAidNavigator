# DisasterAid Navigator

An intelligent decision-support dashboard for emergency relief prioritization and resource allocation.

The app ranks affected disaster zones, explains why each zone is prioritized, and allocates limited food, water, medical kits, rescue teams, and ambulances. It is designed as a hackathon-ready project that can run locally, be pushed to a public GitHub repository, and deploy directly to Render.

## Features

- Interactive Leaflet map with affected zones and top dispatch routes
- Priority score engine using severity, population, vulnerability, access, medical urgency, reports, shelter gap, and weather risk
- Resource allocation engine for food, water, medical kits, rescue teams, and ambulances
- Decision explanation for every ranked zone
- Three decision strategies: balanced response, equity guardrail, and fastest stabilization
- Fairness audit for high-vulnerability zones
- Bottleneck radar for unmet food, water, medical, rescue, and ambulance demand
- Dispatch mission cards with ETA, route distance, resources, and field objective
- Scenario stress test comparing resource shock, current inventory, and supply surge
- Downloadable JSON situation report for judges or responders
- Icon-based command dashboard with separate pages for every advanced feature
- Multi-agent command council with medical, logistics, equity, and risk agents
- Six-hour disaster simulation for severity, medical pressure, roads, and shelter stress
- Counterfactual lab showing what would change zone rankings
- Citizen report intelligence endpoint for classifying field reports
- Cascading risk graph for spillover and evacuation dependencies
- Shelter evacuation decision engine
- Live public data where available:
  - Open-Meteo weather API, no key required
  - USGS significant earthquake GeoJSON feed, no key required
- Fallback demo data when external APIs are unavailable
- No required API keys for the MVP

## Tech Stack

- Node.js HTTP server with no runtime dependencies
- HTML, CSS, and vanilla JavaScript frontend
- Leaflet and OpenStreetMap tiles for mapping
- JSON sample datasets for disaster zones and resource inventory
- Render-ready `render.yaml`

## Run Locally

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## API Endpoints

```text
GET  /api/health
GET  /api/zones
GET  /api/resources
POST /api/plan
POST /api/report
```

Example plan request:

```bash
curl -X POST http://localhost:3000/api/plan \
  -H "Content-Type: application/json" \
  -d "{\"strategy\":\"equity\",\"resources\":{\"foodKits\":4200,\"waterUnits\":6500,\"medicalKits\":1700,\"rescueTeams\":14,\"ambulances\":6}}"
```

## Decision Model

The priority score uses weighted multi-criteria decision analysis. The default balanced strategy is:

```text
priority =
  severity * 0.27
+ population pressure * 0.15
+ vulnerability share * 0.16
+ access difficulty * 0.14
+ medical urgency * 0.11
+ incident reports * 0.08
+ shelter gap * 0.05
+ weather risk * 0.04
```

The dashboard also includes an equity strategy and a speed strategy. Each strategy changes the weights while keeping the same explainable score components, so users can compare how priorities shift under different operational goals.

The allocation model distributes divisible resources by priority and then assigns remaining supply to unmet need in rank order. Rescue teams and ambulances are assigned as integer resources to the highest-priority and highest-medical-urgency zones.

## Hackathon Differentiators

- Explainable scoring instead of a black-box rank
- Separate routed pages for advanced features instead of one crowded dashboard
- AI command council that combines multiple specialized decision agents
- Forward simulation that projects how risk evolves over the next 6 hours
- Counterfactual explanations that show what would change the decision
- Citizen report analysis with credibility and urgency scoring
- Cascading risk graph for non-obvious zone dependencies
- Evacuation routing based on shelter overflow and accessible capacity
- Fairness guardrail that checks whether vulnerable zones receive a proportional share of support
- Stress-test mode to show how the plan changes during resource scarcity or supply surge
- Mission-level outputs that convert analytics into field tasks
- Works without paid APIs or secret keys
- Render-ready and public GitHub-ready

## Feature Pages

```text
/                               Command dashboard
/features/operations             Map and allocation control
/features/command-council        Multi-agent AI command council
/features/simulation             Six-hour disaster simulation
/features/counterfactuals        Counterfactual explanation lab
/features/optimizer              Resource reallocation optimizer
/features/citizen-reports        Citizen report intelligence
/features/cascade-graph          Cascading risk graph
/features/evacuation             Shelter evacuation engine
/features/command-report         Downloadable command report
```

## Deploy on Render

1. Push this folder to a public GitHub repository.
2. In Render, create a new Web Service from the repository.
3. Render can read `render.yaml`, or use:

```text
Build Command: npm install
Start Command: npm start
```

No environment variables are required for the MVP.

## Optional API Keys

The current project does not require keys. If you later add OpenAQ, Mapbox, OpenRouteService, Twilio, or another provider, store secrets in Render environment variables and do not commit them:

```text
OPENAQ_API_KEY=...
MAPBOX_API_KEY=...
```

## Feasibility

MVP feasibility is high because it uses bundled sample zone data and no-key public APIs. The advanced real-world version needs official local datasets such as road blockages, hospital capacity, relief inventory, and verified population vulnerability data.
