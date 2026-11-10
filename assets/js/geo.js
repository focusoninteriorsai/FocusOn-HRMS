// FOCUSON HRMS - Geolocation Utility
// Accurately queries browser GPS with timeout, accuracy threshold, and error formatting.
// Mitigations for browser limitation: sends lat, lng, accuracy, timestamp to server for Haversine verification.

export function getBrowserLocation(options = {}) {
  const {
    enableHighAccuracy = true,
    timeout = 15000,
    maximumAge = 0
  } = options;

  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject({
        code: 'GEO_NOT_SUPPORTED',
        message: 'Geolocation is not supported by your browser or device.'
      });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy, // meters
          altitude: position.coords.altitude,
          timestamp: position.timestamp || Date.now()
        });
      },
      (error) => {
        let msg = 'Unable to determine GPS location.';
        let code = 'GEO_ERROR';
        switch (error.code) {
          case error.PERMISSION_DENIED:
            code = 'GEO_DENIED';
            msg = 'Location access was denied. Please allow location permissions in your browser/device settings to mark office attendance.';
            break;
          case error.POSITION_UNAVAILABLE:
            code = 'GEO_UNAVAILABLE';
            msg = 'GPS signal is currently unavailable. Please move to an open area and ensure GPS/Location is enabled.';
            break;
          case error.TIMEOUT:
            code = 'GEO_TIMEOUT';
            msg = 'GPS query timed out. Please verify your device location settings and retry.';
            break;
        }
        reject({ code, message: msg, rawError: error });
      },
      {
        enableHighAccuracy,
        timeout,
        maximumAge
      }
    );
  });
}
