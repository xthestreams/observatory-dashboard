# CLAUDE.md - Project Guide for Claude Code

## Project Overview

This is an Observatory Dashboard built with Next.js 14 (App Router), Supabase, and a Raspberry Pi data collector. It displays real-time weather and sky conditions for amateur astronomers.

## Tech Stack

- **Frontend**: Next.js 14, React 18, TypeScript, CSS Modules
- **Backend**: Next.js API Routes, Supabase (PostgreSQL + Storage)
- **Data Collection**: Python script on Raspberry Pi
- **Deployment**: Vercel

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   │   ├── current/       # GET /api/current - fetch current conditions
│   │   ├── ingest/data/   # POST /api/ingest/data - receive data from Pi
│   │   ├── ingest/image/  # POST /api/ingest/image - receive AllSky images
│   │   └── allsky/        # GET /api/allsky/* - serve AllSky images
│   ├── layout.tsx         # Root layout with font loading
│   ├── page.tsx           # Main dashboard component
│   ├── page.module.css    # Dashboard styles
│   └── globals.css        # Global styles
├── components/            # Reusable React components
│   ├── ConditionIndicator.tsx
│   ├── WeatherStat.tsx
│   ├── SQMGauge.tsx
│   └── SQMGraph.tsx
├── lib/
│   ├── config.ts          # Site configuration (edit this!)
│   ├── supabase.ts        # Supabase client helpers
│   └── weatherHelpers.ts  # Icon/color helper functions
└── types/
    └── weather.ts         # TypeScript interfaces

raspberry-pi/              # Raspberry Pi collector (Python)
supabase/
└── schema.sql            # Database schema
```

## Key Files to Edit

1. **`src/lib/config.ts`** - Site name, coordinates, WeatherLink ID
2. **`.env.local`** - Supabase keys and API key
3. **`raspberry-pi/.env`** - Pi configuration

## Commands

```bash
npm run dev      # Start development server on :3000
npm run build    # Build for production
npm run lint     # Run ESLint
npm run type-check  # TypeScript type checking
```

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/current` | GET | None | Get current conditions + SQM history |
| `/api/ingest/data` | POST | Bearer token | Receive weather data from Pi |
| `/api/ingest/image` | POST | Bearer token | Receive AllSky image from Pi |
| `/api/allsky/latest.jpg` | GET | None | Serve latest AllSky image |

## Database Tables

- **`current_conditions`** - Single row with latest readings
- **`weather_readings`** - Historical time-series data

## Environment Variables

Required in `.env.local` and Vercel:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_KEY
INGEST_API_KEY
```

## Common Tasks

### Add a new condition indicator

1. Add the data field to `src/types/weather.ts`
2. Add helper functions to `src/lib/weatherHelpers.ts`
3. Add `<ConditionIndicator>` in `src/app/page.tsx`

### Change the refresh interval

Edit `refreshInterval` in `src/lib/config.ts` (milliseconds)

### Add a new data source on the Pi

1. Add a new reader function in `raspberry-pi/collector.py`
2. Start it as a daemon thread in `main()`
3. Call `data_store.update()` with the new values

## Debugging

- **Browser console** (F12) for frontend errors
- **Vercel logs** for API errors
- **`journalctl -u observatory-collector -f`** for Pi collector logs

## Mock Data

When Supabase isn't configured or there's no data, the `/api/current` endpoint returns mock data. This is useful for development.
