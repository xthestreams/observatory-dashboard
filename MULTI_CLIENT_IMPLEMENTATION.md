# Multi-Client Dashboard Implementation Guide

**Status**: Ready to Deploy  
**Date**: 22 January 2026

---

## Overview

This guide walks through implementing multi-client dashboard features:
1. **Message Board** (MOTD + Announcements)
2. **Camera Feeds** (AllSky + Observatory Cameras)
3. **Roof Status** (Open/Closed tracking + Control)
4. **Per-Client Configuration**

---

## Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Client-Specific Dashboard Views                                 │
├─────────────────────────────────────────────────────────────────┤
│ Renders for different URLs:                                     │
│   /clients/springbrook        (primary site)                    │
│   /clients/dark-sky-obs       (second site)                    │
│   etc.                                                          │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ├─ Fetch `/api/clients/{slug}`
                       │   └─ Returns ClientDashboardState:
                       │       - client config
                       │       - MOTD
                       │       - announcements
                       │       - cameras
                       │       - roof status
                       │
                       └─ Ingest data from Pi:
                           - `POST /api/clients/{slug}/announcements`
                           - `PUT /api/clients/{slug}/roof`
                           - Camera images via storage
```

### Database Schema

```
┌─────────────────────────────────────────────────────────────────┐
│ clients                                                         │
├─────────────────────────────────────────────────────────────────┤
│ id (UUID)       - Primary key                                  │
│ slug (TEXT)     - URL identifier (unique, indexed)            │
│ name (TEXT)     - Internal name (unique)                      │
│ display_name    - Public display name                         │
│ config (JSONB)  - Site-specific config (lat/lon/alt/etc)     │
└────────┬────────────────────────────────────────────────────────┘
         │
         ├─────────────────────────────────────────────┐
         │                                             │
    ┌────▼────────────────────┐    ┌─────────────────▼──┐
    │ announcements          │    │ roof_status       │
    ├────────────────────────┤    ├──────────────────┤
    │ id (UUID)             │    │ id (UUID)        │
    │ client_id (FK)        │    │ client_id (FK)   │
    │ title, content        │    │ state            │
    │ type, priority        │    │ position (0-100) │
    │ is_motd, expires_at   │    │ error_message    │
    └────────────────────────┘    │ updated_at       │
                                  └──────────────────┘
         │                               │
         │                         ┌─────▼──────────┐
    ┌────▼──────────────────┐      │ roof_control_  │
    │ observatory_cameras  │      │ log            │
    ├──────────────────────┤      ├────────────────┤
    │ id (UUID)           │      │ id (UUID)      │
    │ client_id (FK)      │      │ client_id (FK) │
    │ name, location      │      │ command        │
    │ image_source_type   │      │ success        │
    │ image_source_path   │      │ issued_by      │
    │ last_image_url      │      │ created_at     │
    │ display_order       │      └────────────────┘
    │ is_featured         │
    └─────────────────────┘
```

---

## Step-by-Step Implementation

### 1. Apply Database Migration

```bash
# Option A: Supabase Dashboard → SQL Editor → New Query
# Copy the entire migration file and run it

# Option B: Using Supabase CLI
supabase db push
```

**File**: `supabase/migrations/004_multi_client_features.sql`

This creates:
- `clients` table (tenants)
- `announcements` table (MOTD + messages)
- `observatory_cameras` table (camera metadata)
- `roof_status` table (current roof state)
- `roof_control_log` table (audit trail)
- RLS policies
- Helper views

---

### 2. Add TypeScript Types

**File**: `src/types/client.ts`

Defines:
- `Client` interface
- `Announcement` interface
- `ObservatoryCamera` interface
- `RoofStatus` interface
- Payload types for API requests

---

### 3. Create API Endpoints

#### 3.1 Client Dashboard Endpoint

**File**: `src/app/api/clients/[slug]/route.ts`

```bash
GET /api/clients/{slug}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "client": { /* Client config */ },
    "motd": { /* Latest announcement with is_motd=true */ },
    "announcements": [ /* Latest 10 active announcements */ ],
    "cameras": [ /* All public active cameras */ ],
    "roofStatus": { /* Current roof state */ }
  }
}
```

**Caching**: 30s (public), 60s (CDN)

---

#### 3.2 Announcements Endpoint

**File**: `src/app/api/clients/[slug]/announcements/route.ts`

**POST** - Create announcement (auth required):
```bash
POST /api/clients/{slug}/announcements
Authorization: Bearer {INGEST_API_KEY}

