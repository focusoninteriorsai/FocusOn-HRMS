// Location is requested only when an attendance flow explicitly calls this module.
export function getCurrentLocation({ timeoutMs = 15000, maximumAgeMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(Object.assign(new Error('unsupported'), { code: 'LOCATION_UNSUPPORTED' }));
      return;
    }
    navigator.geolocation.getCurrentPosition((position) => {
      const { latitude, longitude, accuracy } = position.coords;
      if (![latitude, longitude, accuracy].every(Number.isFinite)) {
        reject(Object.assign(new Error('invalid'), { code: 'LOCATION_INVALID' }));
        return;
      }
      resolve({
        lat: latitude,
        lng: longitude,
        accuracy,
        timestamp: new Date(position.timestamp).toISOString()
      });
    }, (error) => {
      reject(Object.assign(new Error('unavailable'), {
        code: error.code === error.PERMISSION_DENIED ? 'LOCATION_DENIED' : 'LOCATION_UNAVAILABLE'
      }));
    }, {
      enableHighAccuracy: true,
      timeout: timeoutMs,
      maximumAge: maximumAgeMs
    });
  });
}
