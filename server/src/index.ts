/**
 * Server entry point — Express + Socket.IO server.
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs';

import { setupSocketHandlers } from './socketHandler';
import { initCSV, CSV_PATH } from './statsLogger';

const PORT = process.env.PORT || 3001;

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  ...(process.env.CLIENT_URL ? [process.env.CLIENT_URL] : []),
];

const app = express();
app.use(cors({ origin: allowedOrigins }));

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
  },
});

initCSV();
setupSocketHandlers(io);

app.get('/', (_req, res) => {
  res.send('Heads-Up Poker Server is running');
});

// Download hand history CSV (protected by EXPORT_KEY env var)
app.get('/export/hands.csv', (req, res) => {
  const key = process.env.EXPORT_KEY;
  if (key && req.query.key !== key) {
    res.status(401).send('Unauthorized');
    return;
  }
  if (!fs.existsSync(CSV_PATH)) {
    res.status(404).send('No data yet');
    return;
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="poker_hands.csv"');
  fs.createReadStream(CSV_PATH).pipe(res);
});

httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
