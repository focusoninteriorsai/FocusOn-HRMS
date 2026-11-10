// FOCUSON HRMS - Google Maps Platform Integration
// Interactive geofence map with AdvancedMarkerElement, Circle overlay, and quota defense.

import { Loader } from '@googlemaps/js-api-loader';

let mapsLoader = null;
let mapsApiKey = null;

// Initialize Quota Defense Error Handlers (Tier 1 Global Level)
export function initMapsQuotaDefense() {
  window.gm_authFailure = () => {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  };

  const origError = console.error;
  console.error = (...args) => {
    origError.apply(console, args);
    const msg = args.map(a => String(a)).join(' ');
    if (msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError')) {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    }
  };

  window.addEventListener('gmp-quota-exceeded', () => {
    let banner = document.getElementById('gmp-quota-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'gmp-quota-banner';
      banner.className = 'gmp-quota-banner';
      banner.style.cssText = 'background-color: #fffbeb; border-bottom: 1px solid #fde68a; color: #78350f; padding: 10px 16px; font-size: 0.8125rem; text-align: center; position: sticky; top: 0; z-index: 9999; box-shadow: 0 1px 2px rgba(0,0,0,0.05);';
      banner.innerHTML = `
        <span>
          Google Maps Platform quota reached. If you are the app owner, visit 
          <a href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors" target="_blank" rel="noopener noreferrer" style="text-decoration: underline; font-weight: 600; color: #451a03;">
            maps developer site
          </a> for instructions to update your account.
        </span>
      `;
      document.body.prepend(banner);
    }
  });
}

export async function getMapsApiKey() {
  if (mapsApiKey) return mapsApiKey;
  try {
    const configRes = await fetch('./firebase-applet-config.json');
    if (configRes.ok) {
      const cfg = await configRes.json();
      if (cfg.apiKey) {
        mapsApiKey = cfg.apiKey;
        return mapsApiKey;
      }
    }
  } catch (e) {}

  mapsApiKey = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GOOGLE_MAPS_API_KEY) || '';
  return mapsApiKey;
}

export async function loadGoogleMaps() {
  const apiKey = await getMapsApiKey();
  if (!apiKey) {
    throw new Error('Google Maps API Key is not configured.');
  }

  if (!mapsLoader) {
    mapsLoader = new Loader({
      apiKey: apiKey,
      version: 'weekly',
      libraries: ['maps', 'marker'],
      language: 'en'
    });
  }

  return mapsLoader.load();
}

/**
 * Mounts an interactive Geofence Verification map inside target container.
 */
export async function renderGeofenceMap(mapElement, userLat, userLng, officeLat = 28.6139, officeLng = 77.2090, radiusMeters = 150) {
  await loadGoogleMaps();

  const { Map, Circle } = await google.maps.importLibrary('maps');
  const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary('marker');

  const centerPos = { lat: userLat || officeLat, lng: userLng || officeLng };

  const map = new Map(mapElement, {
    center: centerPos,
    zoom: 17,
    mapId: 'DEMO_MAP_ID', // Mandatory for AdvancedMarkerElement
    disableDefaultUI: false,
    zoomControl: true,
    streetViewControl: false,
    mapTypeControl: false,
    internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio']
  });

  // Office Geofence Circle
  const officeCircle = new Circle({
    strokeColor: '#2563eb',
    strokeOpacity: 0.8,
    strokeWeight: 2,
    fillColor: '#3b82f6',
    fillOpacity: 0.2,
    map: map,
    center: { lat: officeLat, lng: officeLng },
    radius: radiusMeters
  });

  // Office Advanced Marker
  const officePin = new PinElement({
    glyph: '🏢',
    background: '#1d4ed8',
    borderColor: '#ffffff',
    glyphColor: '#ffffff'
  });

  new AdvancedMarkerElement({
    map: map,
    position: { lat: officeLat, lng: officeLng },
    title: 'Registered Office Boundary',
    content: officePin.element
  });

  // User Current Location Marker (if provided)
  if (userLat && userLng) {
    const userPin = new PinElement({
      glyph: '📍',
      background: '#059669',
      borderColor: '#ffffff',
      glyphColor: '#ffffff'
    });

    new AdvancedMarkerElement({
      map: map,
      position: { lat: userLat, lng: userLng },
      title: 'Your Current GPS Location',
      content: userPin.element
    });
  }

  return map;
}
