const express = require('express');
const crypto = require('crypto');
const Ride = require('../models/Ride');

const router = express.Router();

// POST /api/rides — Create a new ride
router.post('/', async (req, res) => {
  try {
    const { origin, destination, destinationCoords, currentLocation, route } = req.body;

    // Validate required fields
    if (!origin || !destination || !destinationCoords || !currentLocation) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (
      typeof destinationCoords.lat !== 'number' ||
      typeof destinationCoords.lng !== 'number' ||
      typeof currentLocation.lat !== 'number' ||
      typeof currentLocation.lng !== 'number'
    ) {
      return res.status(400).json({ error: 'Invalid coordinate format' });
    }

    // Generate a secure unique token
    const token = crypto.randomBytes(32).toString('hex');

    const ride = await Ride.create({
      token,
      origin,
      destination,
      destinationCoords,
      currentLocation,
      route: route || undefined,
    });

    res.status(201).json({
      id: ride._id,
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
    console.error('Error creating ride:', err.message);
    res.status(500).json({ error: 'Failed to create ride' });
  }
});

// GET /api/rides/:token — Get ride by public token
router.get('/:token', async (req, res) => {
  try {
    const ride = await Ride.findOne({ token: req.params.token });
    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }
    res.json(ride);
  } catch (err) {
    console.error('Error fetching ride:', err.message);
    res.status(500).json({ error: 'Failed to fetch ride' });
  }
});

module.exports = router;
