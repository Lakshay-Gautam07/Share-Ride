import { useEffect, useState, useCallback } from 'react';
import MapWithSearch from './components/MapWithSearch';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

function App() {
  const [userLocation, setUserLocation] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [destination, setDestination] = useState(null);
  const [loading, setLoading] = useState(false);
  const [ride, setRide] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  // 1. Get passenger's current location via browser Geolocation
  useEffect(() => {
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
  }, []);

  const handleDestinationSelect = useCallback((dest) => {
    setDestination(dest);
    setError(null);
  }, []);

  const handleSetFallbackLocation = () => {
    setUserLocation({ lat: 28.6139, lng: 77.2090 });
    setLocationError(null);
  };

  // 2. Start Ride flow: persists ride in MongoDB Atlas
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

  const handleCopyLink = (url) => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // 3. Ride created state: display ride details, route ETA, and secure share URL
  if (ride) {
    const shareUrl = `${window.location.origin}/ride/${ride.token}`;

    return (
      <div className="app">
        <div className="card success-card">
          <h1>🚗 Ride Started!</h1>
          <p className="subtitle">Your temporary live ride is active and saved to MongoDB.</p>

          <div className="ride-info">
            <p><strong>Destination:</strong> {ride.destination}</p>
            <p><strong>Origin:</strong> {ride.origin}</p>
            {ride.route?.distance && (
              <p><strong>Est. Distance:</strong> {ride.route.distance}</p>
            )}
            {ride.route?.duration && (
              <p><strong>Est. Duration (ETA):</strong> {ride.route.duration}</p>
            )}
            <p><strong>Status:</strong> <span className="badge">{ride.status}</span></p>
            <p><strong>Started At:</strong> {new Date(ride.startedAt).toLocaleTimeString()}</p>
          </div>

          <div className="share-section">
            <p className="share-label">Public Share Link (secure token):</p>
            <div className="share-url">
              <code>{shareUrl}</code>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => handleCopyLink(shareUrl)}
              >
                {copied ? 'Copied! ✓' : 'Copy Link'}
              </button>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setRide(null);
              setDestination(null);
            }}
          >
            Create Another Ride
          </button>
        </div>
      </div>
    );
  }

  // 4. Default passenger view: Map + Search + Start Ride
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
