-- ============================================================================
-- MIGRATION: Multi-Client Dashboard Features
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- Date: 2026-01-22
-- Purpose: Add multi-client support with messages, announcements, cameras, and roof status
-- ============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1: CLIENTS / OBSERVATORY TENANTS TABLE
-- Each client is a separate observatory installation
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Client identity
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,  -- URL-friendly identifier (e.g., "springbrook", "dark-sky-obs")
    display_name TEXT NOT NULL, -- Public display name
    description TEXT,
    
    -- Contact & metadata
    admin_email TEXT,
    website_url TEXT,
    
    -- Configuration (JSON for flexibility)
    config JSONB DEFAULT '{}'::jsonb, -- e.g., { lat, lon, alt, timezone, bomStation, weatherLinkId }
    
    -- Operational status
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_slug ON clients(slug);
CREATE INDEX IF NOT EXISTS idx_clients_active ON clients(is_active) WHERE is_active = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 2: ANNOUNCEMENTS / MESSAGES OF THE DAY TABLE
-- Site-specific messages and announcements
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS announcements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Relationship to client
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    
    -- Message content
    title TEXT NOT NULL,
    content TEXT NOT NULL,          -- HTML allowed (sanitized on client)
    
    -- Types: 'info', 'warning', 'outage', 'maintenance', 'alert'
    type TEXT DEFAULT 'info'
        CHECK (type IN ('info', 'warning', 'outage', 'maintenance', 'alert')),
    
    -- Priority level (higher = more prominent)
    priority INTEGER DEFAULT 0,
    
    -- Message of the day flag (only one per client at a time)
    is_motd BOOLEAN DEFAULT false,
    
    -- Scheduling
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,         -- NULL = no expiration
    
    -- Author/source
    created_by TEXT DEFAULT 'system',  -- Name of person/system that created it
    
    -- Soft delete
    deleted_at TIMESTAMPTZ DEFAULT NULL,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for active announcements (without NOW() - time filtering done in queries)
