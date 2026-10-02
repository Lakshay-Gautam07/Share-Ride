require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const Ride = require('./models/Ride');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST', 'PATCH'],
  },
});

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
}));
app.use(express.json());

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI;

if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ MongoDB connected'))
    .catch((err) => console.error('❌ MongoDB connection error:', err.message));
} else {
  console.warn('⚠️  MONGODB_URI not set — skipping database connection');
}

// Health check route
app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'Share Ride API' });
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

// Routes
const ridesRouter = require('./routes/rides');
app.use('/api/rides', ridesRouter);

// Helper: Haversine distance in meters between two GPS coordinates
function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Arrival threshold: 75 meters
const ARRIVAL_THRESHOLD_METERS = 75;

// Socket.IO real-time tracking
io.on('connection', (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  // Join a specific ride room
  socket.on('join-ride', (token) => {
    if (!token) return;
    socket.join(token);
    console.log(`📡 Socket ${socket.id} joined ride room: ${token}`);
  });

  // Leave ride room
  socket.on('leave-ride', (token) => {
    if (!token) return;
    socket.leave(token);
    console.log(`📡 Socket ${socket.id} left ride room: ${token}`);
  });

  // Handle passenger live location updates
  socket.on('update-location', async (data) => {
    try {
      const { token, lat, lng } = data || {};

      if (!token || typeof lat !== 'number' || typeof lng !== 'number') {
        return;
      }

      // Check if ride exists and is still active (prevent ended/expired tokens from updating)
      const ride = await Ride.findOne({ token });
      if (!ride) {
        socket.emit('ride-inactive', { token, message: 'Ride not found.' });
        return;
      }

      if (ride.status === 'ENDED' || ride.status === 'completed' || ride.status === 'cancelled') {
        socket.emit('ride-inactive', {
          token,
          status: ride.status,
          message: 'This ride has already ended. Location updates are disabled.',
        });
        return;
      }

      // Check if passenger reached the destination within the threshold
      let reachedDestination = false;
      if (ride.destinationCoords && typeof ride.destinationCoords.lat === 'number') {
        const distanceToDestination = getDistanceMeters(
          lat,
          lng,
          ride.destinationCoords.lat,
          ride.destinationCoords.lng
        );

        if (distanceToDestination <= ARRIVAL_THRESHOLD_METERS) {
          reachedDestination = true;
        }
      }

      // If reached destination, auto-end the ride
      if (reachedDestination) {
        const endedAt = new Date();
        ride.currentLocation = { lat, lng };
        ride.status = 'ENDED';
        ride.endedAt = endedAt;
        ride.endReason = 'destination_reached';
        await ride.save();

        io.to(token).emit('location-updated', {
          lat,
          lng,
          updatedAt: endedAt.toISOString(),
        });

        io.to(token).emit('ride-ended', {
          token,
          status: 'ENDED',
          endedAt: endedAt.toISOString(),
          reason: 'destination_reached',
          message: 'Passenger reached destination.',
        });

        console.log(`🎯 Ride auto-ended at destination: ${token}`);
        return;
      }

      // Standard active location update
      const updatePayload = {
        lat,
        lng,
        updatedAt: new Date().toISOString(),
      };

      // Broadcast new location to all clients tracking this ride
      io.to(token).emit('location-updated', updatePayload);

      // Update current location in MongoDB (single field update, no historical logs)
      ride.currentLocation = { lat, lng };
      await ride.save();
    } catch (err) {
      console.error('❌ Error handling update-location:', err.message);
    }
  });

  // Handle ending a ride
  socket.on('end-ride', async (data) => {
    try {
      const token = typeof data === 'string' ? data : data?.token;
      const reason = data?.reason || 'manual';

      if (!token) return;

      const endedAt = new Date();
      await Ride.findOneAndUpdate(
        { token },
        {
          status: 'ENDED',
          endedAt,
          endReason: reason,
        },
        { new: true }
      );

      io.to(token).emit('ride-ended', {
        token,
        status: 'ENDED',
        endedAt: endedAt.toISOString(),
        reason,
      });

      console.log(`🏁 Ride ended (${reason}): ${token}`);
    } catch (err) {
      console.error('❌ Error ending ride:', err.message);
    }
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Socket disconnected: ${socket.id}`);
  });
});

// Start server
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
