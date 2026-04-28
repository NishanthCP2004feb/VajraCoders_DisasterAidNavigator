# 🚨 CrisisIQ — Real-Time Disaster Response Coordinator

AI-powered disaster response command center that helps relief teams decide **which zones need help first** and **how to distribute limited resources** optimally during natural disasters.

![Dashboard](https://img.shields.io/badge/Dashboard-Live_Map-blue) ![Node.js](https://img.shields.io/badge/Node.js-18+-green) ![License](https://img.shields.io/badge/License-MIT-yellow) ![No API Keys](https://img.shields.io/badge/API_Keys-Not_Required-brightgreen)

---

## ✨ Features

- **Interactive Disaster Map** — Leaflet.js + OpenStreetMap with color-coded zone markers, relief hub, and route lines
- **Priority Score Engine** — Weighted 8-factor formula ranks zones by urgency
- **Smart Resource Allocation** — Distributes food, water, medical kits, rescue teams, and ambulances based on priority + unmet need
- **Live Weather Data** — Open-Meteo API (no key required)
- **Live Earthquake Data** — USGS GeoJSON feed (no key required)
- **Scenario Replay Mode** — Simulated Hurricane Atlas unfolds in real-time across the dashboard
- **Zone Detail Modal** — Click any zone for full breakdown with score component mini-bars
- **Resource Utilization Bars** — Visual usage indicators for each resource type
- **Live Event Feed** — Auto-scrolling simulated emergency events
- **Export Plan as JSON** — Download the allocation plan for reporting
- **Responsive Design** — Works on desktop and mobile
- **Fallback Data** — Works even if live APIs are unavailable

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js (native `http` module) |
| Frontend | Vanilla HTML, CSS, JavaScript |
| Map | Leaflet.js + OpenStreetMap + CARTO dark tiles |
| Weather API | [Open-Meteo](https://open-meteo.com) (free, no key) |
| Seismic API | [USGS Earthquake Feed](https://earthquake.usgs.gov) (free, no key) |
| Fonts | Inter + JetBrains Mono (Google Fonts) |
| Deploy | Render (render.yaml included) |

---

## 🚀 Quick Start

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/CrisisIQ.git
cd CrisisIQ

# Install dependencies
npm install

# Start the server
npm start
```

Open **http://localhost:3000** in your browser.

> **No API keys required!** The project works out of the box with free public APIs and built-in fallback data.

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server health check |
| GET | `/api/zones` | Get all disaster zones + relief hub |
| GET | `/api/resources` | Get default resource inventory |
| GET | `/api/plan` | Generate plan with default resources |
| POST | `/api/plan` | Generate plan with custom resources |

### POST `/api/plan` Body

```json
{
  "foodKits": 3000,
  "waterUnits": 6000,
  "medicalKits": 500,
  "rescueTeams": 15,
  "ambulances": 20
}
```

---

## 🧮 Priority Score Model

Each zone receives a priority score (0–1) using a weighted formula:

```
Priority = severity × 0.27
         + population_pressure × 0.15
         + vulnerability_share × 0.16
         + access_difficulty × 0.14
         + medical_urgency × 0.11
         + incident_reports × 0.08
         + shelter_gap × 0.05
         + weather_risk × 0.04
```

---

## ☁️ Deploy on Render

1. Push this repo to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com)
3. Click **New → Blueprint**
4. Connect your GitHub repo
5. Render will auto-detect `render.yaml` and deploy

Or manually: **New → Web Service** → connect repo → build: `npm install` → start: `npm start`

---

## 📄 License

MIT — Free for personal, educational, and hackathon use.
