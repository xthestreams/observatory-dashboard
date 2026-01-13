/**
 * Observatory Dashboard Configuration
 *
 * Edit these values to match your observatory setup.
 */

export const siteConfig = {
  // ═══════════════════════════════════════════════════════════════════════════
  // OBSERVATORY IDENTITY
  // ═══════════════════════════════════════════════════════════════════════════

  // Your observatory name
  siteName: "SROF Observatory",
  siteSubtitle: "Site Meteo & Telemetry",

  // Observatory logo URL (optional)
  // Can be a path to an image in /public (e.g., "/logo.png")
  // or an external URL. Set to null to show default telescope icon.
  logoUrl: null as string | null,

  // Minor Planet Center (MPC) observatory code(s)
  // Find your code at: https://minorplanetcenter.net/iau/lists/ObsCodesF.html
  // Can be a single code or array for multiple telescopes/locations
  // Set to empty array [] if not registered with MPC
  mpcCodes: ["E09"] as string[],

  // ═══════════════════════════════════════════════════════════════════════════
  // GEOGRAPHIC LOCATION
  // ═══════════════════════════════════════════════════════════════════════════

  // Observatory coordinates (decimal degrees)
  // Used for astronomy calculations, weather product selection, and forecasts
  latitude: -31.2773,
  longitude: 149.0698,

  // Altitude in meters above sea level
  // Used for atmospheric calculations and displayed (rounded) on dashboard
  altitude: 850,

  // Timezone offset from UTC (e.g., +11 for AEDT, +10 for AEST)
  // Used for sun/moon calculations
  timezone: 11,

  // ═══════════════════════════════════════════════════════════════════════════
  // WEATHER DATA SOURCES
  // ═══════════════════════════════════════════════════════════════════════════

  // Bureau of Meteorology radar station code
  // Set to "auto" to automatically select nearest station based on location
  // Or specify manually: 71=Sydney, 66=Brisbane, 02=Melbourne, 70=Perth, 64=Adelaide
  // Set to empty string "" to disable radar imagery
  // Find stations at: https://www.bom.gov.au/australia/radar/
  bomRadarStation: "69",

  // Bureau of Meteorology satellite image (legacy - now using SatellitePanel)
  bomSatelliteUrl: "http://www.bom.gov.au/gms/IDE00005.gif",

  // WeatherLink embed ID (from your Davis weather station)
  // Get this from: https://www.weatherlink.com/embeddablePage/
  // Set to null to show local weather data instead
  weatherLinkId: "10cff1bf556a4afcb4e846ce83442e83",

  // ═══════════════════════════════════════════════════════════════════════════
  // DISPLAY OPTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  // How often to refresh data (milliseconds)
  refreshInterval: 30000, // 30 seconds

  // Privacy: round altitude to nearest N meters when displayed publicly
  // e.g., 1000 rounds 1165m to "~1000m"
  altitudeRounding: 100,
};

// ═══════════════════════════════════════════════════════════════════════════
// BOM RADAR STATION AUTO-SELECTION
// ═══════════════════════════════════════════════════════════════════════════

// Australian BOM radar stations with coordinates
const BOM_RADAR_STATIONS = [
  { code: "71", name: "Sydney (Terrey Hills)", lat: -33.701, lon: 151.21 },
  { code: "03", name: "Sydney (Wollongong)", lat: -34.262, lon: 150.875 },
  { code: "04", name: "Sydney (Newcastle)", lat: -32.73, lon: 151.804 },
  { code: "66", name: "Brisbane (Mt Stapylton)", lat: -27.718, lon: 153.24 },
  { code: "50", name: "Brisbane (Marburg)", lat: -27.608, lon: 152.539 },
  { code: "02", name: "Melbourne", lat: -37.855, lon: 144.756 },
  { code: "70", name: "Perth (Serpentine)", lat: -32.392, lon: 115.867 },
  { code: "64", name: "Adelaide (Buckland Park)", lat: -34.617, lon: 138.469 },
  { code: "63", name: "Darwin (Berrimah)", lat: -12.457, lon: 130.927 },
  { code: "76", name: "Hobart (Mt Koonya)", lat: -43.112, lon: 147.806 },
  { code: "67", name: "Canberra (Captains Flat)", lat: -35.66, lon: 149.512 },
  { code: "68", name: "Cairns (Saddle Mountain)", lat: -16.817, lon: 145.683 },
  { code: "69", name: "Townsville (Hervey Range)", lat: -19.42, lon: 146.55 },
  { code: "53", name: "Alice Springs", lat: -23.796, lon: 133.889 },
  { code: "28", name: "Grafton (Mt Kanighan)", lat: -29.622, lon: 152.951 },
  { code: "05", name: "Tamworth (Namoi)", lat: -31.024, lon: 150.192 },
  { code: "40", name: "Coffs Harbour (Dorrigo)", lat: -30.327, lon: 152.947 },
  { code: "55", name: "Wagga Wagga", lat: -35.166, lon: 147.466 },
  { code: "94", name: "Hillston", lat: -33.551, lon: 145.528 },
  { code: "95", name: "Yeoval", lat: -32.753, lon: 148.654 },
  { code: "96", name: "Brewarrina (Nyngan)", lat: -31.463, lon: 146.426 },
  { code: "97", name: "Moree", lat: -29.5, lon: 149.85 },
];

/**
 * Calculate distance between two coordinates using Haversine formula
 */
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Get the nearest BOM radar station code based on observatory location
 */
export function getNearestRadarStation(): string {
  if (siteConfig.bomRadarStation !== "auto") {
    return siteConfig.bomRadarStation;
  }

  let nearest = BOM_RADAR_STATIONS[0];
  let minDist = Infinity;

  for (const station of BOM_RADAR_STATIONS) {
    const dist = haversineDistance(
      siteConfig.latitude,
      siteConfig.longitude,
      station.lat,
      station.lon
    );
    if (dist < minDist) {
      minDist = dist;
      nearest = station;
    }
  }

  return nearest.code;
}

/**
 * Get radar station info by code
 */
export function getRadarStationInfo(
  code: string
): { code: string; name: string } | null {
  const station = BOM_RADAR_STATIONS.find((s) => s.code === code);
  return station ? { code: station.code, name: station.name } : null;
}

/**
 * Get formatted location string for display (with privacy rounding)
 */
export function getDisplayLocation(): {
  latitude: string;
  longitude: string;
  altitude: string;
} {
  // Round altitude to nearest configured value
  const roundedAlt =
    Math.round(siteConfig.altitude / siteConfig.altitudeRounding) *
    siteConfig.altitudeRounding;

  return {
    latitude: siteConfig.latitude.toFixed(2) + "°",
    longitude: siteConfig.longitude.toFixed(2) + "°",
    altitude: `~${roundedAlt}m`,
  };
}
