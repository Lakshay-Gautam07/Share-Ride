import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

function App() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io(API_URL);

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <div className="app">
      <h1>🚗 Share Ride</h1>
      <p>Share your live ride location through a private link.</p>
      <div className={`status ${connected ? 'online' : 'offline'}`}>
        <span className="dot" />
        {connected ? 'Connected to server' : 'Disconnected'}
      </div>
    </div>
  );
}

export default App;
