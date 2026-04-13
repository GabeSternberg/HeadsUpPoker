/**
 * Socket.IO event handler — manages player connections, lobby, and game actions.
 */

import { Server, Socket } from 'socket.io';
import { Room, createRoom, startHand, handleAction, getClientState, checkMatchOver, PlayerState, GameMode } from './gameState';

export function setupSocketHandlers(io: Server): void {
  let room: Room = createRoom();

  function broadcastState(): void {
    for (let i = 0; i < room.players.length; i++) {
      const player = room.players[i];
      if (player && player.connected) {
        io.to(player.id).emit('gameState', getClientState(room, i));
      }
    }
  }

  function getPlayerIndex(socketId: string): number {
    return room.players.findIndex(p => p && p.id === socketId);
  }

  function connectedCount(): number {
    return room.players.filter(p => p && p.connected).length;
  }

  function startNextHand(): void {
    if (checkMatchOver(room)) {
      broadcastState();
      return;
    }

    // Advance dealer to next active seat
    const activeSeats = room.players.map((p, i) => (p && p.stack > 0) ? i : -1).filter(i => i >= 0);
    if (activeSeats.length < 2) {
      broadcastState();
      return;
    }

    // Move dealer clockwise
    const sorted = [...activeSeats].sort((a, b) => a - b);
    let nextDealer = sorted.find(s => s > room.dealerIndex);
    if (nextDealer === undefined) nextDealer = sorted[0];
    room.dealerIndex = nextDealer;

    startHand(room);
    broadcastState();
  }

  io.on('connection', (socket: Socket) => {
    console.log(`Player connected: ${socket.id}`);

    let playerIndex = -1;

    if (room.mode === 'headsup') {
      // Heads-up: max 2 slots
      for (let i = 0; i < 2; i++) {
        if (room.players[i] === null) {
          playerIndex = i;
          break;
        }
        if (!room.players[i]!.connected) {
          playerIndex = i;
          break;
        }
      }
    } else {
      // Unlimited: find empty slot or add new
      for (let i = 0; i < room.players.length; i++) {
        if (room.players[i] === null) {
          playerIndex = i;
          break;
        }
        if (!room.players[i]!.connected && !room.gameStarted) {
          playerIndex = i;
          break;
        }
      }
      if (playerIndex === -1 && !room.gameStarted) {
        // Add new slot
        playerIndex = room.players.length;
        room.players.push(null);
        room.avatarAssignment.push(null);
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
      seatIndex: playerIndex,
    };

    socket.emit('assignPlayer', { index: playerIndex, name: `Player ${playerIndex + 1}` });
    broadcastState();

    // Set game mode (only before game starts)
    socket.on('setMode', (data: { mode: GameMode }) => {
      if (room.gameStarted) return;
      if (data.mode !== 'headsup' && data.mode !== 'unlimited') return;

      room.mode = data.mode;

      if (data.mode === 'headsup') {
        // Trim to 2 slots
        while (room.players.length > 2) {
          const last = room.players.pop();
          room.avatarAssignment.pop();
          if (last && last.connected) {
            io.to(last.id).emit('error', { message: 'Mode changed to 2-player' });
            io.sockets.sockets.get(last.id)?.disconnect();
          }
        }
        if (room.players.length < 2) {
          while (room.players.length < 2) {
            room.players.push(null);
            room.avatarAssignment.push(null);
          }
        }
      }

      broadcastState();
    });

    // Update settings
    socket.on('updateSettings', (data: { startingSum?: number; bigBlind?: number; uiMode?: 'mobile' | 'pc' }) => {
      if (data.uiMode === 'mobile' || data.uiMode === 'pc') {
        room.settings.uiMode = data.uiMode;
      }

      if (room.gameStarted) {
        broadcastState();
        return;
      }

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

    // Toggle ready
    socket.on('toggleReady', () => {
      const idx = getPlayerIndex(socket.id);
      if (idx === -1 || room.gameStarted) return;

      room.players[idx]!.ready = !room.players[idx]!.ready;

      // Check if all connected players are ready (min 2)
      const connected = room.players.filter(p => p && p.connected);
      if (connected.length >= 2 && connected.every(p => p!.ready)) {
        room.gameStarted = true;
        for (const p of room.players) {
          if (p) p.stack = room.settings.startingSum;
        }
        room.dealerIndex = 0;
        startHand(room);
      }

      broadcastState();
    });

    // Player action
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

    // Next hand (manual trigger)
    socket.on('nextHand', () => {
      if (!room.hand?.handOver) return;
      if (room.matchOver) return;
      startNextHand();
    });

    // Rebuy (unlimited mode only)
    socket.on('rebuy', () => {
      if (room.mode !== 'unlimited') return;
      const idx = getPlayerIndex(socket.id);
      if (idx === -1) return;
      if (room.players[idx]!.stack > 0) return; // can only rebuy when busted

      room.players[idx]!.stack = room.settings.startingSum;
      broadcastState();
    });

    // Leave table (unlimited mode only)
    socket.on('leaveTable', () => {
      if (room.mode !== 'unlimited') return;
      const idx = getPlayerIndex(socket.id);
      if (idx === -1) return;

      // If they're in a hand, fold them
      if (room.hand && !room.hand.handOver && !room.hand.playerFolded[idx]) {
        room.hand.playerFolded[idx] = true;
        room.hand.playerActedThisRound[idx] = true;
        // Check if hand should end
        const nonFolded = room.hand.participants.filter(s => !room.hand!.playerFolded[s]);
        if (nonFolded.length === 1) {
          room.hand.handOver = true;
          room.hand.winner = nonFolded[0];
          room.hand.resultMessage = `${room.players[nonFolded[0]]!.name} wins the pot (${room.hand.pot})`;
          room.players[nonFolded[0]]!.stack += room.hand.pot;
          room.hand.pot = 0;
          room.actionLog.push(room.hand.resultMessage);
        }
      }

      room.players[idx] = null;
      socket.emit('kicked', { message: 'You left the table' });
      socket.disconnect();
      broadcastState();
    });

    // Avatar mode
    socket.on('activateAvatarMode', () => {
      room.avatarMode = true;
      broadcastState();
    });

    socket.on('setAvatarAssignment', (data: { playerIndex: number; role: 'L' | 'G' }) => {
      if (!room.avatarMode || room.gameStarted) return;
      if (data.playerIndex < 0 || data.playerIndex >= room.players.length) return;
      if (data.role !== 'L' && data.role !== 'G') return;

      const otherRole = data.role === 'L' ? 'G' : 'L';
      const otherIndex = data.playerIndex === 0 ? 1 : 0;
      room.avatarAssignment[data.playerIndex] = data.role;
      if (otherIndex < room.players.length) {
        room.avatarAssignment[otherIndex] = otherRole;
      }
      broadcastState();
    });

    // Kick player (lobby only)
    socket.on('kickPlayer', (data: { targetIndex: number }) => {
      if (room.gameStarted) return;
      const { targetIndex } = data;
      if (targetIndex < 0 || targetIndex >= room.players.length) return;
      const target = room.players[targetIndex];
      if (!target) return;

      const targetSocket = io.sockets.sockets.get(target.id);
      room.players[targetIndex] = null;
      targetSocket?.emit('kicked', { message: 'You were kicked from the lobby' });
      targetSocket?.disconnect();
      broadcastState();
    });

    // Reset match
    socket.on('resetMatch', () => {
      room = createRoom();
      const sockets = Array.from(io.sockets.sockets.values());
      for (let i = 0; i < sockets.length && i < 2; i++) {
        room.players[i] = {
          id: sockets[i].id,
          name: `Player ${i + 1}`,
          ready: false,
          connected: true,
          stack: room.settings.startingSum,
          holeCards: [],
          seatIndex: i,
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
        if (room.mode === 'headsup') {
          const winner = 1 - idx;
          if (room.players[winner]?.connected) {
            room.hand.handOver = true;
            room.hand.winner = winner;
            room.hand.resultMessage = `${room.players[idx]!.name} disconnected. ${room.players[winner]!.name} wins.`;
            room.players[winner]!.stack += room.hand.pot;
            room.hand.pot = 0;
            room.actionLog.push(room.hand.resultMessage);
            room.matchOver = true;
          }
        } else {
          // Unlimited: fold disconnected player
          if (!room.hand.playerFolded[idx]) {
            room.hand.playerFolded[idx] = true;
            room.hand.playerActedThisRound[idx] = true;
            room.actionLog.push(`${room.players[idx]!.name} disconnected and folds`);

            const nonFolded = room.hand.participants.filter(s => !room.hand!.playerFolded[s]);
            if (nonFolded.length === 1) {
              room.hand.handOver = true;
              room.hand.winner = nonFolded[0];
              room.hand.resultMessage = `${room.players[nonFolded[0]]!.name} wins the pot (${room.hand.pot})`;
              room.players[nonFolded[0]]!.stack += room.hand.pot;
              room.hand.pot = 0;
              room.actionLog.push(room.hand.resultMessage);
            } else if (room.hand.currentPlayerIndex === idx) {
              // It was their turn — advance
              const active = room.hand.participants.filter(
                s => !room.hand!.playerFolded[s] && !room.hand!.playerAllIn[s]
              );
              if (active.length > 0) {
                // Find next active player after this one
                const participants = room.hand.participants;
                const myParIdx = participants.indexOf(idx);
                for (let step = 1; step < participants.length; step++) {
                  const nextIdx = (myParIdx + step) % participants.length;
                  const seat = participants[nextIdx];
                  if (!room.hand.playerFolded[seat] && !room.hand.playerAllIn[seat]) {
                    room.hand.currentPlayerIndex = seat;
                    break;
                  }
                }
              }
            }
          }
        }
        broadcastState();
      } else {
        broadcastState();
      }

      // Clean up after delay
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
