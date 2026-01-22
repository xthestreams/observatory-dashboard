/**
 * Multi-Client Dashboard Types
 */

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT / TENANT TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ClientConfig {
  latitude: number;
  longitude: number;
  altitude: number;
  timezone: number;
  bomRadarStation?: string;
  weatherLinkId?: string | null;
  logoUrl?: string | null;
  [key: string]: unknown;
}

export interface Client {
  id: string;
  name: string;
  slug: string;
  display_name: string;
  description?: string;
  admin_email?: string;
  website_url?: string;
  config: ClientConfig;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ANNOUNCEMENT / MESSAGE OF THE DAY TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type AnnouncementType = "info" | "warning" | "outage" | "maintenance" | "alert";

export interface Announcement {
  id: string;
  client_id: string;
  title: string;
  content: string;
  type: AnnouncementType;
  priority: number;
  is_motd: boolean;
  published_at: string;
  expires_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AnnouncementWithClient extends Announcement {
  client_slug: string;
  client_display_name: string;
}

export interface CreateAnnouncementPayload {
  title: string;
  content: string;
  type?: AnnouncementType;
  priority?: number;
  is_motd?: boolean;
  published_at?: string;
  expires_at?: string | null;
  created_by?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CAMERA TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type CameraSourceType = "local_file" | "http_url" | "mqtt";

export interface ObservatoryCamera {
  id: string;
  client_id: string;
  name: string;
  description?: string;
  location?: string;
  image_source_type: CameraSourceType;
  image_source_path: string;
  image_format: string;
  display_order: number;
  is_public: boolean;
  is_featured: boolean;
  last_image_url?: string;
  last_update?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ObservatoryCameraWithClient extends ObservatoryCamera {
  client_slug: string;
}

export interface CreateCameraPayload {
  name: string;
  description?: string;
  location?: string;
  image_source_type: CameraSourceType;
  image_source_path: string;
  image_format?: string;
  display_order?: number;
  is_public?: boolean;
  is_featured?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOF STATUS TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type RoofState = "unknown" | "opening" | "closing" | "open" | "closed";
export type RoofCommand = "open" | "close" | "stop" | "manual_override";

export interface RoofStatus {
  id: string;
  client_id: string;
  state: RoofState;
  position: number | null;  // 0-100 percentage
  last_command: RoofCommand | null;
  is_operational: boolean;
  error_message?: string;
  updated_at: string;
  created_at: string;
}

export interface RoofStatusWithClient extends RoofStatus {
  client_slug: string;
}

export interface RoofControlLogEntry {
  id: string;
  client_id: string;
  command: RoofCommand;
  success: boolean;
  result_message?: string;
  issued_by: string;
  created_at: string;
}

export interface UpdateRoofStatusPayload {
  state?: RoofState;
  position?: number | null;
  last_command?: RoofCommand | null;
  is_operational?: boolean;
  error_message?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT-SPECIFIC DASHBOARD STATE
// ─────────────────────────────────────────────────────────────────────────────

export interface ClientDashboardState {
  client: Client;
  motd: Announcement | null;
  announcements: Announcement[];
  cameras: ObservatoryCamera[];
  roofStatus: RoofStatus;
}

export interface ClientDashboardResponse {
  success: boolean;
  data?: ClientDashboardState;
  error?: string;
}
