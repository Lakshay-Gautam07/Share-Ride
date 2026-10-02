import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { loadGoogleMaps } from '../utils/loadGoogleMaps';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function ActiveRideTracker({ ride, onRideEnded }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const passengerMarkerRef = useRef(null);
  const directionsServiceRef = useRef(null);
  const directionsRendererRef = useRef(null);
  const watchIdRef = useRef(null);
  const socketRef = useRef(null);

  const [currentLocation, setCurrentLocation] = useState(ride.currentLocation);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [locationError, setLocationError] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [mapError, setMapError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [endingRide, setEndingRide] = useState(false);
  const [autoPan, setAutoPan] = useState(true);

  const shareUrl = `${window.location.origin}/view/${ride.token}`;

  // Broadcast location update helper
  const sendLocationUpdate = useCallback((newLoc) => {
    setCurrentLocation(newLoc);
    setLastUpdated(new Date());
    setLocationError(null);

    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('update-location', {
        token: ride.token,
        lat: newLoc.lat,
        lng: newLoc.lng,
      });
    }
  }, [ride.token]);

  // 1. Socket.IO connection & room subscription
  useEffect(() => {
    const socket = io(API_URL, {
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);
      socket.emit('join-ride', ride.token);
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
    });

    socket.on('connect_error', () => {
      setSocketConnected(false);
    });

    socket.on('location-updated', (data) => {
      if (data && typeof data.lat === 'number' && typeof data.lng === 'number') {
        setLastUpdated(new Date(data.updatedAt || Date.now()));
      }
    });

    socket.on('ride-ended', () => {
      onRideEnded();
    });

    return () => {
      if (socket) {
        socket.emit('leave-ride', ride.token);
        socket.disconnect();
      }
    };
  }, [ride.token, onRideEnded]);

  // 2. Geolocation continuous tracking with watchPosition()
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser.');
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const newLoc = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        sendLocationUpdate(newLoc);
      },
      (err) => {
        let message = 'Unable to retrieve location.';
        if (err.code === 1) {
          message = 'Location permission was denied. Please allow location access to continue tracking.';
        } else if (err.code === 2) {
          message = 'GPS location is temporarily unavailable. Re-attempting...';
        } else if (err.code === 3) {
          message = 'GPS location request timed out. Retrying...';
        }
        setLocationError(message);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 10000,
      }
    );

    // Stop watchPosition on unmount or when leaving active ride screen
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [sendLocationUpdate]);

  // 3. Initialize Google Map for active ride
  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !mapRef.current) return;

        const initialCenter = ride.currentLocation || { lat: 28.6139, lng: 77.2090 };

        const map = new maps.Map(mapRef.current, {
          center: initialCenter,
          zoom: 15,
          zoomControl: true,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });

        mapInstanceRef.current = map;

        // Draw driving route to destination if coordinates exist
        if (ride.destinationCoords) {
          const directionsService = new maps.DirectionsService();
          const directionsRenderer = new maps.DirectionsRenderer({
            map,
            suppressMarkers: false,
            polylineOptions: {
              strokeColor: '#2563eb',
              strokeWeight: 5,
              strokeOpacity: 0.85,
            },
          });
          directionsServiceRef.current = directionsService;
          directionsRendererRef.current = directionsRenderer;

          directionsService.route(
            {
              origin: initialCenter,
              destination: ride.destinationCoords,
              travelMode: maps.TravelMode.DRIVING,
            },
            (result, status) => {
              if (status === maps.DirectionsStatus.OK && result) {
                directionsRenderer.setDirections(result);
              }
            }
          );
        }

        // Create passenger real-time location live marker
        const marker = new maps.Marker({
          position: initialCenter,
          map,
          title: 'Passenger Live Location',
          icon: {
            path: maps.SymbolPath.CIRCLE,
            scale: 9,
            fillColor: '#2563eb',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 3,
          },
          zIndex: 999,
        });

        passengerMarkerRef.current = marker;
      })
      .catch((err) => {
        if (!cancelled) setMapError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [ride.currentLocation, ride.destinationCoords]);

  // 4. Update passenger marker position in real time on the map
  useEffect(() => {
    if (!passengerMarkerRef.current || !currentLocation) return;

    const pos = { lat: currentLocation.lat, lng: currentLocation.lng };
    passengerMarkerRef.current.setPosition(pos);

    if (autoPan && mapInstanceRef.current) {
      mapInstanceRef.current.panTo(pos);
    }
  }, [currentLocation, autoPan]);

  // End ride handler: stops watch, updates DB and notifies socket room
  const handleEndRide = async () => {
    setEndingRide(true);

    // Stop watchPosition immediately
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    // Emit socket event to notify all viewers
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('end-ride', { token: ride.token });
    }

    // Persist completed status in MongoDB
    try {
      await fetch(`${API_URL}/api/rides/${ride.token}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });
    } catch (err) {
      console.error('Failed to update ride status in DB:', err);
    }

    setEndingRide(false);
    onRideEnded();
  };

  // Test GPS movement simulation helper
  const handleSimulateMovement = () => {
    const deltaLat = (Math.random() - 0.4) * 0.0015;
    const deltaLng = (Math.random() - 0.4) * 0.0015;
    const updated = {
      lat: Number((currentLocation.lat + deltaLat).toFixed(6)),
      lng: Number((currentLocation.lng + deltaLng).toFixed(6)),
    };
    sendLocationUpdate(updated);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="active-tracker">
      <div className="card active-card">
        {/* Header with Live Status & Connection */}
        <div className="active-header">
          <div>
            <div className="live-status-badge">
              <span className="live-pulse" />
              <span>LIVE TRACKING ACTIVE</span>
            </div>
            <h1 className="active-title">Ongoing Ride</h1>
          </div>
          <div className={`connection-pill ${socketConnected ? 'connected' : 'connecting'}`}>
            <span className="conn-dot" />
            {socketConnected ? 'Real-time Connected' : 'Reconnecting...'}
          </div>
        </div>

        {/* Location / Geolocation Error Alert */}
        {locationError && (
          <div className="alert alert-warning">
            <span>⚠️ {locationError}</span>
          </div>
        )}

        {/* Map Display */}
        {mapError ? (
          <div className="map-error">
            <p>⚠️ <strong>Map Notice:</strong> {mapError}</p>
          </div>
        ) : (
          <div className="active-map-wrapper">
            <div ref={mapRef} className="active-map" />
            <div className="map-controls">
              <button
                type="button"
                className={`map-ctrl-btn ${autoPan ? 'active' : ''}`}
                onClick={() => {
                  setAutoPan(!autoPan);
                  if (!autoPan && mapInstanceRef.current && currentLocation) {
                    mapInstanceRef.current.panTo(currentLocation);
                  }
                }}
                title={autoPan ? 'Auto-centering ON' : 'Auto-centering OFF'}
              >
                📍 {autoPan ? 'Center Locked' : 'Recenter'}
              </button>
              <button
                type="button"
                className="map-ctrl-btn test-btn"
                onClick={handleSimulateMovement}
                title="Send a simulated GPS update"
              >
                🚀 Test GPS Step
              </button>
            </div>
          </div>
        )}

        {/* Real-time Telemetry & Coordinates */}
        <div className="telemetry-bar">
          <div className="telemetry-item">
            <span className="telemetry-label">CURRENT GPS</span>
            <span className="telemetry-val">
              {currentLocation ? `${currentLocation.lat.toFixed(5)}, ${currentLocation.lng.toFixed(5)}` : 'Acquiring...'}
            </span>
          </div>
          <div className="telemetry-item">
            <span className="telemetry-label">LAST BROADCAST</span>
            <span className="telemetry-val">
              {lastUpdated ? lastUpdated.toLocaleTimeString() : 'Just now'}
            </span>
          </div>
        </div>

        {/* Destination & Route Summary */}
        <div className="ride-info">
          <p><strong>📍 Destination:</strong> {ride.destination}</p>
          <p><strong>🏁 Origin:</strong> {ride.origin}</p>
          {ride.route?.distance && (
            <p><strong>🛣️ Est. Distance:</strong> {ride.route.distance}</p>
          )}
          {ride.route?.duration && (
            <p><strong>⏱️ Est. Duration:</strong> {ride.route.duration}</p>
          )}
        </div>

        {/* Public Share Link */}
        <div className="share-section">
          <p className="share-label">Share private tracking link with contacts:</p>
          <div className="share-url">
            <code>{shareUrl}</code>
            <button
              type="button"
              className="btn btn-small"
              onClick={handleCopy}
            >
              {copied ? 'Copied! ✓' : 'Copy Link'}
            </button>
          </div>
        </div>

        {/* End Ride Button */}
        <button
          type="button"
          className="btn btn-danger"
          onClick={handleEndRide}
          disabled={endingRide}
        >
          {endingRide ? 'Ending Ride...' : '🏁 End Ride'}
        </button>
      </div>
    </div>
  );
}
