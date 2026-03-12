/**
 * Socket.IO event handler — manages player connections, lobby, and game actions.
 */

import { Server, Socket } from 'socket.io';
import { Room, createRoom, startHand, handleAction, getClientState, checkMatchOver, PlayerState } from './gameState';


export function setupSocketHandlers(io: Server): void {
  // Single room for simplicity
  let room: Room = createRoom();
  function broadcastState(): void {
    for (let i = 0; i < 2; i++) {
      const player = room.players[i];
      if (player && player.connected) {
        io.to(player.id).emit('gameState', getClientState(room, i));
      }
    }
  }

  function getPlayerIndex(socketId: string): number {
    return room.players.findIndex(p => p && p.id === socketId);
  }

  function startNextHand(): void {
    // Check if match is over
    if (checkMatchOver(room)) {
      broadcastState();
      return;
    }

    // Swap dealer
    room.dealerIndex = 1 - room.dealerIndex;

    startHand(room);
    broadcastState();
  }

  io.on('connection', (socket: Socket) => {
    console.log(`Player connected: ${socket.id}`);

    // Try to assign player to a slot
    let playerIndex = -1;

    // Check if this is a reconnection (not implemented — keep simple)
    for (let i = 0; i < 2; i++) {
      if (room.players[i] === null) {
        playerIndex = i;
        break;
      }
      // Allow reconnection to a disconnected slot
      if (!room.players[i]!.connected) {
        playerIndex = i;
        break;
      }
    }

    if (playerIndex === -1) {
      socket.emit('error', { message: 'Room is full' });
      socket.disconnect();
      return;
    }

    const isReconnect = room.players[playerIndex] !== null;
    room.players[playerIndex] = {
      id: socket.id,
      name: `Player ${playerIndex + 1}`,
      ready: isReconnect ? room.players[playerIndex]!.ready : false,
      connected: true,
      stack: isReconnect ? room.players[playerIndex]!.stack : room.settings.startingSum,
      holeCards: isReconnect ? room.players[playerIndex]!.holeCards : [],
      currentBetThisRound: 0,
    };

    socket.emit('assignPlayer', { index: playerIndex, name: `Player ${playerIndex + 1}` });
    broadcastState();

    // Lobby: update settings
    socket.on('updateSettings', (data: { startingSum?: number; bigBlind?: number }) => {
      if (room.gameStarted) return; // settings locked during game

      if (data.startingSum !== undefined) {
        const val = Math.floor(data.startingSum);
        if (val > 0) room.settings.startingSum = val;
      }
      if (data.bigBlind !== undefined) {
        const val = Math.floor(data.bigBlind);
        if (val > 0) room.settings.bigBlind = val;
      }

      broadcastState();
    });

    // Lobby: toggle ready
    socket.on('toggleReady', () => {
      const idx = getPlayerIndex(socket.id);
      if (idx === -1 || room.gameStarted) return;

      room.players[idx]!.ready = !room.players[idx]!.ready;

      // Check if both players are connected and ready
      if (room.players[0]?.connected && room.players[0]?.ready &&
          room.players[1]?.connected && room.players[1]?.ready) {
        room.gameStarted = true;
        room.players[0]!.stack = room.settings.startingSum;
        room.players[1]!.stack = room.settings.startingSum;
        room.dealerIndex = 0; // first connected player starts as dealer/SB

        startHand(room);
      }

      broadcastState();
    });

    // Game: player action
    socket.on('action', (data: { type: string; amount?: number }) => {
      const idx = getPlayerIndex(socket.id);
      if (idx === -1) return;

      const actionType = data.type;
      if (!['fold', 'check', 'call', 'raise'].includes(actionType)) {
        socket.emit('actionError', { message: 'Invalid action type' });
        return;
      }

      const result = handleAction(room, idx, {
        type: actionType as any,
        amount: data.amount,
      });

      if (!result.valid) {
        socket.emit('actionError', { message: result.error });
        return;
      }

      broadcastState();
    });

    // Next hand (manual trigger after showdown/fold)
    socket.on('nextHand', () => {
      if (!room.hand?.handOver) return;
      if (room.matchOver) return;
      startNextHand();
    });

    // Avatar mode: activate
    socket.on('activateAvatarMode', () => {
      room.avatarMode = true;
      broadcastState();
    });

    // Avatar mode: assign L or G to a player
    socket.on('setAvatarAssignment', (data: { playerIndex: number; role: 'L' | 'G' }) => {
      if (!room.avatarMode || room.gameStarted) return;
      if (data.playerIndex !== 0 && data.playerIndex !== 1) return;
      if (data.role !== 'L' && data.role !== 'G') return;

      const otherRole = data.role === 'L' ? 'G' : 'L';
      const otherIndex = 1 - data.playerIndex;
      room.avatarAssignment[data.playerIndex] = data.role;
      room.avatarAssignment[otherIndex] = otherRole;
      broadcastState();
    });

    // Reset match
    socket.on('resetMatch', () => {
      room = createRoom();
      // Re-assign both connected sockets
      const sockets = Array.from(io.sockets.sockets.values());
      for (let i = 0; i < sockets.length && i < 2; i++) {
        room.players[i] = {
          id: sockets[i].id,
          name: `Player ${i + 1}`,
          ready: false,
          connected: true,
          stack: room.settings.startingSum,
          holeCards: [],
          currentBetThisRound: 0,
        };
        sockets[i].emit('assignPlayer', { index: i, name: `Player ${i + 1}` });
      }
      broadcastState();
    });

    // Disconnect
    socket.on('disconnect', () => {
      console.log(`Player disconnected: ${socket.id}`);
      const idx = getPlayerIndex(socket.id);
      if (idx === -1) return;

      room.players[idx]!.connected = false;

      if (room.gameStarted && room.hand && !room.hand.handOver) {
        // Award pot to remaining player
        const winner = 1 - idx;
        if (room.players[winner]?.connected) {
          room.hand.handOver = true;
          room.hand.winner = winner;
          room.hand.resultMessage = `${room.players[idx]!.name} disconnected. ${room.players[winner]!.name} wins.`;
          room.players[winner]!.stack += room.hand.pot;
          room.hand.pot = 0;
          room.actionLog.push(room.hand.resultMessage);
          room.matchOver = true;
          broadcastState();
        }
      } else {
        broadcastState();
      }

      // Clean up after a delay if they don't reconnect
      setTimeout(() => {
        if (room.players[idx] && !room.players[idx]!.connected) {
          if (!room.gameStarted) {
            room.players[idx] = null;
            broadcastState();
          }
        }
      }, 10000);
    });
  });
}
