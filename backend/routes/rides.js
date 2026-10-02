const express = require('express');
const crypto = require('crypto');
const Ride = require('../models/Ride');

const router = express.Router();

// Helper to validate token format
function isValidToken(token) {
  return typeof token === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(token);
}

// Helper to validate coordinates
function isValidCoord(lat, lng) {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !isNaN(lat) &&
    !isNaN(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

// POST /api/rides — Create a new ride
router.post('/', async (req, res) => {
  try {
    const { origin, destination, destinationCoords, currentLocation, route } = req.body;

    // Validate required fields
    if (!origin || !destination || !destinationCoords || !currentLocation) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (
      typeof origin !== 'string' ||
      typeof destination !== 'string' ||
      origin.trim().length === 0 ||
      destination.trim().length === 0
    ) {
      return res.status(400).json({ error: 'Origin and destination must be non-empty strings' });
    }

    if (
      !isValidCoord(destinationCoords.lat, destinationCoords.lng) ||
      !isValidCoord(currentLocation.lat, currentLocation.lng)
    ) {
      return res.status(400).json({ error: 'Invalid coordinate values (out of geographic bounds)' });
    }

    // Generate a secure unique token (64-character hex)
    const token = crypto.randomBytes(32).toString('hex');

    const ride = await Ride.create({
      token,
      origin: origin.trim().slice(0, 300),
      destination: destination.trim().slice(0, 300),
      destinationCoords: {
        lat: Number(destinationCoords.lat.toFixed(6)),
        lng: Number(destinationCoords.lng.toFixed(6)),
      },
      currentLocation: {
        lat: Number(currentLocation.lat.toFixed(6)),
        lng: Number(currentLocation.lng.toFixed(6)),
      },
      route: route || undefined,
      lastLocationTimestamp: Date.now(),
    });

    // Do NOT expose MongoDB _id or internal fields
    res.status(201).json({
      token: ride.token,
      status: ride.status,
      origin: ride.origin,
      destination: ride.destination,
      destinationCoords: ride.destinationCoords,
      currentLocation: ride.currentLocation,
      route: ride.route,
      startedAt: ride.startedAt,
    });
  } catch (err) {
    console.error('Error creating ride:', err);
    res.status(500).json({ error: 'Failed to create ride' });
  }
});

// GET /api/rides/:token — Get ride by public token (public viewer endpoint)
router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;

    if (!isValidToken(token)) {
      return res.status(400).json({ error: 'Invalid ride link format' });
    }

    const ride = await Ride.findOne({ token }).select('-_id -__v');
    if (!ride) {
      return res.status(404).json({ error: 'Ride not found or link has expired' });
    }

    res.json({
      token: ride.token,
      status: ride.status,
      origin: ride.origin,
      destination: ride.destination,
      destinationCoords: ride.destinationCoords,
      currentLocation: ride.currentLocation,
      route: ride.route,
      startedAt: ride.startedAt,
      endedAt: ride.endedAt,
      endReason: ride.endReason,
      lastLocationTimestamp: ride.lastLocationTimestamp,
      updatedAt: ride.updatedAt,
    });
  } catch (err) {
    console.error('Error fetching ride:', err);
    res.status(500).json({ error: 'Failed to fetch ride' });
  }
});

// PATCH /api/rides/:token/status — Update ride status (e.g. ENDED, completed, cancelled)
router.patch('/:token/status', async (req, res) => {
  try {
    const { token } = req.params;
    const { status, reason } = req.body;

    if (!isValidToken(token)) {
      return res.status(400).json({ error: 'Invalid ride link format' });
    }

    const allowed = ['active', 'completed', 'cancelled', 'ENDED'];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ error: 'Invalid or missing status' });
    }

    const updateFields = { status };
    if (status === 'ENDED' || status === 'completed') {
      updateFields.endedAt = new Date();
      if (reason) updateFields.endReason = reason;
    }

    const ride = await Ride.findOneAndUpdate(
      { token },
      updateFields,
      { new: true }
    ).select('-_id -__v');

    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    res.json({
      token: ride.token,
      status: ride.status,
      origin: ride.origin,
      destination: ride.destination,
      destinationCoords: ride.destinationCoords,
      currentLocation: ride.currentLocation,
      route: ride.route,
      startedAt: ride.startedAt,
      endedAt: ride.endedAt,
      endReason: ride.endReason,
      updatedAt: ride.updatedAt,
    });
  } catch (err) {
    console.error('Error updating ride status:', err);
    res.status(500).json({ error: 'Failed to update ride status' });
  }
});

module.exports = router;
