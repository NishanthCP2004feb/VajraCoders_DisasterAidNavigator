# DisasterAid Navigator Progress

## Project Status

The project is complete as a functional hackathon MVP and is ready for GitHub and Render deployment.

## Completed Work

- Built a full-stack disaster relief decision-support web app.
- Added a Node.js backend with API endpoints for health, zones, resources, and relief plans.
- Added an interactive Leaflet map using OpenStreetMap tiles.
- Added sample disaster-zone and resource inventory data.
- Implemented priority scoring for affected zones.
- Implemented resource allocation for food, water, medical kits, rescue teams, and ambulances.
- Added live public signal support using Open-Meteo and USGS feeds.
- Added fallback demo data when live APIs are unavailable.
- Added decision explanations for each ranked zone.
- Added Render deployment configuration.
- Added GitHub-ready README documentation.

## Advanced Hackathon Features

- Decision strategy modes:
  - Balanced response
  - Equity guardrail
  - Fastest stabilization
- Fairness audit for vulnerable zones.
- Bottleneck radar for unmet demand.
- Dispatch mission cards with ETA, route distance, objectives, and assigned resources.
- Scenario lab for resource shock, current inventory, and supply surge comparison.
- Downloadable JSON situation report.
- Score breakdown showing how priority decisions are calculated.
- Icon dashboard with separate routed pages for every advanced feature.
- AI Multi-Agent Command Council.
- Next 6 hours disaster simulation.
- Counterfactual explanation lab.
- Resource reallocation optimizer.
- Citizen report intelligence.
- Cascading risk graph.
- Shelter overflow and evacuation decision engine.
- Full command report export.

## Current Feature Routes

```text
/features/operations
/features/command-council
/features/simulation
/features/counterfactuals
/features/optimizer
/features/citizen-reports
/features/cascade-graph
/features/evacuation
/features/command-report
```

## Current Verification

- `node --check server.js` passed.
- `node --check public/app.js` passed.
- `GET /api/health` works.
- `GET /api/plan` works.
- `POST /api/plan` works with strategy modes.
- `POST /api/report` works for citizen report analysis.
- Separate feature routes return HTTP 200.
- Home page returns HTTP 200.

## Local Run

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## Deployment

The project includes `render.yaml`, so it can be deployed on Render as a web service from GitHub.

No API keys are required for the MVP.

## Repository Target

```text
https://github.com/NishanthCP2004feb/VajraCoders_DisasterAidNavigator.git
```
