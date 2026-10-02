// Loads the Google Maps JavaScript API dynamically
// Returns a promise that resolves when the API is ready

let loadPromise = null;

export function loadGoogleMaps() {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    if (window.google && window.google.maps) {
      resolve(window.google.maps);
      return;
    }

    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!key || key === 'YOUR_API_KEY_HERE') {
      reject(new Error('Google Maps API key is not configured. Set VITE_GOOGLE_MAPS_API_KEY in frontend/.env'));
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places,geometry`;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      if (window.google && window.google.maps) {
        resolve(window.google.maps);
      } else {
        reject(new Error('Google Maps failed to load'));
      }
    };

    script.onerror = () => {
      loadPromise = null;
      reject(new Error('Failed to load Google Maps script'));
    };

    document.head.appendChild(script);
  });

  return loadPromise;
}
