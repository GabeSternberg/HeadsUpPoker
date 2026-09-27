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

Open http://localhost:5173. The default **Heads-up** tab automatically joins one shared two-player table as Player 1 or Player 2, with no create/join form. The **Multiplayer** tab contains the table directory, private invites, host controls, seat requests, and ledger. An invite URL opens Multiplayer directly. Switching tabs keeps each connection and seat intact; each has its own saved reconnect credential.

## Default heads-up table

- The first two visitors take the available seats before a game starts. Other visitors see recovery controls.
- Enter password `123` to rejoin as Player 1 or Player 2. In secret/avatar mode the buttons use the assigned Gabe/Liana names.
- Reclaiming a seat preserves its chips, cards, betting turn, and avatar. The previous connection becomes a viewer and loses action privileges. A seated player cannot switch to the other seat.
- Either seated player can adjust lobby settings, configure avatars, pause/resume, and advance hands. Disconnects pause the current hand until both players return and someone resumes.
- Password `123` also resets the table, even during a hand: clear the hand and stats, restore starting chips, clear ready flags, and return to the lobby. Settings and avatar assignments remain. Connected players keep their seats; disconnected seats are released. An unseated reset caller takes an available seat if there is one.
- Reset and recovery apply only to this shared table. It is never listed in Multiplayer, and its reset cannot touch multiplayer games.

For Multiplayer, create a game, share its invite link or six-character code, and join from another tab/device.

## Multiplayer table flow

- Create a game in a category; the creator is the host. The category is fixed for that table.
- Heads-up joiners automatically take an available seat before a hand. Multi-handed joiners watch first and request a specific seat.
- The host approves/declines seat requests and sets each approved player's buy-in. Players ready up to start with at least two funded players.
- The host can add chips, remove chips, or set an exact stack (including zero) for any seated player. During a hand, chip changes and seat approvals queue until the hand finishes. Set stack targets the final balance; Remove subtracts from the final balance. Queued changes can be cancelled. A change that would leave the final stack below zero or above 1,000,000 is cancelled and logged. They never alter active-hand stacks or side-pot accounting.
- The default buy-in setting supplies the approval form's default amount; it does not overwrite approved multi-handed stacks. Use Add chips for existing stacks.
- Only the host can change shared settings, pause/resume, reset to the lobby, remove players, or control virtual-card dealing. Anyone seated can request the next hand once the previous hand ends.
- Leaving or removing a seated player is allowed between hands. The host role passes to another connected member when the host leaves, or to a remaining member if everyone else is offline.
- Use Sit out to hold your seat and chips without being dealt in or posting blinds. During your active hand this queues until the hand ends; you must still finish that hand. Sit back in makes you eligible for the next hand.
- Hosts can explicitly transfer control to any connected member without leaving.
- Cash out & stand up records your remaining stack and frees your seat between hands; you remain a viewer and can request another buy-in. Leaving or host removal also records a cash-out.
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

Public games appear in the table directory. Private games are hidden and require a random 128-bit access key as well as the game code. Copy invite link includes the key in the URL fragment; you can also enter the key manually. Anyone with the private invite can join/watch and share it onward. Reconnect credentials are stored in sessionStorage and never included in the directory or invite URLs. The legacy shared admin-password reset is removed.

## Session ledger

The ledger records each seat buy-in, applied host top-up, host stack adjustments, cash-out on standing/leaving/removal, and heads-up starting-stack adjustments. Queued chip changes are recorded only when applied. Host reductions appear as cash-outs; increases appear as buy-ins, with the adjustment reason preserved. It uses a separate player ID, so repeated buy-ins by a member aggregate while two players with the same name remain distinct. Entries survive hands, reconnects and lobby resets. Virtual-card tables do not maintain chip ledgers.

All table members can view and download the session ledger as JSON. A final snapshot is saved in the departing player's browser session, including the last cash-out, and appears in the directory as Previous game. These are chip-accounting records, not payment transfers. Server ledgers are in memory and disappear when the table is deleted or the server restarts; download a copy for longer-term records.

## Next priorities

- Durable table/session storage so games survive backend deploys and restarts.
- Disconnect grace periods, automatic check/fold, and host recovery if someone never returns. Currently an active hand can remain paused indefinitely.
- Seat-request cancellation and private invite-key rotation.
- Durable ledger storage across server restarts and completed-session results.
- Broader poker-rules regression coverage (short all-in raises, split/odd-chip pots, and disconnections at every betting phase).
