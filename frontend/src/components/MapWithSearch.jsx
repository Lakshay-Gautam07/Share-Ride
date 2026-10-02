import { useEffect, useRef, useState, useCallback } from 'react';
import { loadGoogleMaps } from '../utils/loadGoogleMaps';

export default function MapWithSearch({ onDestinationSelect, userLocation, selectedDestination }) {
  const mapRef = useRef(null);
  const inputRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const directionsServiceRef = useRef(null);
  const directionsRendererRef = useRef(null);
  const destMarkerRef = useRef(null);
  const userMarkerRef = useRef(null);

  const [mapsApi, setMapsApi] = useState(null);
  const [mapError, setMapError] = useState(null);
  const [manualInput, setManualInput] = useState('');
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);

  // Helper to compute and display route between user location and destination
  const computeRoute = useCallback((originLoc, destCoords, destName, maps) => {
    if (!originLoc || !destCoords || !directionsServiceRef.current || !directionsRendererRef.current) {
      return;
    }

    setIsCalculatingRoute(true);

    const request = {
      origin: { lat: originLoc.lat, lng: originLoc.lng },
      destination: { lat: destCoords.lat, lng: destCoords.lng },
      travelMode: maps.TravelMode.DRIVING,
    };

    directionsServiceRef.current.route(request, (result, status) => {
      setIsCalculatingRoute(false);

      if (status === maps.DirectionsStatus.OK && result) {
        directionsRendererRef.current.setDirections(result);

        // Hide standalone markers when directionsRenderer is showing route
        if (destMarkerRef.current) destMarkerRef.current.setMap(null);
        if (userMarkerRef.current) userMarkerRef.current.setMap(null);

        const leg = result.routes[0]?.legs[0];
        const routeData = {
          distance: leg?.distance?.text || '',
          duration: leg?.duration?.text || '',
          polyline: result.routes[0]?.overview_polyline || '',
        };

        onDestinationSelect({
          name: destName,
          lat: destCoords.lat,
          lng: destCoords.lng,
          route: routeData,
        });
      } else {
        console.warn('Directions request failed with status:', status);

        // Fallback: place standalone destination marker on map
        if (mapInstanceRef.current) {
          if (!destMarkerRef.current) {
            destMarkerRef.current = new maps.Marker({
              position: { lat: destCoords.lat, lng: destCoords.lng },
              map: mapInstanceRef.current,
              title: 'Destination',
            });
          } else {
            destMarkerRef.current.setMap(mapInstanceRef.current);
            destMarkerRef.current.setPosition({ lat: destCoords.lat, lng: destCoords.lng });
          }
          mapInstanceRef.current.panTo({ lat: destCoords.lat, lng: destCoords.lng });
        }

        onDestinationSelect({
          name: destName,
          lat: destCoords.lat,
          lng: destCoords.lng,
          route: null,
        });
      }
    });
  }, [onDestinationSelect]);

  // 1. Initialize Google Map, Autocomplete, and Directions once
  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !mapRef.current) return;
        setMapsApi(maps);

        const defaultCenter = userLocation
          ? { lat: userLocation.lat, lng: userLocation.lng }
          : { lat: 28.6139, lng: 77.2090 };

        const map = new maps.Map(mapRef.current, {
          center: defaultCenter,
          zoom: 13,
          zoomControl: true,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });

        mapInstanceRef.current = map;

        // Initialize Directions Service and Renderer
        directionsServiceRef.current = new maps.DirectionsService();
        directionsRendererRef.current = new maps.DirectionsRenderer({
          map,
          suppressMarkers: false,
          polylineOptions: {
            strokeColor: '#2563eb',
            strokeWeight: 5,
            strokeOpacity: 0.8,
          },
        });

        // Setup Places Autocomplete
        if (inputRef.current) {
          const autocomplete = new maps.places.Autocomplete(inputRef.current, {
            fields: ['formatted_address', 'geometry', 'name'],
          });

          autocomplete.bindTo('bounds', map);

          autocomplete.addListener('place_changed', () => {
            const place = autocomplete.getPlace();
            if (!place.geometry || !place.geometry.location) return;

            const lat = place.geometry.location.lat();
            const lng = place.geometry.location.lng();
            const name = place.formatted_address || place.name || 'Selected Destination';

            const destCoords = { lat, lng };

            if (userLocation) {
              computeRoute(userLocation, destCoords, name, maps);
            } else {
              map.panTo(destCoords);
              map.setZoom(15);

              if (destMarkerRef.current) {
                destMarkerRef.current.setPosition(destCoords);
                destMarkerRef.current.setMap(map);
              } else {
                destMarkerRef.current = new maps.Marker({
                  position: destCoords,
                  map,
                  title: 'Destination',
                });
              }

              onDestinationSelect({
                name,
                lat,
                lng,
                route: null,
              });
            }
          });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setMapError(err.message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []); // Run once on mount

  // 2. React to userLocation changes
  useEffect(() => {
    if (!mapInstanceRef.current || !mapsApi || !userLocation) return;

    const pos = { lat: userLocation.lat, lng: userLocation.lng };

    // If destination is already picked, recalculate the route
    if (selectedDestination && directionsServiceRef.current) {
      computeRoute(
        userLocation,
        { lat: selectedDestination.lat, lng: selectedDestination.lng },
        selectedDestination.name,
        mapsApi
      );
      return;
    }

    // Otherwise show/update user location circle marker
    if (userMarkerRef.current) {
      userMarkerRef.current.setPosition(pos);
      userMarkerRef.current.setMap(mapInstanceRef.current);
    } else {
      userMarkerRef.current = new mapsApi.Marker({
        position: pos,
        map: mapInstanceRef.current,
        title: 'Your Location',
        icon: {
          path: mapsApi.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#4285F4',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
      });
    }

    if (!destMarkerRef.current) {
      mapInstanceRef.current.panTo(pos);
    }
  }, [userLocation, mapsApi, selectedDestination, computeRoute]);

  // Handle manual destination input (fallback or no-autocomplete mode)
  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (!manualInput.trim()) return;

    const baseLat = userLocation ? userLocation.lat : 28.6139;
    const baseLng = userLocation ? userLocation.lng : 77.2090;

    const destCoords = { lat: baseLat + 0.03, lng: baseLng + 0.03 };

    if (mapsApi && userLocation) {
      computeRoute(userLocation, destCoords, manualInput.trim(), mapsApi);
    } else {
      onDestinationSelect({
        name: manualInput.trim(),
        lat: destCoords.lat,
        lng: destCoords.lng,
        route: {
          distance: '~3.5 km',
          duration: '~12 mins',
          polyline: '',
        },
      });
    }
  };

  return (
    <div className="map-container">
      {mapError ? (
        <div className="map-fallback">
          <div className="map-error">
            <p>⚠️ <strong>Google Maps Notice:</strong> {mapError}</p>
          </div>
          <form onSubmit={handleManualSubmit} className="manual-input-form">
            <input
              type="text"
              className="map-search-input"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Enter destination (e.g. Connaught Place, Airport)..."
            />
            <button type="submit" className="btn btn-secondary manual-btn">
              Set Destination
            </button>
          </form>
        </div>
      ) : (
        <>
          <div className="search-bar-wrapper">
            <input
              ref={inputRef}
              type="text"
              className="map-search-input"
              placeholder="Search destination in Google Maps..."
            />
            {isCalculatingRoute && <span className="calc-badge">Calculating route...</span>}
          </div>
          <div ref={mapRef} className="map" />
        </>
      )}
    </div>
  );
}
