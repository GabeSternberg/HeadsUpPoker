# Heads-Up Texas Hold'em

A multiplayer heads-up no-limit Texas Hold'em web app. Two players connect via separate browser windows and play a full heads-up poker match.

## Quick Start

Open two terminal windows:

**Terminal 1 — Server:**
```bash
cd server
npm install
npm run dev
```

**Terminal 2 — Client:**
```bash
cd client
npm install
npm run dev
```

Open **two browser tabs** to `http://localhost:5173`. Each tab is a separate player.

## Architecture

### Server (Node.js + Express + Socket.IO)

All game state is authoritative on the server. The client never evaluates hands, deals cards, or validates actions.

**Modules:**
- `deck.ts` — Standard 52-card deck with Fisher-Yates shuffle
- `handEvaluator.ts` — Full 7-card hand evaluation (checks all 21 five-card combinations). Supports all hand rankings with proper tie-breaking
- `betting.ts` — No-limit betting logic: validates fold/check/call/raise, enforces minimum raise rules, handles all-in
- `gameState.ts` — Core game state machine: manages room, lobby, hands, round progression, showdown, pot settlement
- `socketHandler.ts` — Socket.IO event handlers: player connection, settings sync, ready/start, actions, disconnect, reset

### Client (React + TypeScript + Vite)

Thin display layer. Receives full state from the server on every update and renders it.

**Components:**
- `Lobby` — Player list, settings inputs, ready button
- `Game` — Board, player areas, cards, pot, turn indicator
- `ActionPanel` — Context-sensitive action buttons (fold/check/call/raise with slider)
- `ActionLog` — Scrollable action history
- `Card` — Card rendering with suit colors

## Game Rules Implemented

### Heads-Up Betting Order
- **Preflop:** Dealer/SB acts first
- **Postflop:** BB acts first
- Dealer/blinds swap after each hand

### Raise Rules
- Minimum raise = size of last raise (preflop: BB counts as opening bet)
- Minimum opening bet postflop = 1 BB
- All-in allowed even if below minimum raise
- Call all-in for less allowed

### Hand Evaluation
All standard rankings: Royal Flush through High Card. Ace-low straights (A-2-3-4-5) supported. Full tie-breaking per standard poker rules. Suits never break ties.

### Pot Settlement
Two-player only — no side pots needed. On unequal all-ins, pot is capped correctly by limiting bets to stack size. Winner takes entire pot; ties split evenly (odd chip to BB).

## Assumptions & Design Choices

1. **Single room:** Only one game session at a time. For simplicity, there's no room code system.
2. **No authentication:** Players are identified by socket connection order (Player 1, Player 2).
3. **Disconnect = forfeit:** During a hand, disconnecting awards the pot and match to the opponent. In the lobby, the slot reopens after 10 seconds.
4. **3-second delay** between hands for result display.
5. **Fractional small blind:** When BB is odd, SB is BB/2 (e.g., BB=21 → SB=10.5). This matches the spec's allowance for fractional chips on the small blind.
