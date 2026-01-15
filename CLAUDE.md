# CLAUDE.md - Project Guide for Claude Code

## Project Overview

This is an Observatory Dashboard built with Next.js 14 (App Router), Supabase, and a Raspberry Pi data collector. It displays real-time weather and sky conditions for amateur astronomers.

## Tech Stack

- **Frontend**: Next.js 14, React 18, TypeScript, CSS Modules
- **Backend**: Next.js API Routes, Supabase (PostgreSQL + Storage), Upstash Redis (KV)
- **Data Collection**: Python script on Raspberry Pi
- **Deployment**: Vercel

## Architecture

### Data Flow

```
[Instruments] → [Raspberry Pi Collector] → [Vercel API] → [Supabase + Redis KV]
                                                ↓
                                         [Dashboard UI]
```

### Instrument Health Tracking

The **collector is the source of truth** for instrument health. It tracks success/failure rates using a sliding window:

1. **Collector** (`raspberry-pi/collector.py`):
   - `InstrumentHealthTracker` class tracks last 10 readings per instrument
   - Thresholds: HEALTHY (<20% failures), DEGRADED (20-80%), OFFLINE (>80%)
   - Grace period: needs 3+ readings before reporting problems
   - Sends health status via heartbeat every 60 seconds

2. **Server** (`src/lib/telemetryKV.ts`):
   - Stores collector-reported health in Upstash Redis
   - Does NOT compute health from staleness - trusts the collector
   - Rate-limited to 120s intervals for Upstash free tier

3. **Dashboard** (`src/app/api/current/route.ts`):
   - Gets `telemetryHealth` from KV first
   - Overrides instrument status with collector-reported health
   - Derives `failedInstruments` from telemetryHealth, not Supabase

### Key Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/current` | GET | None | Current conditions + instrument health |
| `/api/heartbeat` | POST | Bearer | Receive heartbeat with health status |
| `/api/heartbeat` | GET | None | Get current heartbeat status |
| `/api/ingest/data` | POST | Bearer | Receive weather data from Pi |
| `/api/ingest/image` | POST | Bearer | Receive AllSky image from Pi |

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── current/          # Main data endpoint
│   │   ├── heartbeat/        # Collector heartbeat with health
│   │   ├── ingest/data/      # Data ingestion
│   │   └── ...
│   └── page.tsx              # Dashboard UI
├── components/
│   ├── ObservatoryInfo.tsx   # Telemetry health display
│   ├── InstrumentAlert.tsx   # Failed instrument banner
│   ├── WindCompass.tsx       # Wind direction compass
│   └── ...
├── lib/
│   ├── telemetryKV.ts        # Redis KV for health tracking
│   ├── instruments.ts        # Instrument helpers
│   └── ...
└── types/
    └── weather.ts            # TypeScript interfaces

raspberry-pi/
└── collector.py              # Pi data collector with health tracking
```

## Raspberry Pi Collector

### SSH Access
```bash
ssh observatory-pi
```

### Service Management
```bash
sudo systemctl restart observatory-collector
sudo journalctl -u observatory-collector -f
```

### Deploy Updates
```bash
scp raspberry-pi/collector.py observatory-pi:~/observatory-collector/collector.py
ssh observatory-pi "sudo systemctl restart observatory-collector"
```

### Health Tracker Constants
In `collector.py`:
- `WINDOW_SIZE = 10` - Track last 10 readings
- `MIN_READINGS = 3` - Grace period before reporting problems
- `DEGRADED_THRESHOLD = 0.2` - 20% failures = degraded
- `OFFLINE_THRESHOLD = 0.8` - 80% failures = offline

## Environment Variables

Required in `.env.local` and Vercel:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_KEY
INGEST_API_KEY

# Upstash Redis (for telemetry health)
KV_REST_API_URL
KV_REST_API_TOKEN
```

## Commands

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run lint     # Run ESLint
```

## Debugging

### Check Heartbeat Status
```bash
curl -s "https://observatory-dashboard.vercel.app/api/heartbeat?debug=true" | python3 -m json.tool
```

### Check Instrument Health
```bash
curl -s "https://observatory-dashboard.vercel.app/api/current" | python3 -c "
import sys, json
d = json.load(sys.stdin)
th = d.get('telemetryHealth', {})
print(f'Status: {th.get(\"status\")}')
for code, r in d.get('instrumentReadings', {}).items():
    print(f'  {code}: {r.get(\"status\")}')
"
```

### Pi Collector Logs
```bash
ssh observatory-pi "sudo journalctl -u observatory-collector -f"
```

## Common Issues

### Instruments showing offline after restart
The collector has a grace period of 3 readings before reporting problems. Wait ~3 minutes for instruments to establish healthy status.

### Health not updating
Check the KV rate limiting - writes are limited to 120s intervals. Debug with `/api/heartbeat?debug=true`.

### Stale data
The collector sends heartbeats every 60s. If heartbeat age > 5 minutes, status shows as "stale".
