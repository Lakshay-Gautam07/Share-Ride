import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { loadGoogleMaps } from '../utils/loadGoogleMaps';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// Helper to format human-readable relative time
function formatRelativeTime(date) {
  if (!date) return 'Waiting for first update...';
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));

  if (elapsedSeconds < 5) return 'Just now';
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export default function PublicRideViewer({ token, onGoHome }) {
  const [ride, setRide] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [rideStatus, setRideStatus] = useState('active');
  const [endedAtTime, setEndedAtTime] = useState(null);
  const [endReason, setEndReason] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [relativeTimeStr, setRelativeTimeStr] = useState('Just now');
  const [connStatus, setConnStatus] = useState('connecting'); // 'connected' | 'connecting' | 'reconnecting' | 'disconnected'
  const [mapError, setMapError] = useState(null);
  const [autoPan, setAutoPan] = useState(true);
  const [routeInfo, setRouteInfo] = useState(null);

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const passengerMarkerRef = useRef(null);
  const directionsServiceRef = useRef(null);
  const directionsRendererRef = useRef(null);
  const socketRef = useRef(null);

  // Stale update prevention ref
  const lastReceivedTimestampRef = useRef(0);

  // Ticking timer for "Last updated X seconds ago"
  useEffect(() => {
    if (!lastUpdated) return;

    setRelativeTimeStr(formatRelativeTime(lastUpdated));

    const intervalId = setInterval(() => {
      setRelativeTimeStr(formatRelativeTime(lastUpdated));
    }, 3000);

    return () => clearInterval(intervalId);
  }, [lastUpdated]);

  // 1. Fetch public ride details by token
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`${API_URL}/api/rides/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Ride not found or link has expired.');
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setRide(data);
        setCurrentLocation(data.currentLocation);
        setRideStatus(data.status);
        setEndedAtTime(data.endedAt || null);
        setEndReason(data.endReason || null);
        setRouteInfo(data.route || null);

        const initTime = new Date(data.updatedAt || data.startedAt);
        setLastUpdated(initTime);
        lastReceivedTimestampRef.current = data.lastLocationTimestamp || initTime.getTime();
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  // 2. Connect to Socket.IO with graceful disconnect/reconnect handling
  useEffect(() => {
    if (!token || rideStatus !== 'active') return;

    const socket = io(API_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnStatus('connected');
      socket.emit('join-ride', token);
    });

    socket.on('disconnect', () => {
      setConnStatus('disconnected');
    });

    socket.on('connect_error', () => {
      setConnStatus('reconnecting');
    });

    socket.io.on('reconnect_attempt', () => {
      setConnStatus('reconnecting');
    });

    socket.io.on('reconnect', () => {
      setConnStatus('connected');
      socket.emit('join-ride', token);
    });

    // Handle real-time passenger location update (prevent stale packets)
    socket.on('location-updated', (data) => {
      if (data && typeof data.lat === 'number' && typeof data.lng === 'number') {
        const updateTs = typeof data.timestamp === 'number' ? data.timestamp : Date.now();

        // Discard stale out-of-order packets
        if (updateTs < lastReceivedTimestampRef.current) {
          return;
        }

        lastReceivedTimestampRef.current = updateTs;
        setCurrentLocation({ lat: data.lat, lng: data.lng });
        setLastUpdated(new Date(data.updatedAt || updateTs));
      }
    });

    // Handle ride completion / end
    socket.on('ride-ended', (data) => {
      setRideStatus('ENDED');
      if (data?.endedAt) {
        setEndedAtTime(data.endedAt);
      }
      if (data?.reason) {
        setEndReason(data.reason);
      }
      if (socket) {
        socket.emit('leave-ride', token);
        socket.disconnect();
      }
    });

    socket.on('ride-inactive', () => {
      setRideStatus('ENDED');
      if (socket) {
        socket.emit('leave-ride', token);
        socket.disconnect();
      }
    });

    return () => {
      if (socket) {
        socket.emit('leave-ride', token);
        socket.disconnect();
      }
    };
  }, [token, rideStatus]);

  // 3. Initialize Google Map for Viewer
  useEffect(() => {
    if (!ride || loading) return;

    let cancelled = false;

    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !mapRef.current) return;

        const initialCenter = ride.currentLocation || { lat: 28.6139, lng: 77.2090 };

        const map = new maps.Map(mapRef.current, {
          center: initialCenter,
          zoom: 14,
          zoomControl: true,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        mapInstanceRef.current = map;

        // Setup Directions route to destination
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

        // Setup passenger real-time location marker
        const marker = new maps.Marker({
          position: initialCenter,
          map,
          title: 'Passenger Current Location',
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
  }, [ride, loading]);

  // 4. Update passenger marker position in real time on the map
  useEffect(() => {
    if (!passengerMarkerRef.current || !currentLocation) return;

    const pos = { lat: currentLocation.lat, lng: currentLocation.lng };
    passengerMarkerRef.current.setPosition(pos);

    if (autoPan && mapInstanceRef.current) {
      mapInstanceRef.current.panTo(pos);
    }
  }, [currentLocation, autoPan]);

  // Recenter map helper
  const handleRecenter = () => {
    setAutoPan(true);
    if (mapInstanceRef.current && currentLocation) {
      mapInstanceRef.current.panTo(currentLocation);
      mapInstanceRef.current.setZoom(15);
    }
  };

  // --- RENDERING STATES ---

  // 1. Loading State
  if (loading) {
    return (
      <div className="viewer-container">
        <div className="card viewer-card text-center">
          <div className="loading-spinner" />
          <h2>Loading Live Ride...</h2>
          <p className="subtitle">Connecting to live tracking stream</p>
        </div>
      </div>
    );
  }

  // 2. Error / Invalid / Expired Link State
  if (error || !ride) {
    return (
      <div className="viewer-container">
        <div className="card viewer-card text-center error-card">
          <div className="error-icon">⚠️</div>
          <h2>Ride Link Invalid or Expired</h2>
          <p className="error-message">
            {error || 'This live ride link is no longer accessible. It may have expired or ended.'}
          </p>
          <button type="button" className="btn btn-primary" onClick={onGoHome}>
            Go to Share Ride
          </button>
        </div>
      </div>
    );
  }

  const isRideActive = rideStatus === 'active';
  const isConnected = connStatus === 'connected';
  const isReconnecting = connStatus === 'reconnecting' || connStatus === 'disconnected';

  // Check if GPS updates are delayed (> 50 seconds while active)
  const isGpsDelayed =
    isRideActive &&
    lastUpdated &&
    Date.now() - lastUpdated.getTime() > 50000;

  // 3. Active or Ended Ride View
  return (
    <div className="viewer-container">
      <div className="card viewer-card">
        {/* Header: Status and Connection Pill */}
        <div className="viewer-header">
          <div>
            <div className={`status-badge-pill ${isRideActive ? 'active' : 'ended'}`}>
              <span className={`status-indicator-dot ${isRideActive ? 'pulsing' : ''}`} />
              <span>{isRideActive ? 'LIVE RIDE' : 'RIDE ENDED'}</span>
            </div>
            <h1 className="viewer-title">Passenger Ride</h1>
          </div>

          {isRideActive && (
            <div className={`connection-pill ${isConnected ? 'connected' : 'connecting'}`}>
              <span className="conn-dot" />
              {isConnected ? 'Live' : isReconnecting ? 'Reconnecting...' : 'Connecting...'}
            </div>
          )}
        </div>

        {/* Reconnecting Alert Banner */}
        {isRideActive && isReconnecting && (
          <div className="alert alert-warning">
            <span>📡 <strong>Reconnecting to live stream...</strong> We'll automatically catch up once connected.</span>
          </div>
        )}

        {/* GPS Delayed Banner */}
        {isGpsDelayed && (
          <div className="alert alert-warning">
            <span>🛰️ <strong>GPS Signal Paused:</strong> Passenger device is temporarily out of GPS range. Showing last confirmed location.</span>
          </div>
        )}

        {/* Ride Ended Alert Banner */}
        {!isRideActive && (
          <div className="alert alert-info">
            <span>
              🏁 <strong>This ride has concluded.</strong>{' '}
              {endReason === 'destination_reached'
                ? 'Passenger arrived at their destination.'
                : 'Live location tracking has stopped.'}
              {endedAtTime && ` (Ended at ${new Date(endedAtTime).toLocaleTimeString()})`}
            </span>
          </div>
        )}

        {/* Map Display */}
        {mapError ? (
          <div className="map-error">
            <p>⚠️ <strong>Map Notice:</strong> {mapError}</p>
          </div>
        ) : (
          <div className="active-map-wrapper">
            <div ref={mapRef} className="viewer-map" />
            {isRideActive && (
              <div className="map-controls">
                <button
                  type="button"
                  className={`map-ctrl-btn ${autoPan ? 'active' : ''}`}
                  onClick={handleRecenter}
                  title="Recenter map on passenger"
                >
                  📍 {autoPan ? 'Following Passenger' : 'Recenter'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Real-time Telemetry & Last Updated Live Time */}
        {currentLocation && (
          <div className="telemetry-bar">
            <div className="telemetry-item">
              <span className="telemetry-label">LAST UPDATED</span>
              <span className="telemetry-val">
                {isRideActive ? relativeTimeStr : (lastUpdated ? lastUpdated.toLocaleTimeString() : 'Concluded')}
              </span>
            </div>
            <div className="telemetry-item">
              <span className="telemetry-label">CURRENT COORDINATES</span>
              <span className="telemetry-val">
                {currentLocation.lat.toFixed(5)}, {currentLocation.lng.toFixed(5)}
              </span>
            </div>
          </div>
        )}

        {/* Ride Details & ETA */}
        <div className="ride-info">
          <p><strong>📍 Destination:</strong> {ride.destination}</p>
          <p><strong>🏁 Origin:</strong> {ride.origin}</p>
          {routeInfo?.distance && (
            <p><strong>🛣️ Est. Distance:</strong> {routeInfo.distance}</p>
          )}
          {routeInfo?.duration && (
            <p><strong>⏱️ Est. Travel Time (ETA):</strong> {routeInfo.duration}</p>
          )}
          <p><strong>Started:</strong> {new Date(ride.startedAt).toLocaleString()}</p>
          {endedAtTime && (
            <p><strong>Ended:</strong> {new Date(endedAtTime).toLocaleString()}</p>
          )}
        </div>

        {/* Footer Navigation */}
        <button type="button" className="btn btn-secondary" onClick={onGoHome}>
          Create Your Own Ride
        </button>
      </div>
    </div>
  );
}
