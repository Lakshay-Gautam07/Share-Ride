import { useEffect, useState, useCallback } from 'react';
import MapWithSearch from './components/MapWithSearch';
import ActiveRideTracker from './components/ActiveRideTracker';
import PublicRideViewer from './components/PublicRideViewer';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// Helper to extract public ride token from path /view/:token or /ride/:token
const getRouteToken = () => {
  const path = window.location.pathname;
  const match = path.match(/^\/(?:view|ride)\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
};

function App() {
  const [viewToken, setViewToken] = useState(() => getRouteToken());
  const [userLocation, setUserLocation] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [destination, setDestination] = useState(null);
  const [loading, setLoading] = useState(false);
  const [ride, setRide] = useState(null);
  const [completedRide, setCompletedRide] = useState(null);
  const [error, setError] = useState(null);

  // Sync route token when user navigates using back/forward buttons
  useEffect(() => {
    const handlePopState = () => {
      setViewToken(getRouteToken());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleGoHome = useCallback(() => {
    window.history.pushState({}, '', '/');
    setViewToken(null);
  }, []);

  // 1. Initial geolocation to center passenger map
  useEffect(() => {
    // Only request passenger location if in create ride mode
    if (viewToken) return;

    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setLocationError(null);
      },
      (err) => {
        setLocationError(`Location access issue: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [viewToken]);

  const handleDestinationSelect = useCallback((dest) => {
    setDestination(dest);
    setError(null);
  }, []);

  const handleSetFallbackLocation = () => {
    setUserLocation({ lat: 28.6139, lng: 77.2090 });
    setLocationError(null);
  };

  // 2. Start Ride flow: persists ride in MongoDB Atlas & enters Active Ride Tracking
  const handleStartRide = async () => {
    if (!destination) {
      setError('Please search and select a destination first.');
      return;
    }

    if (!userLocation) {
      setError('Waiting for passenger location. Please allow location access or choose default location.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/api/rides`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: `${userLocation.lat.toFixed(6)}, ${userLocation.lng.toFixed(6)}`,
          destination: destination.name,
          destinationCoords: { lat: destination.lat, lng: destination.lng },
          currentLocation: { lat: userLocation.lat, lng: userLocation.lng },
          route: destination.route || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create ride');
      }

      const data = await res.json();
      setRide(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // --- ROUTING / SCREEN RESOLUTION ---

  // Screen 1: Public Ride Viewer (/view/:token or /ride/:token)
  if (viewToken) {
    return <PublicRideViewer token={viewToken} onGoHome={handleGoHome} />;
  }

  // Screen 2: Active Ride Tracking (Passenger view)
  if (ride) {
    return (
      <div className="app">
        <ActiveRideTracker
          ride={ride}
          onRideEnded={() => {
            setCompletedRide(ride);
            setRide(null);
          }}
        />
      </div>
    );
  }

  // Screen 3: Completed Ride Summary
  if (completedRide) {
    return (
      <div className="app">
        <div className="card success-card">
          <h1>🏁 Ride Completed!</h1>
          <p className="subtitle">Live tracking has stopped and your ride is archived in MongoDB.</p>

          <div className="ride-info">
            <p><strong>📍 Destination:</strong> {completedRide.destination}</p>
            <p><strong>🏁 Origin:</strong> {completedRide.origin}</p>
            {completedRide.route?.distance && (
              <p><strong>🛣️ Distance:</strong> {completedRide.route.distance}</p>
            )}
            <p><strong>Status:</strong> <span className="badge badge-completed">Completed</span></p>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setCompletedRide(null);
              setDestination(null);
            }}
          >
            Start Another Ride
          </button>
        </div>
      </div>
    );
  }

  // Screen 4: Passenger Ride Setup & Creation
  return (
    <div className="app">
      <div className="card">
        <h1>🚗 Share Ride</h1>
        <p className="subtitle">Enter your destination to calculate route and share your live ride.</p>

        {locationError && (
          <div className="alert alert-warning">
            <span>⚠️ {locationError}</span>
            <button
              type="button"
              className="btn-link"
              onClick={handleSetFallbackLocation}
            >
              Use default location (New Delhi)
            </button>
          </div>
        )}

        <MapWithSearch
          onDestinationSelect={handleDestinationSelect}
          userLocation={userLocation}
          selectedDestination={destination}
        />

        {destination && (
          <div className="destination-preview">
            <div className="dest-title">
              <strong>📍 Destination:</strong> {destination.name}
            </div>
            {destination.route && (
              <div className="route-details">
                <span className="route-pill">🛣️ {destination.route.distance || 'Route calculated'}</span>
                <span className="route-pill">⏱️ ETA: {destination.route.duration || 'In transit'}</span>
              </div>
            )}
          </div>
        )}

        {error && <div className="alert alert-error">❌ {error}</div>}

        <button
          type="button"
          className="btn btn-primary"
          onClick={handleStartRide}
          disabled={loading || !destination}
        >
          {loading ? 'Starting Ride...' : 'Start Ride'}
        </button>
      </div>
    </div>
  );
}

export default App;