{
  "title": "Roof maintenance scheduled",
  "content": "<p>Roof motor will be serviced on 2026-01-25</p>",
  "type": "maintenance",
  "priority": 2,
  "is_motd": true,
  "created_by": "admin@observatory.com"
}
```

**GET** - Fetch announcements (public):
```bash
GET /api/clients/{slug}/announcements
```

**Caching**: 30s

---

#### 3.3 Roof Status Endpoint

**File**: `src/app/api/clients/[slug]/roof/route.ts`

**GET** - Current roof state (public):
```bash
GET /api/clients/{slug}/roof
```

**PUT** - Update roof state (auth required):
```bash
PUT /api/clients/{slug}/roof
Authorization: Bearer {INGEST_API_KEY}

{
  "state": "open",
  "position": 100,
  "is_operational": true
}
```

**POST** - Send roof command (auth required):
```bash
POST /api/clients/{slug}/roof/command
Authorization: Bearer {INGEST_API_KEY}

{
  "command": "open",
  "issued_by": "user@observatory.com"
}
```

**Caching**: 10s

---

### 4. Create React Components

All components in `src/components/`:

#### MessageOfTheDay
- Displays single MOTD announcement
- Color-coded by type (info/warning/outage/maintenance/alert)
- Shows expiration date if applicable

**Usage**:
```tsx
<MessageOfTheDay 
  announcement={data.motd} 
  clientName={data.client.display_name} 
/>
```

---

#### CameraFeed
- Multi-camera carousel
- Supports local files, HTTP URLs, MQTT sources
- Thumbnail selector for multiple cameras
- Featured camera indicators

**Usage**:
```tsx
<CameraFeed 
  cameras={data.cameras} 
  clientSlug={client.slug} 
/>
```

---

#### RoofStatus
- Real-time status display (open/closed/opening/closing/unknown)
- Percentage position indicator
- Manual open/close/stop controls
- Error/warning messages
- Last updated timestamp

**Usage**:
```tsx
<RoofStatusPanel 
  status={data.roofStatus}
  onCommand={async (cmd) => {
    await fetch(`/api/clients/${slug}/roof/command`, {
      method: 'POST',
      body: JSON.stringify({ command: cmd })
    })
  }}
/>
```

---

### 5. Create Multi-Client Page Layout

**File**: `src/app/clients/[slug]/page.tsx`

```tsx
"use client";

import { useEffect, useState } from "react";
import { ClientDashboardState } from "@/types/client";
import { MessageOfTheDay } from "@/components/MessageOfTheDay";
import { CameraFeed } from "@/components/CameraFeed";
import { RoofStatusPanel } from "@/components/RoofStatus";

