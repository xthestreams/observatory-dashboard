/**
 * Observatory Dashboard Configuration
 *
 * Edit these values to match your observatory setup.
 */

export const siteConfig = {
  // Your observatory name
  siteName: "My Observatory",
  siteSubtitle: "Site Meteo & Telemetry",

  // Your location (for Clear Outside forecast)
  latitude: -31.29,
  longitude: 149.09,

  // Bureau of Meteorology satellite image
  // Find your region at: http://www.bom.gov.au/australia/satellite/
  bomSatelliteUrl: "http://www.bom.gov.au/gms/IDE00005.gif",

  // WeatherLink embed ID (from your Davis weather station)
  // Get this from: https://www.weatherlink.com/embeddablePage/
  // Set to null to show local weather data instead
  weatherLinkId: "10cff1bf556a4afcb4e846ce83442e83",

  // How often to refresh data (milliseconds)
  refreshInterval: 30000, // 30 seconds
};