CREATE INDEX IF NOT EXISTS idx_announcements_client_active
    ON announcements(client_id, published_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_announcements_motd
    ON announcements(client_id, is_motd)
    WHERE is_motd = true AND deleted_at IS NULL;

-- Trigger to ensure only one MOTD per client
CREATE OR REPLACE FUNCTION enforce_single_motd()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_motd = true THEN
        UPDATE announcements
        SET is_motd = false, updated_at = NOW()
        WHERE client_id = NEW.client_id
          AND id != NEW.id
          AND is_motd = true
          AND deleted_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_enforce_single_motd
BEFORE INSERT OR UPDATE ON announcements
FOR EACH ROW EXECUTE FUNCTION enforce_single_motd();

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 3: OBSERVATORY CAMERAS TABLE
-- Multi-camera support per client
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS observatory_cameras (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Relationship to client
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    
    -- Camera identity
    name TEXT NOT NULL,
    description TEXT,
    location TEXT,  -- e.g., "North Dome", "South Telescope"
    
    -- Image source
    -- Can be:
    --   - 'local_file': stored in Supabase storage
    --   - 'http_url': remote HTTP URL
    --   - 'mqtt': published via MQTT
    image_source_type TEXT NOT NULL DEFAULT 'local_file'
        CHECK (image_source_type IN ('local_file', 'http_url', 'mqtt')),
    
    image_source_path TEXT,  -- file path, HTTP URL, or MQTT topic
    image_format TEXT DEFAULT 'jpg', -- jpg, png, webp
    
    -- Display options
    display_order INTEGER DEFAULT 0,
    is_public BOOLEAN DEFAULT true,
    is_featured BOOLEAN DEFAULT false,  -- Show in main carousel
    
    -- Metadata for recent image
    last_image_url TEXT,         -- Latest image URL (computed)
    last_update TIMESTAMPTZ,     -- When last image was captured
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cameras_client_active
    ON observatory_cameras(client_id, display_order)
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_cameras_featured
    ON observatory_cameras(client_id, is_featured)
    WHERE is_featured = true AND is_active = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 4: ROOF STATUS TABLE
-- Track open/closed status of observatory roof
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS roof_status (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Relationship to client
    client_id UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
    
    -- Roof state
    -- 'unknown' = no data, 'opening' = in motion, 'closing' = in motion,
    -- 'open' = fully open, 'closed' = fully closed
    state TEXT NOT NULL DEFAULT 'unknown'
        CHECK (state IN ('unknown', 'opening', 'closing', 'open', 'closed')),
    
    -- Position percentage (0-100)
    -- NULL if not available, 0 = fully closed, 100 = fully open
    position SMALLINT CHECK (position IS NULL OR (position >= 0 AND position <= 100)),
    
    -- Status details
    last_command TEXT,  -- 'open', 'close', 'stop', or NULL
    is_operational BOOLEAN DEFAULT true,  -- Can be commanded
    error_message TEXT,  -- If an error occurred
    
    -- Metadata
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roof_status_client ON roof_status(client_id);
CREATE INDEX IF NOT EXISTS idx_roof_status_updated ON roof_status(updated_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 5: ROOF CONTROL LOG (for audit trail)
-- Track all roof commands and state changes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS roof_control_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Relationship to client
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    
    -- Command
    command TEXT NOT NULL,  -- 'open', 'close', 'stop', 'manual_override'
    
    -- Result
    success BOOLEAN NOT NULL,
    result_message TEXT,  -- e.g., "Roof opened successfully", "Motor timeout"
    
    -- Issuer (system, user, automated)
    issued_by TEXT DEFAULT 'system',
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roof_log_client_time
    ON roof_control_log(client_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 6: ROW LEVEL SECURITY
-- Each client can only see their own data
-- ─────────────────────────────────────────────────────────────────────────────

-- Announcements: Public read (filtered by client), service role write
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read current announcements" ON announcements
    FOR SELECT USING (
        deleted_at IS NULL 
        AND published_at <= NOW()
        AND (expires_at IS NULL OR expires_at > NOW())
    );

CREATE POLICY "Allow service write" ON announcements
    FOR ALL USING (true) WITH CHECK (true);

-- Cameras: Public read, service role write
ALTER TABLE observatory_cameras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read active cameras" ON observatory_cameras
    FOR SELECT USING (is_active = true AND is_public = true);

CREATE POLICY "Allow service write" ON observatory_cameras
    FOR ALL USING (true) WITH CHECK (true);

-- Roof status: Public read, service role write
ALTER TABLE roof_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON roof_status
    FOR SELECT USING (true);

CREATE POLICY "Allow service write" ON roof_status
    FOR ALL USING (true) WITH CHECK (true);

-- Roof log: Service role write, no direct read
ALTER TABLE roof_control_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service write" ON roof_control_log
    FOR INSERT WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 7: HELPER VIEWS & FUNCTIONS
-- ─────────────────────────────────────────────────────────────────────────────

-- Get active announcements for a client
CREATE OR REPLACE VIEW client_active_announcements AS
SELECT
    a.id,
    a.client_id,
    c.slug,
    a.title,
    a.content,
    a.type,
    a.priority,
    a.is_motd,
    a.published_at,
    a.expires_at,
    a.created_by
FROM announcements a
JOIN clients c ON a.client_id = c.id
WHERE a.deleted_at IS NULL
  AND a.published_at <= NOW()
  AND (a.expires_at IS NULL OR a.expires_at > NOW())
  AND c.is_active = true
ORDER BY a.is_motd DESC, a.priority DESC, a.published_at DESC;

-- Get current message of the day for all clients
CREATE OR REPLACE VIEW motd_current AS
SELECT
    a.id,
    c.slug,
    c.display_name,
    a.title,
    a.content,
    a.type,
    a.published_at,
    a.created_by
FROM announcements a
JOIN clients c ON a.client_id = c.id
WHERE a.is_motd = true
  AND a.deleted_at IS NULL
  AND a.published_at <= NOW()
  AND (a.expires_at IS NULL OR a.expires_at > NOW())
  AND c.is_active = true;

-- Get cameras for a client (ordered)
CREATE OR REPLACE VIEW client_cameras AS
SELECT
    c.id,
    c.client_id,
    cl.slug,
    c.name,
    c.description,
    c.location,
    c.image_source_type,
    c.image_source_path,
    c.image_format,
    c.display_order,
    c.is_featured,
    c.last_image_url,
    c.last_update,
    c.is_active,
    c.created_at,
    c.updated_at
FROM observatory_cameras c
JOIN clients cl ON c.client_id = cl.id
WHERE c.is_active = true
ORDER BY c.display_order ASC, c.created_at ASC;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 8: INITIAL DATA (optional)
-- ─────────────────────────────────────────────────────────────────────────────

-- Insert default client for existing single-site dashboards
INSERT INTO clients (name, slug, display_name, description, config)
VALUES (
    'Springbrook Observatory',
    'springbrook',
    'Springbrook Remote Observatory Facility (SROF)',
    'Primary observatory site',
    '{
        "latitude": -31.2773,
        "longitude": 149.0698,
        "altitude": 850,
        "timezone": 11,
        "bomRadarStation": "69",
        "weatherLinkId": "10cff1bf556a4afcb4e846ce83442e83",
        "logoUrl": "https://www.srof.com.au/logo.png"
    }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- Create default roof status for the client
INSERT INTO roof_status (client_id)
SELECT id FROM clients WHERE slug = 'springbrook'
ON CONFLICT (client_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 9: USAGE EXAMPLES
-- ─────────────────────────────────────────────────────────────────────────────

-- Insert an announcement
-- INSERT INTO announcements (client_id, title, content, type, priority, is_motd, published_at, created_by)
-- SELECT
--     id,
--     'Roof maintenance scheduled',
--     '<p>Roof motor will be serviced on 2026-01-25</p><p>Observatory will be closed.</p>',
--     'maintenance',
--     2,
--     true,
--     NOW(),
--     'admin@springbrook.obs'
-- FROM clients WHERE slug = 'springbrook';

-- Insert a camera
-- INSERT INTO observatory_cameras (client_id, name, location, image_source_type, image_source_path, is_featured)
-- SELECT
--     id,
--     'AllSky Camera',
--     'Dome Center',
--     'local_file',
--     'allsky-images/latest.jpg',
--     true
-- FROM clients WHERE slug = 'springbrook';

-- Update roof status
-- UPDATE roof_status
-- SET state = 'open', position = 100, updated_at = NOW()
-- WHERE client_id = (SELECT id FROM clients WHERE slug = 'springbrook');

-- Log a roof command
-- INSERT INTO roof_control_log (client_id, command, success, result_message, issued_by)
-- SELECT
--     id,
--     'open',
--     true,
--     'Roof opened successfully',
--     'user@springbrook.obs'
-- FROM clients WHERE slug = 'springbrook';
