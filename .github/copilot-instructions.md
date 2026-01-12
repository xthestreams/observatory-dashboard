# Copilot Instructions for Observatory Dashboard

## Project Overview

This is a **real-time observatory monitoring dashboard** built with Next.js 14, Supabase, and a Raspberry Pi data collector. The system displays live weather conditions, sky quality (SQM), cloud detection, and all-sky camera feeds for amateur astronomers.

**Key characteristic**: Data flows *inbound* from Pi → API → Supabase → Dashboard UI. The dashboard is read-only for UI; all data mutations come through the `/api/ingest/*` endpoints.

## Critical Architecture Patterns

### Data Flow: Pi to Dashboard
```
Raspberry Pi (collector.py)
  ├─ MQTT (weewx/Davis weather)
  ├─ Serial (AAG Cloudwatcher, Unihedron SQM)
  └─ AllSky camera image
         ↓
  POST /api/ingest/data (Bearer token auth)
  POST /api/ingest/image (Bearer token auth)
         ↓
  Supabase PostgreSQL
  ├─ current_conditions (single row, always latest)
  └─ weather_readings (time-series history)
         ↓
  GET /api/current (no auth)
  GET /api/allsky/latest.jpg (no auth)
         ↓
  Dashboard UI (React client, 30s refresh interval)
```

### Database Schema Specifics
- **`current_conditions`**: Single row (id=1) upserted every push from Pi. Contains latest values + derived conditions (cloud_condition, rain_condition, wind_condition, day_condition)
- **`weather_readings`**: Append-only time-series table. Mirrors current_conditions structure for historical analysis
- **Key insight**: Conditions like "Clear", "Cloudy" are *computed on the Pi* (in collector.py), not derived in the backend

### Component Architecture
Components are **purely presentational** (no API calls). All data fetching happens in the Dashboard page component:
- `page.tsx`: Main component, handles fetching from `/api/current` on 30s interval
- `ConditionIndicator`, `WeatherStat`, `SQMGauge`, `SQMGraph`: Dumb display components that accept data props

## Project-Specific Conventions

### TypeScript Types
- All weather data uses the `WeatherData` interface (`src/types/weather.ts`)
- Condition types are *enums-as-unions*: `CloudCondition = "Clear" | "Cloudy" | "VeryCloudy" | "Unknown"`
- Never use `any`; prefer explicit condition types

### Supabase Client Instantiation
Three distinct clients in `src/lib/supabase.ts`:
- `createBrowserClient()`: React components (uses anon key, safe to expose)
- `createServerClient()`: API read operations (uses anon key)
- `createServiceClient()`: API write operations (uses service key, only in `/api/ingest/*`)

Use the correct client per context—mixing them is a security boundary violation.

### Configuration
- **All site-specific values live in `src/lib/config.ts`**: site name, coordinates, refresh interval, WeatherLink ID
- Changes to config do NOT require backend restart (next dev reloads)
- `refreshInterval` is in milliseconds; min ~30s to avoid API throttling

### Error Handling
- API routes return mock data on error (`getMockData()` in route.ts) for graceful degradation
- Frontend catches fetch errors and maintains stale data rather than showing errors
- Logs all errors to console for debugging

## Adding New Features (Common Workflows)

### Add a new sensor reading
1. **Database**: Add field to `current_conditions` and `weather_readings` in `supabase/schema.sql`
2. **Type definition**: Add property to `WeatherData` interface in `src/types/weather.ts`
3. **Pi collector**: Parse sensor data in `raspberry-pi/collector.py`, include in POST body to `/api/ingest/data`
4. **API ingest**: Add field mapping in `src/app/api/ingest/data/route.ts` (around line 24)
5. **Display**: Add `<ConditionIndicator>` or `<WeatherStat>` component in `src/app/page.tsx`

### Add a new dashboard panel
1. Create component in `src/components/` (use CSS Modules for styles, e.g., `NewPanel.module.css`)
2. Import in `src/app/page.tsx` from `@/components` (re-exported via `index.ts`)
3. Add to grid in the `<main className={styles.mainGrid}>` section
4. Components receive data via props; fetch from page-level state

### Change data refresh interval
Edit `siteConfig.refreshInterval` in `src/lib/config.ts` (value is milliseconds)

## Authentication & Security

- **Ingest API**: Secured with Bearer token (`INGEST_API_KEY`). Verified in every POST to `/api/ingest/*`
- **Public endpoints**: `/api/current`, `/api/allsky/*` have no auth (by design—dashboard is public-facing)
- **Supabase**: RLS not currently used; instead, relying on key-level access control
  - Anon key: Can only SELECT from current_conditions and weather_readings
  - Service key: Can UPSERT/INSERT (only used in API routes, never exposed to client)

## Development Workflow

```bash
npm run dev          # Start dev server on :3000 (with hot reload)
npm run build        # Next.js build (catches type/lint errors)
npm run type-check   # TypeScript check without build
npm run lint         # ESLint (uses next/core-web-vitals config)
```

**Key insight**: Next.js App Router means API routes live in `src/app/api/*/route.ts` (not `/pages/api/`)

## External Integrations

- **Clear Outside**: Forecast data, configure via coordinates in config.ts
- **BOM (Bureau of Meteorology)**: Satellite image URL in config.ts
- **WeatherLink**: Optional Davis weather station integration (embed ID in config.ts, set to null to use local data)
- **Vercel**: Production deployment; environment variables configured in Vercel dashboard

## Testing & Debugging

- **Mock data**: `/api/current` returns mock data if Supabase connection fails (useful for UI development)
- **Cache busting**: AllSky image URL includes timestamp (`?t=${Date.now()}`) to force refresh
- **CORS**: Next.js rewrites (in `next.config.js`) handle remote image fetching for BOM/Clear Outside

## Performance Notes

- Dashboard refetches every 30s by default (configurable)
- SQM history limited to last 24 hours, max 48 readings (in `/api/current` query)
- AllSky image served from Supabase Storage, proxied through `/api/allsky/[...path]`
- CSS Modules ensure style isolation; no global stylesheet conflicts
