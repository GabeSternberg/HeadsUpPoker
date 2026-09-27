# Poker Tables

React/Vite client and an authoritative Node/Socket.IO poker server. Supports concurrent independent heads-up, multi-handed (up to 9 seats), and virtual-card tables.

## Run locally

Install dependencies in both `server` and `client` with `npm install`, then run in separate terminals:

```sh
cd server
npm run dev
```

```sh
cd client
npm run dev
```

Open http://localhost:5173. Create a game, share its invite link or six-character code, and join from another tab/device. Each tab has its own session credential; refreshing or reconnecting restores that seat.

## Table flow

- Create a game in a category; the creator is the host. The category is fixed for that table.
- Heads-up joiners automatically take an available seat before a hand. Multi-handed joiners watch first and request a specific seat.
- The host approves/declines seat requests and sets each approved player's buy-in. Players ready up to start with at least two funded players.
- The host can add chips to any seated player. During a hand, additions and seat approvals queue until the hand finishes. They never alter active-hand stacks or side-pot accounting.
- The default buy-in setting supplies the approval form's default amount; it does not overwrite approved multi-handed stacks. Use Add chips for existing stacks.
- Only the host can change shared settings, pause/resume, reset to the lobby, remove players, or control virtual-card dealing. Anyone seated can request the next hand once the previous hand ends.
- Leaving or removing a seated player is allowed between hands. The host role passes to another connected member when the host leaves, or to a remaining member if everyone else is offline.
- Disconnects preserve seats and pause an active hand. Reconnect in the same tab, then have the host resume. A different player cannot claim the disconnected seat.
- Resets preserve table membership and stacks; they return players to the lobby. Add chips as needed before readying again.
- Private cards stay hidden from other players and spectators, except non-folded hands at showdown.

## Validation

```sh
npm run build --prefix server
npm run build --prefix client
npm test --prefix server
```

Tests require both packages' dependencies installed. Socket tests open a local loopback listener. Coverage includes table isolation, host permissions, seat approvals, deferred top-ups, reconnect credentials, malformed requests, card privacy, two-player blind order in multi-handed games, and chip conservation with unequal multiway all-ins.

## Deployment configuration

The client reads `VITE_SERVER_URL` for the backend URL (default `http://localhost:3001`). The server reads `PORT` (default `3001`) and `CLIENT_URL` for the allowed deployed frontend origin. Build/start the server with `npm run build` / `npm start`; build the client with `npm run build` and serve `client/dist`.

Tables and reconnect credentials currently live in memory in one server process. Keep a single backend instance with this implementation. Server restarts/redeploys clear tables; shared durable storage and coordination are required before supporting multiple backend instances. Disconnected/abandoned tables expire after 24 hours without a state update; tables with connected members are retained.

The table directory is visible to all visitors; invite codes are convenience identifiers, not private-room passwords. Reconnect credentials are stored in sessionStorage and never included in the directory or invite URLs. The legacy shared admin-password reset is removed.

## Next priorities

- Durable table/session storage so games survive backend deploys and restarts.
- Disconnect grace periods, automatic check/fold, and host recovery if someone never returns. Currently an active hand can remain paused indefinitely.
- Sit-out / sit-back-in controls, seat-request cancellation, and host transfer without leaving.
- Private/unlisted games and optional access codes.
- A persistent buy-in/cash-out ledger and session results. Current chip changes appear in the current action log, which resets each hand.
- Broader poker-rules regression coverage (short all-in raises, split/odd-chip pots, and disconnections at every betting phase).
