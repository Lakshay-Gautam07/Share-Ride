const mongoose = require('mongoose');

const rideSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'cancelled', 'ENDED'],
    default: 'active',
  },
  origin: {
    type: String,
    required: true,
  },
  destination: {
    type: String,
    required: true,
  },
  destinationCoords: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
  },
  currentLocation: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
  },
  route: {
    distance: { type: String },
    duration: { type: String },
    polyline: { type: String },
  },
  startedAt: {
    type: Date,
    default: Date.now,
  },
  endedAt: {
    type: Date,
  },
  endReason: {
    type: String,
    enum: ['manual', 'destination_reached', 'cancelled'],
  },
  lastLocationTimestamp: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Ride', rideSchema);