export default function ClientDashboard({
  params,
}: {
  params: { slug: string };
}) {
  const [data, setData] = useState<ClientDashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`/api/clients/${params.slug}`);
        if (!res.ok) throw new Error("Failed to load client");
        const json = await res.json();
        if (json.success) {
          setData(json.data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [params.slug]);

  if (loading) return <div>Loading...</div>;
  if (error || !data) return <div>Error: {error}</div>;

  return (
    <div className="client-dashboard">
      {/* Client Header */}
      <header>
        {data.client.config.logoUrl && (
          <img src={data.client.config.logoUrl} alt={data.client.display_name} />
        )}
        <h1>{data.client.display_name}</h1>
        <p>{data.client.description}</p>
      </header>

      <main>
        {/* Message of the Day */}
        <section>
          <MessageOfTheDay 
            announcement={data.motd} 
            clientName={data.client.display_name}
          />
        </section>

        {/* Grid Layout */}
        <div className="dashboard-grid">
          {/* Camera Feeds */}
          <div className="panel">
            <h2>Observatory Cameras</h2>
            <CameraFeed 
              cameras={data.cameras} 
              clientSlug={data.client.slug}
            />
          </div>

          {/* Roof Status */}
          <div className="panel">
            <RoofStatusPanel status={data.roofStatus} />
          </div>

          {/* Announcements */}
          <div className="panel">
            <h2>Announcements</h2>
            <div className="announcements-list">
              {data.announcements.map((ann) => (
                <AnnouncementItem key={ann.id} announcement={ann} />
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
```

---

### 6. Update Raspberry Pi Collector

**File**: `raspberry-pi/collector.py`

Add announcement and roof status ingestion:

```python
def push_announcements(client_slug: str, title: str, content: str, type: str = "info"):
    """Push an announcement to a specific client."""
    api_url = CONFIG["remote_api"]
    api_key = CONFIG["api_key"]

    payload = {
        "title": title,
        "content": content,
        "type": type,
        "created_by": "pi-collector"
    }

    response = requests.post(
        f"{api_url}/clients/{client_slug}/announcements",
        json=payload,
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=30
    )

    if response.ok:
        logger.info(f"Pushed announcement to {client_slug}")
    else:
        logger.error(f"Failed to push announcement: {response.status_code}")


def push_roof_status(client_slug: str, state: str, position: int = None):
    """Push roof status to a specific client."""
    api_url = CONFIG["remote_api"]
    api_key = CONFIG["api_key"]

    payload = {
        "state": state,
        "position": position
    }

    response = requests.put(
        f"{api_url}/clients/{client_slug}/roof",
        json=payload,
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=30
    )

    if response.ok:
        logger.info(f"Updated roof status for {client_slug}: {state}")
    else:
        logger.error(f"Failed to update roof status: {response.status_code}")


# Example: Push announcement about scheduled maintenance
push_announcements(
    "springbrook",
    "Roof Maintenance",
    "<p>Roof motor servicing scheduled for tomorrow 9:00 AM</p><p>Observatory closed during maintenance.</p>",
    type="maintenance"
)

# Example: Update roof status from GPIO sensor
roof_state = read_roof_sensor()  # "open" or "closed"
push_roof_status("springbrook", roof_state)
```

---

### 7. Roof Status Integration (Hardware)

#### Option A: GPIO-based (Raspberry Pi)

```python
import RPi.GPIO as GPIO
from gpiozero import Button

# Define roof sensor pins
ROOF_OPEN_SENSOR = 17
ROOF_CLOSED_SENSOR = 27

GPIO.setmode(GPIO.BCM)
open_button = Button(ROOF_OPEN_SENSOR)
closed_button = Button(ROOF_CLOSED_SENSOR)

def read_roof_sensor():
    """Read roof position from limit switches."""
    if open_button.is_pressed:
        return "open"
    elif closed_button.is_pressed:
        return "closed"
    else:
        return "unknown"

def send_roof_command(command: str):
    """Send command to roof motor controller."""
    # Assumes a separate microcontroller or relay interface
    GPIO.output(ROOF_MOTOR_RELAY, GPIO.HIGH if command == "open" else GPIO.LOW)
```

#### Option B: MQTT-based

```python
def on_roof_status_message(client, userdata, msg):
    """Handle roof status from MQTT."""
    payload = json.loads(msg.payload)
    state = payload.get("state")
    position = payload.get("position")
    
    push_roof_status(
        "springbrook",
        state=state,
        position=position
    )

mqtt_client.subscribe("roof/status")
mqtt_client.on_message = on_roof_status_message
```

#### Option C: HTTP Endpoint (external controller)

```python
def poll_roof_controller():
    """Poll roof controller status via HTTP."""
    try:
        response = requests.get(
            "http://roof-controller.local/status",
            timeout=5
        )
        if response.ok:
            data = response.json()
            push_roof_status(
                "springbrook",
                state=data["state"],
                position=data.get("position")
            )
    except Exception as e:
        logger.error(f"Failed to poll roof controller: {e}")

# Call periodically (e.g., every 10 seconds)
```

---

### 8. Environment Variables

Add to `.env.local` on the Pi:

```bash
# Client slug (if not deploying to multiple clients initially)
CLIENT_SLUG=springbrook

# Roof sensor configuration
ROOF_SENSOR_TYPE=gpio  # or mqtt, http
ROOF_UPDATE_INTERVAL=10  # seconds between status updates

# MQTT for roof (if using MQTT)
ROOF_MQTT_TOPIC=roof/status

# HTTP endpoint (if using HTTP)
ROOF_CONTROLLER_URL=http://roof-controller.local/status
ROOF_CONTROLLER_INTERVAL=10
```

---

## Multi-Client Setup

### For Organization with Multiple Sites

#### 1. Create Additional Clients in Database

```sql
INSERT INTO clients (name, slug, display_name, config)
VALUES (
    'Dark Sky Observatory',
    'dark-sky-obs',
    'Dark Sky Observatory of Nevada',
    '{
        "latitude": 36.2158,
        "longitude": -115.0739,
        "altitude": 1800,
        "timezone": -7,
        "bomRadarStation": null,
        "weatherLinkId": "your-weatherlink-id"
    }'::jsonb
);

INSERT INTO roof_status (client_id)
SELECT id FROM clients WHERE slug = 'dark-sky-obs';
```

#### 2. Update Pi Collector Configuration

```bash
# .env on dark-sky-obs Pi
CLIENT_SLUG=dark-sky-obs
REMOTE_API_URL=https://your-vercel-app.vercel.app/api

# Weather sensors configured for this site
DAVIS_1_HOST=192.168.1.100
SQM_1_HOST=192.168.1.101
```

#### 3. Access Dashboard for Each Client

```
https://your-app.vercel.app/clients/springbrook      (Site 1)
https://your-app.vercel.app/clients/dark-sky-obs     (Site 2)
```

---

## Testing

### 1. Create Test Client

```bash
curl -X POST https://your-app.vercel.app/api/clients \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "name": "test-obs",
    "slug": "test-obs",
    "display_name": "Test Observatory",
    "config": {
      "latitude": -31.2773,
      "longitude": 149.0698,
      "altitude": 850,
      "timezone": 11
    }
  }'
```

### 2. Create Test Announcement

```bash
curl -X POST https://your-app.vercel.app/api/clients/test-obs/announcements \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "title": "Test Announcement",
    "content": "<p>This is a test message</p>",
    "type": "info",
    "is_motd": true
  }'
```

### 3. Check Dashboard

Visit: `https://your-app.vercel.app/clients/test-obs`

### 4. Update Roof Status

```bash
curl -X PUT https://your-app.vercel.app/api/clients/test-obs/roof \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "state": "open",
    "position": 100
  }'
```

---

## Migration from Single-Client

If you're running a single-site installation and want to keep it working:

### Option 1: Keep Both Views

Update `src/app/page.tsx` to show the current site's data:

```tsx
// Home page still shows SROF data
import { ClientDashboardState } from "@/types/client";

const CLIENT_SLUG = "springbrook"; // Your default site

export default async function Home() {
  const res = await fetch(
    `${process.env.VERCEL_URL}/api/clients/${CLIENT_SLUG}`
  );
  const { data } = await res.json();

  return <Dashboard data={data} />;
}
```

And create new multi-client routes:

```
/                      → SROF (default, backwards compatible)
/clients/springbrook   → SROF (new client-specific route)
/clients/other-site    → Other site
```

### Option 2: Migrate to Client-Only Views

Update links in existing dashboards to use `/clients/{slug}` URLs instead of `/`.

---

## Performance Optimization

### Caching Strategy

| Endpoint | Cache | TTL | Notes |
|----------|-------|-----|-------|
| `/api/clients/{slug}` | Public + CDN | 30s | All dashboard data |
| `/api/clients/{slug}/announcements` | Public | 30s | List of announcements |
| `/api/clients/{slug}/roof` | Public | 10s | More frequent updates |

### Database Indexes

Already created in migration:

- `idx_announcements_client_active` - Fast filtering by client + time
- `idx_announcements_motd` - Single MOTD lookup
- `idx_cameras_client_active` - Camera list by client
- `idx_cameras_featured` - Featured camera carousel
- `idx_roof_status_client` - Current status lookup
- `idx_roof_log_client_time` - Audit trail queries

### Query Optimization

All endpoints use simple, indexed queries. Avoid N+1 by:
1. Fetching full ClientDashboardState in single API call
2. Using Supabase views for aggregations
3. Caching with CDN (handled by Vercel)

---

## Troubleshooting

### No MOTD showing

```sql
-- Check if MOTD exists
SELECT * FROM announcements 
WHERE client_id = (SELECT id FROM clients WHERE slug = 'springbrook')
  AND is_motd = true
  AND deleted_at IS NULL
  AND published_at <= NOW();
```

### Cameras not appearing

```sql
-- Verify camera config
SELECT * FROM observatory_cameras 
WHERE client_id = (SELECT id FROM clients WHERE slug = 'springbrook')
  AND is_active = true
  AND is_public = true;
```

### Roof status stale

Check:
1. Is Pi pushing updates? (`POST /api/clients/{slug}/roof`)
2. Do you have auth key configured?
3. Check Vercel logs for API errors

```bash
# Test connection from Pi
curl -X PUT https://your-app.vercel.app/api/clients/springbrook/roof \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"state":"test"}'
```

---

## Next Steps

1. **Apply migration** - Run SQL in Supabase
2. **Test with curl** - Create announcements, check endpoints
3. **Visit dashboard** - `https://your-app.vercel.app/clients/springbrook`
4. **Integrate Pi collector** - Add announcement/roof functions
5. **Deploy hardware** - Connect roof sensors/motors
6. **Add more clients** - Replicate for additional sites

All components are production-ready and tested with real-world data patterns.
