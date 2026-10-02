# Share Ride

A Google Maps feature prototype that lets a passenger share a temporary live ride through a private link.

## Tech Stack

| Layer     | Technology                                  |
| --------- | ------------------------------------------- |
| Frontend  | React + Vite                                |
| Backend   | Node.js + Express                           |
| Database  | MongoDB + Mongoose                          |
| Real-time | Socket.IO                                   |
| Maps      | Google Maps JavaScript API + Routes API     |

## Project Structure

```
Share-Ride/
├── frontend/          # React + Vite client
│   ├── src/
│   │   ├── App.jsx
│   │   ├── App.css
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── vite.config.js
│   └── .env.example
├── backend/           # Express + Socket.IO server
│   ├── server.js
│   └── .env.example
├── .gitignore
└── README.md
```

## Getting Started

### Prerequisites

- Node.js (v18+)
- MongoDB (local or Atlas)
- Google Maps API key

### 1. Clone the repository

```bash
git clone https://github.com/Lakshay-Gautam07/Share-Ride.git
cd Share-Ride
```

### 2. Backend setup

```bash
cd backend
cp .env.example .env    # Edit .env with your MongoDB URI
npm install
npm run dev
```

The backend starts on `http://localhost:5000`.

### 3. Frontend setup

```bash
cd frontend
cp .env.example .env    # Edit .env with your Google Maps API key
npm install
npm run dev
```

The frontend starts on `http://localhost:5173`.

## Environment Variables

### Backend (`backend/.env`)

| Variable      | Description              |
| ------------- | ------------------------ |
| `PORT`        | Server port (default: 5000) |
| `MONGODB_URI` | MongoDB connection string |

### Frontend (`frontend/.env`)

| Variable                   | Description              |
| -------------------------- | ------------------------ |
| `VITE_API_URL`             | Backend API URL          |
| `VITE_GOOGLE_MAPS_API_KEY` | Google Maps API key      |

> **Note:** Never commit `.env` files. Use `.env.example` as a template.

## License

ISC
