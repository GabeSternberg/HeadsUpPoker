/**
 * Server entry point — Express + Socket.IO server.
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

import { setupSocketHandlers } from './socketHandler';

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

setupSocketHandlers(io);

app.get('/', (_req, res) => {
  res.send('Heads-Up Poker Server is running');
});

httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
