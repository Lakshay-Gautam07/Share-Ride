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

      const updatePayload = {
        lat,
        lng,
        updatedAt: new Date().toISOString(),
      };

      // Broadcast new location to all clients tracking this ride
      io.to(token).emit('location-updated', updatePayload);

      // Update current location in MongoDB (single document field update, no historical logs)
      await Ride.findOneAndUpdate(
        { token, status: 'active' },
        { currentLocation: { lat, lng } }
      );
    } catch (err) {
      console.error('❌ Error handling update-location:', err.message);
    }
  });

  // Handle ending a ride
  socket.on('end-ride', async ({ token }) => {
    try {
      if (!token) return;

      const ride = await Ride.findOneAndUpdate(
        { token },
        { status: 'completed' },
        { new: true }
      );

      io.to(token).emit('ride-ended', {
        token,
        status: 'completed',
        completedAt: new Date().toISOString(),
      });
      console.log(`🏁 Ride completed: ${token}`);
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
