import Http from 'http';
import Path from 'path';
import Helmet from 'helmet';
import Express from 'express';
import SocketIO from 'socket.io';
import Compression from 'compression';

import { ANIMAL_COUNT } from '../shared/animals';
import {
  NICKNAME_MAX_LENGTH, MAX_LOBBY_PLAYERS, MAX_PLAYERS, STAGE_2_MAX_GROUP_SIZE,
} from '../shared/roomConfig';
import { RECONNECT_GRACE_MS } from '../shared/roundConfig';
import Room from './Room';

// A crash from one bad message (or an edge case this file didn't
// anticipate) would otherwise take down every room and every player at
// once. Log it and keep the party going instead of exiting.
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception (server kept running):', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection (server kept running):', error);
});

// Server setup.
const app = Express();
const server = Http.Server(app);
const io = SocketIO(server);
const port = process.env.PORT || 0;

// Cloud Run terminates TLS at its edge and forwards plain HTTP internally,
// setting X-Forwarded-* headers. Nothing in this app currently reads req.ip
// or issues secure cookies, so this isn't load-bearing today — but declaring
// the single, trusted upstream proxy is the correct posture for this
// deployment and avoids a footgun if IP-based logging/limiting is ever added.
app.set('trust proxy', 1);

// Fire up Helmet and Compression for better Express security and performance.
// Helmet 3's defaults do NOT enable a Content-Security-Policy and its HSTS
// middleware only *sets* a header (it never redirects), so nothing here forces
// an HTTP->HTTPS redirect or interferes with Socket.io's WebSocket upgrade
// (that upgrade happens at the raw HTTP server, not through Express middleware).
app.use(Helmet());
app.use(Compression());

// Lightweight health endpoint for Cloud Run probes. Cheaper and more robust
// than the '/' route (which reads index.html off disk), and it reports 503
// once shutdown has begun so Cloud Run stops routing new traffic to a draining
// instance instead of handing it connections it's about to drop.
// NOTE: this is deliberately NOT '/healthz' — on this project's *.run.app
// domain, requests to exactly that path never reached this container at all
// (compare to any other unmatched path, which does reach Express's own 404
// handler with our Helmet headers and x-cloud-trace-context intact); some
// layer of Google's edge infra appears to intercept/cache that specific path
// ahead of the app. Verified directly against the live deployment.
app.get('/api/health', function(request, response) {
  if (shuttingDown) {
    response.status(503).send('shutting down');
    return;
  }
  response.status(200).send('ok');
});

// Add static file middleware (to serve static files).
// The webpack bundle ships under a fixed name (bundle.js, no content hash),
// so it can't be cached immutably — a deploy reuses the same URL for new
// bytes. Use a short max-age plus must-revalidate: browsers may reuse it
// within the window but always revalidate against the server afterward
// (a 304 when unchanged is nearly free), so a returning player — including
// the reconnect flow's own page reload — doesn't re-download ~1.2MB every
// time, while a fresh deploy still reaches everyone within the window
// rather than being pinned behind a stale immutable cache.
app.use('/public', Express.static(Path.join(__dirname, '../public'), {
  maxAge: '5m',
  setHeaders: (response, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      response.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    }
  },
}));

// Request router.
app.get('/', function(request, response) {
  // Never let a stale index.html get cached: it's the entry point that
  // references the bundle, and it's tiny, so it should always be
  // revalidated so a new deploy is picked up immediately.
  response.setHeader('Cache-Control', 'no-cache');
  response.sendFile(Path.join(__dirname, '../public/index.html'));
})

// Tell server to start listening for connections.
server.listen(port, () => {
  console.log('\n🕺 server init complete, listening for connections on port ' + server.address().port + ' 💃\n');

  setServerHandlers();
  tickInterval = setInterval(tickAllRooms, 1000);
  botTickInterval = setInterval(tickAllBots, BOT_TICK_MS);
});

// Graceful shutdown. Cloud Run sends SIGTERM before recycling an instance
// (deploys, scaling, maintenance) and waits a short grace period before
// SIGKILL. All game state is in-memory in this one process, so we can't
// preserve matches across the restart — but we can stop the tick loop and
// close connections cleanly. Closing the Socket.io server disconnects every
// client, which the client already handles: it shows its "reconnecting"
// banner and reloads on reconnect (see src/client/net/socket.js), so players
// land back at the login screen on the fresh instance rather than staring at
// a frozen game. We deliberately don't emit a bespoke "server shutting down"
// event because the client has no handler for one — the existing
// disconnect/reload flow is the notification.
let shuttingDown = false;
let tickInterval = null;
let botTickInterval = null;

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down gracefully...`);

  if (tickInterval) {
    clearInterval(tickInterval);
  }
  if (botTickInterval) {
    clearInterval(botTickInterval);
  }

  // Safety net: if closing connections hangs, force-exit before Cloud Run's
  // SIGKILL so shutdown is deterministic. Well under the default ~10s grace
  // period. unref() so this timer alone can't keep the process alive.
  const forceExit = setTimeout(() => {
    console.error('Graceful shutdown timed out; forcing exit.');
    process.exit(1);
  }, 8000);
  forceExit.unref();

  // io.close() stops accepting new connections, disconnects all sockets, and
  // closes the underlying HTTP server, then fires this callback.
  io.close(() => {
    console.log('All connections closed; exiting cleanly.');
    clearTimeout(forceExit);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// One room throwing mid-tick would otherwise abort the forEach and skip the
// timer check for every room after it that same second — isolate each so a
// single bad room can't stall the rest of a 40-person tournament.
function tickAllRooms() {
  rooms.forEach((room) => {
    try {
      room.checkRoundState();
    } catch (error) {
      console.error(`Room ${room.id} tick failed:`, error);
    }
  });
  broadcastDashboard();
}

// Feeds the admin's multi-room dashboard (stage 1/2 only — see
// startStage()'s 'dashboardStarting' branch). `rooms` only ever holds the
// *current* stage's rooms (finished ones are deleted in
// handleRoomFinished() before the next stage's are created), so every
// summary gathered here already belongs to `currentStage` with no extra
// filtering needed.
function broadcastDashboard() {
  if (currentStage === 0 || currentStage > 2 || (adminSockets.size === 0 && spectatorSockets.size === 0)) {
    return;
  }
  const summaries = [];
  rooms.forEach((room) => {
    try {
      summaries.push(room.getSummary());
    } catch (error) {
      console.error(`Room ${room.id} summary failed:`, error);
    }
  });
  // Fan out through the shared DASHBOARD_ROOM rather than a per-socket emit
  // loop. This runs every second and each payload embeds every room's full
  // tileMap (~300 tiles x N rooms), so with the old loop socket.io
  // re-serialized that entire ~3KB+ blob once per admin/spectator; through a
  // room it serializes once and fans out natively. isAdmin was dropped from
  // the payload deliberately: DashboardScene only ever reads isAdmin from
  // its scene-entry data (dashboardStarting/gameStarting), never from these
  // per-tick dashboardUpdate messages, so it was a dead field here — and
  // dropping it is exactly what lets every recipient share one identical
  // payload. Admin-vs-spectator capability is already fixed at scene entry.
  io.to(DASHBOARD_ROOM).emit('dashboardUpdate', { stage: currentStage, rooms: summaries });
}

// Seats a real player cut from the bracket into the dashboard the room's
// still-ongoing stage already gives an admin, the moment their own room
// finishes -- not waiting for the next stage to start. Bots (no real
// socket) and anyone already an admin or already spectating are silently
// skipped. Only ever called for stage 1/2 (TEAM mode's own branches in
// handleRoomFinished) -- stage 3 has nothing after it to spectate, and a
// stage-3 elimination already gets an in-place ghost view of the same room
// (see Room.js's handleOwnElimination-equivalent client logic), no
// re-seating needed.
function seatSpectator(socketId) {
  if (adminSockets.has(socketId) || spectatorSockets.has(socketId)) {
    return;
  }
  const socket = io.sockets.sockets[socketId];
  if (!socket) {
    return;
  }
  spectatorSockets.add(socketId);
  socket.join(DASHBOARD_ROOM);
  socket.emit('dashboardStarting', { stage: currentStage, roomCount: rooms.size, isAdmin: false });
}

// Bots move on their own faster cadence, separate from the 1s round-state
// tick (mass collapse / timeout / auto-regen) — a real player sends a
// steady stream of small movements every frame, so bots stepping only once
// a second read as barely moving by comparison.
//
// This drives how often tickAllBots() itself runs, not how often any one
// bot actually steps — each bot now gets its own random movement interval
// (Room.js's BOT_MOVE_INTERVAL_MIN_MS..MAX_MS, 300-600ms, assigned once per
// bot) so a room's bots amble at slightly different, more organic paces
// instead of every single one stepping in lockstep on the same beat. This
// tick just needs to run finer than the *fastest* possible per-bot interval
// (300ms) so no bot's own due-time is ever missed by more than a tick's
// worth of slack.
const BOT_TICK_MS = 100;

function tickAllBots() {
  rooms.forEach((room) => {
    try {
      room.moveBotsRandomly();
    } catch (error) {
      console.error(`Room ${room.id} bot tick failed:`, error);
    }
  });
}

let globalPhase = 'LOBBY'; // 'LOBBY' | 'TOURNAMENT'
let lobbyPlayers = {}; // socketId -> { nickname, isBot }

const rooms = new Map(); // roomId -> Room
const socketRoomMap = new Map(); // socketId -> roomId

let roomCounter = 0;
let botCounter = 0;

// Admin mode: entering this password on the login screen (checked
// server-side only, never shipped to the client) grants a socket the
// ability to start the tournament and add test bots. Regular players
// can't start a game themselves — the "게임 시작" button only appears for
// whoever is holding this.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '3927';
const adminSockets = new Set();
// Real players cut from the bracket (not bots, and not already an admin)
// who stay connected to watch the rest of the tournament play out — seated
// into the exact same dashboard/spectator broadcasts an admin already gets
// (broadcastDashboard, and startStage()'s stage-3+ room-join), just for a
// non-admin viewer. Never gains isAdmin: true in any payload, so admin-only
// controls (C/S skills, 서버 초기화, jumping into an arbitrary room mid-
// stage) stay hidden/inert for them even though they're seeing the same
// screens. Cleared per-tournament (endTournament/resetServerState), same
// as disconnectedSockets.
const spectatorSockets = new Set();
// Sticky once true for the life of this process -- deliberately NOT the
// same thing as "an admin socket is currently connected" (adminSockets.size
// > 0). That used to be exactly what gated new joins, which meant any
// momentary drop of the admin's own connection (a backgrounded mobile
// browser suspending its WebSocket, a brief network hiccup, the
// disconnect-banner's own forced page reload swapping in a new socket.id
// before they've logged back in as admin) instantly relocked the door for
// every other participant with "no-session" until *someone* happened to
// notice and re-enter the admin password -- reported in practice as
// players unable to join right after a round had just ended, i.e. exactly
// when the admin's device is most likely to have gone idle/backgrounded
// waiting on the round to finish. Once an admin has authenticated even
// once, the event is presumed genuinely underway and stays open regardless
// of that specific socket's later connection state; resetServer/clearLobby
// intentionally don't touch this either, since both exist to keep the same
// event going, not to close it back up.
let sessionOpened = false;

// Bracket state: each stage is an array of "lineages" ({ members, score }).
// A fixed 3-stage shape: stage 1's lineages are however many MAX_PLAYERS-
// capped random groups chunkForInitialRound() produces (grows with turnout,
// not a fixed count); stage 2's are however many STAGE_2_MAX_GROUP_SIZE-
// capped groups formStage2Groups() produces from pooling and reshuffling
// every stage-1 survivor, the same shape at a bigger cap; stage 3 is a
// single pooled SOLO room (formStage3Group) that ends the tournament
// itself. A lineage that loses every member before its stage transition is
// locked into the final ranking immediately and does not pass its score on.
let currentStage = 0;
let stagePending = 0;
let stageResults = [];
let finalRankings = [];

// A survivor can be sitting between rooms (their lineage finished but is
// still waiting on a sibling lineage to merge with) when they disconnect.
// There's no active Room to notify at that moment, so we remember it here
// and skip them when the next stage's rooms are built instead of letting a
// disconnected player's slot silently resurrect as an unpiloted "ghost" who
// can never be eliminated and would wrongly ride along to the next round.
const disconnectedSockets = new Set();

// Reconnect support. sessionToken (a stable per-browser id the client sends
// with join and reconnectAttempt) is the thing we match a returning player
// against, since their socket.id changes on every reconnect. tokenToSocket
// maps a live token to the socket.id currently holding it; graceTimers holds
// the RECONNECT_GRACE_MS countdown for a token whose socket just dropped
// mid-round — during that window the player's avatar is bot-proxied inside
// its Room (Room.beginProxyControl) rather than eliminated, and a
// reconnectAttempt with the same token reclaims it. If the timer fires first,
// the reclaim window is over and the normal disconnect elimination runs.
const tokenToSocket = new Map();
const socketToToken = new Map();
const graceTimers = new Map();
// Same idea as graceTimers, for a survivor whose socket drops while sitting
// *between* stages (their own room already finished -- socketRoomMap has no
// entry for them, so graceTimers/beginProxyControl's mid-room bot-proxy path
// doesn't apply; there's no live avatar to proxy yet). Without this, a bare
// connectivity blip during that wait (venue wifi hiccup, not necessarily
// anything the player did) used to write them off the bracket immediately
// via disconnectedSockets even though there's nothing to actually be "gone"
// from -- see the 'disconnect' handler's own use of this map. If enough of a
// newly-pooled stage's members hit this at once, startStage()'s
// disconnectedSockets filter could empty the whole stage and end the
// tournament right as it should have started (reported in practice: a room
// full of survivors sees "다음 라운드를 기다리는 중" and then the tournament
// just ends the moment the next stage would have begun).
const betweenRoundsGraceTimers = new Map();

// A single socket.io room that every admin and cut-player spectator joins,
// so broadcastDashboard() can fan its (large, every-second) payload out
// with one serialization instead of a per-socket emit loop.
const DASHBOARD_ROOM = 'dashboard-viewers';

function clearGraceTimer(token) {
  const timer = graceTimers.get(token);
  if (timer) {
    clearTimeout(timer);
    graceTimers.delete(token);
  }
}

function clearBetweenRoundsGraceTimer(token) {
  const timer = betweenRoundsGraceTimers.get(token);
  if (timer) {
    clearTimeout(timer);
    betweenRoundsGraceTimers.delete(token);
  }
}

// A between-rounds reconnect returns under a brand new socket.id (a page
// reload, same as every other reconnect -- see net/socket.js). Patches that
// new id into any still-pending stageResults entry so the next stage's own
// formStage2Groups()/formStage3Group() pooling (and startStage()'s
// disconnectedSockets filter) finds this player under their current, live
// connection instead of the now-dead old one. A no-op once stageResults has
// already been consumed by startStage() for this stage -- see the
// 'reconnectAttempt' handler's own socketRoomMap re-check for that case.
function patchPendingSocketId(oldSocketId, newSocketId) {
  stageResults.forEach((lineage) => {
    if (!lineage) {
      return;
    }
    lineage.members.forEach((m) => {
      if (m.socketId === oldSocketId) {
        m.socketId = newSocketId;
      }
    });
  });
}

// Tears down all reconnect-tracking state at once. Called when a tournament
// ends or the server is reset — without this, any grace timer still counting
// down would fire ~20s later against an already-torn-down tournament, and
// (more importantly) the token<->socket maps would accumulate an entry per
// player across every tournament for as long as the instance stays up, the
// same unbounded-growth class of leak as the disconnectedSockets one.
function clearReconnectState() {
  graceTimers.forEach((timer) => clearTimeout(timer));
  graceTimers.clear();
  betweenRoundsGraceTimers.forEach((timer) => clearTimeout(timer));
  betweenRoundsGraceTimers.clear();
  tokenToSocket.clear();
  socketToToken.clear();
}

function sanitizeNickname(raw) {
  if (typeof raw !== 'string') {
    return '';
  }
  return raw.trim().slice(0, NICKNAME_MAX_LENGTH);
}

// MAX_LOBBY_PLAYERS caps real players + bots combined -- admins are a
// separate spectator/operator role, never seated into a room (see
// startStage()'s own comment on that), so they don't count toward it.
function countNonAdminLobbyPlayers() {
  return Object.keys(lobbyPlayers).filter((id) => !adminSockets.has(id)).length;
}

function broadcastLobby() {
  // players/phase are identical for every recipient -- only isAdmin
  // varies. A previous version personalized the *entire* payload per
  // socket (N individually-serialized emits for N connected sockets, one
  // full copy of `players` each), which is O(n^2) total bytes for a lobby
  // of n people since every single join/leave/bot-add re-broadcasts to
  // everyone. io.emit() lets socket.io serialize the shared payload once
  // and fan it out natively; the (typically tiny, often just 1) set of
  // admin sockets gets a small personalized emit confirming isAdmin: true.
  //
  // Admins are sent *before* the general broadcast, not after -- a newly-
  // joining LoginScene listens with socket.once('lobbyUpdate', ...), so it
  // only ever acts on whichever of these two messages arrives first. A
  // brand-new admin's own join calls this function with them already in
  // adminSockets; sending their personalized isAdmin: true copy second
  // would have let the general broadcast's isAdmin: false win that race
  // instead, transitioning them into LobbyScene as a regular player.
  // LobbyScene itself never re-reads isAdmin from a later broadcast (only
  // at scene creation), so the general broadcast reaching admins a moment
  // after their real one is a harmless no-op for them.
  adminSockets.forEach((socketId) => {
    const socket = io.sockets.sockets[socketId];
    if (socket) {
      socket.emit('lobbyUpdate', { players: lobbyPlayers, phase: globalPhase, isAdmin: true });
    }
  });
  io.emit('lobbyUpdate', { players: lobbyPlayers, phase: globalPhase, isAdmin: false });
}

// Round 1: groups are capped at MAX_PLAYERS (5), full stop — an earlier
// version folded any remainder into an existing group instead of opening a
// new one (11 players used to become [5, 6], already over the cap this
// function's own name implies). Now: however many MAX_PLAYERS-sized groups
// fit is the starting count, plus one more only if there's a remainder at
// all, and the total is then spread as evenly as possible across however
// many groups that ends up being (sizes differing by at most 1) rather than
// cramming the leftover onto whichever group happened to be first/last --
// e.g. 5 players stay a single group of 5 (round 1 is TEAM mode; splitting
// them for no reason would leave someone playing "alone"), 6 becomes 2
// groups of 3, 10 stays 2 groups of 5, 11 becomes 3 groups of 4/4/3.
// ceil(total / ceil(total / MAX_PLAYERS)) never exceeds MAX_PLAYERS for any
// total, so the cap holds regardless of headcount. Deliberately headcount-
// driven rather than a fixed group count (an earlier fixed-
// STAGE_1_GROUP_COUNT alternative was considered and discarded here) —
// group *count* is left free to grow with turnout instead of group *size*
// drifting away from MAX_PLAYERS as the lobby fills toward
// MAX_LOBBY_PLAYERS. formStage2Groups()/formStage3Group() pool every
// survivor regardless of how many stage-1 rooms fed them, so they don't
// care how many groups this produces.
function chunkForInitialRound(members) {
  const shuffled = [...members].sort(() => Math.random() - 0.5);
  const total = shuffled.length;
  if (total === 0) {
    return [];
  }

  const numGroups = Math.max(1, Math.ceil(total / MAX_PLAYERS));
  const base = Math.floor(total / numGroups);
  let extra = total % numGroups;
  const sizes = new Array(numGroups).fill(base).map((size) => {
    if (extra > 0) {
      extra -= 1;
      return size + 1;
    }
    return size;
  });

  const groups = [];
  let cursor = 0;
  sizes.forEach((size) => {
    groups.push(shuffled.slice(cursor, cursor + size));
    cursor += size;
  });
  return groups;
}

// Stage 2 pools every stage-1 survivor across however many stage-1 rooms
// chunkForInitialRound() actually produced and randomly redistributes them
// into fresh groups, capped at STAGE_2_MAX_GROUP_SIZE -- the exact same
// ceil(total/cap)-plus-an-extra-group shape chunkForInitialRound() uses for
// stage 1 (see that function's own comment), just with a bigger cap: stage
// 2 plays the identical closing-boundary SURVIVAL round as stage 1 now (no
// separate boss/combat mechanic), so a bigger, more crowded room is what's
// meant to produce more eliminations there, not a different ruleset. Each
// returning lineage's own `score` is always 0 -- a fresh shared team score
// for the reshuffled group, not a continuation of any one stage-1 room's
// pool. Each pooled member already carries their own individual `score`
// (their stage-1 total, added onto finishRoom()'s `advancing` list in
// Room.js) which rides along untouched so Room's constructor can seed it
// back into player.score.
function formStage2Groups(results) {
  const pool = [];
  results.forEach((lineage) => {
    if (!lineage || lineage.members.length === 0) {
      return;
    }
    lineage.members.forEach((m) => pool.push(m));
  });
  if (pool.length === 0) {
    return [];
  }

  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const total = shuffled.length;
  const numGroups = Math.max(1, Math.ceil(total / STAGE_2_MAX_GROUP_SIZE));
  const base = Math.floor(total / numGroups);
  let extra = total % numGroups;
  const sizes = new Array(numGroups).fill(base).map((size) => {
    if (extra > 0) {
      extra -= 1;
      return size + 1;
    }
    return size;
  });

  const groups = [];
  let cursor = 0;
  sizes.forEach((size) => {
    groups.push({ members: shuffled.slice(cursor, cursor + size), score: 0 });
    cursor += size;
  });
  return groups;
}

// Stage 3 pools every stage-2 survivor across however many stage-2 rooms
// existed into exactly ONE final room, with no size cap -- a fixed decision (not a
// tunable constant), since the whole point of the final stage is one
// decisive free-for-all decider, not several parallel "finals" that would
// each crown their own separate winner. Each member's own `score` already
// carries their full running total (their individual stage-1 score plus
// their stage-2 room's shared team credit -- see finishRoom()'s advancing
// list in Room.js), which becomes their seed score for stage 3's own
// SURVIVAL-style live scoring (final ranking itself is by elimination
// order, not score -- see the FINAL-mode ranking in handleRoomFinished).
function formStage3Group(results) {
  const pool = [];
  results.forEach((lineage) => {
    if (!lineage || lineage.members.length === 0) {
      return;
    }
    lineage.members.forEach((m) => pool.push(m));
  });
  if (pool.length === 0) {
    return [];
  }
  return [{ members: pool, score: 0 }];
}

function startStage(lineages, stage, gameMode = 'TEAM') {
  const active = lineages
    .map(({ members, score }) => ({
      members: members.filter((m) => !disconnectedSockets.has(m.socketId)),
      score,
    }))
    .filter((lineage) => lineage.members.length > 0);

  if (active.length === 0) {
    endTournament();
    return;
  }

  currentStage = stage;
  stagePending = active.length;
  stageResults = active.map(() => null);

  active.forEach(({ members, score }, index) => {
    roomCounter += 1;
    const roomId = `room-${roomCounter}`;
    // Stage 3 is always the SOLO/FINAL finale (roaming boundary, no
    // revival); stages 1 and 2 are both SURVIVAL now that the boss mechanic
    // has been removed — stage 2 pools survivors into new groups (see
    // formStage2Groups) but plays the exact same closing-boundary round as
    // stage 1, just with a bigger, reshuffled roster.
    const mode = stage === 3 ? 'FINAL' : 'SURVIVAL';

    // If anything here throws, stagePending would otherwise never reach 0
    // for this stage — every other lineage's room already exists and would
    // sit waiting forever for a sibling that never started. Fail this one
    // lineage out (as if wiped) instead of hanging the whole bracket.
    try {
      const room = new Room(roomId, io, members, {
        mode,
        stage,
        startingScore: score,
        gameMode,
        onFinished: (advancing, finalScore, reason, playerResults) =>
          handleRoomFinished(index, roomId, advancing, finalScore, gameMode, playerResults),
      });
      rooms.set(roomId, room);

      members.forEach(({ socketId }) => {
        try {
          socketRoomMap.set(socketId, roomId);
          const socket = io.sockets.sockets[socketId];
          if (socket) {
            socket.join(roomId);
          }
        } catch (joinError) {
          console.error(`Failed to seat socket ${socketId} in room ${roomId}:`, joinError);
        }
      });

      io.to(roomId).emit('gameStarting', room.getSnapshot());

      // Admins never occupy a player slot (see the 'startTournament'
      // handler, which strips them out of `members` before rooms are
      // built) — instead every currently-connected admin is seated as a
      // pure observer, joined to a room's socket.io channel so they
      // receive the same tileWarning/tileCollapsed/playerMoved/roomResult
      // broadcasts everyone else does, plus their own directly-addressed
      // 'gameStarting' carrying isSpectator so the client knows not to
      // spawn them a controllable avatar. Real players already cut from the
      // bracket (spectatorSockets — seated the moment their own room
      // finished, see seatSpectator()) get the exact same treatment here,
      // just with isAdmin: false so admin-only controls (C/S skills, 서버
      // 초기화, jumping into an arbitrary room) stay hidden/inert for them.
      //
      // Stage 1/2 can have several simultaneous rooms (one per group), so
      // instead of seating everyone into just one of them, they get a
      // multi-room dashboard: a one-time 'dashboardStarting' plus periodic
      // 'dashboardUpdate' broadcasts (see broadcastDashboard(), driven off
      // the same 1s tick as everything else) covering every room in the
      // stage. By stage 3 the bracket has narrowed enough that watching one
      // full room in detail makes more sense than a grid of summaries, so
      // that reverts to the original single-spectator behavior — joined to
      // just the first room's (index 0) channel, since joining every room
      // would make the client receive tile/player events from whichever
      // room it isn't currently rendering and silently corrupt the map.
      if (index === 0) {
        const seatObserver = (socketId, isAdmin) => {
          const observerSocket = io.sockets.sockets[socketId];
          if (!observerSocket) {
            return;
          }
          if (stage <= 2) {
            observerSocket.join(DASHBOARD_ROOM);
            observerSocket.emit('dashboardStarting', { stage, roomCount: active.length, isAdmin });
          } else {
            // Stage 3+ is watched as a full in-room spectator, not via the
            // dashboard — leave the dashboard room so a lingering membership
            // from an earlier stage doesn't keep delivering dashboard fan-out
            // to a client now rendering a single live board.
            observerSocket.leave(DASHBOARD_ROOM);
            observerSocket.join(roomId);
            observerSocket.emit('gameStarting', { ...room.getSnapshot(), isSpectator: true, isAdmin });
          }
        };
        adminSockets.forEach((adminId) => seatObserver(adminId, true));
        spectatorSockets.forEach((spectatorId) => seatObserver(spectatorId, false));
      }
    } catch (error) {
      console.error(`Failed to start room ${roomId} (stage ${stage}, lineage ${index}):`, error);
      handleRoomFinished(index, roomId, [], score, gameMode, []);
    }
  });
}

function handleRoomFinished(lineageIndex, roomId, advancing, finalScore, gameMode = 'TEAM', playerResults = []) {
  const room = rooms.get(roomId);
  const allMembers = room
    ? Object.values(room.players).map((p) => ({ socketId: p.playerId, nickname: p.nickname }))
    : [];

  // SOLO is always a single flat stage — no lineage to merge into a next
  // round, so every member of this room gets their own final ranking entry
  // (one nickname/score each) the moment their room finishes, and once
  // every solo room in the stage has reported in, the tournament just ends.
  if (gameMode === 'SOLO') {
    playerResults.forEach((p) => {
      finalRankings.push({
        nicknames: [p.nickname],
        socketIds: [p.socketId],
        score: p.score,
        result: p.eliminated ? 'eliminated' : 'survived',
        stage: currentStage,
        // Only actually used for ranking at stage 3 (see endTournament()'s
        // stage-aware sort) -- a standalone 개인전 tournament (SOLO chosen
        // at stage 1) still ranks by score, unchanged. Harmless to always
        // carry: null means "never eliminated," i.e. the winner.
        eliminatedAt: p.eliminatedAt || null,
      });
    });

    if (room) {
      Object.values(room.players).forEach((p) => socketRoomMap.delete(p.playerId));
    }
    rooms.delete(roomId);

    stagePending -= 1;
    if (stagePending > 0) {
      return undefined;
    }
    return endTournament();
  }

  stageResults[lineageIndex] = { members: advancing, score: finalScore };

  if (advancing.length === 0) {
    finalRankings.push({
      nicknames: allMembers.map((m) => m.nickname),
      socketIds: allMembers.map((m) => m.socketId),
      score: finalScore,
      result: 'eliminated',
      stage: currentStage,
    });
    // A wiped room's whole roster is done for the tournament -- seat every
    // real player among them (bots silently no-op, see seatSpectator) into
    // the dashboard the rest of this still-ongoing stage already has,
    // rather than leaving them on a dead-end result screen.
    allMembers.forEach((m) => seatSpectator(m.socketId));
  } else if (advancing.length < allMembers.length) {
    // Some teammates advance (into the next stage's pooled/reshuffled
    // group) but not everyone did — e.g. an 8-player room where only 4
    // make it out. Only a fully-wiped lineage (above) or the eventual
    // stage-3 finale's own per-player ranking would otherwise ever get
    // recorded in finalRankings, so a player cut here would simply never
    // appear in the final results at all. Recorded here, at this room's
    // own finish time and score, rather than waiting on some later
    // fate — the survivors who did advance don't share one with them from
    // this point on anyway, once formStage2Groups()/formStage3Group() have
    // pooled and reshuffled everyone into entirely different rooms.
    const advancingIds = new Set(advancing.map((m) => m.socketId));
    const eliminatedHere = allMembers.filter((m) => !advancingIds.has(m.socketId));
    if (eliminatedHere.length > 0) {
      finalRankings.push({
        nicknames: eliminatedHere.map((m) => m.nickname),
        socketIds: eliminatedHere.map((m) => m.socketId),
        score: finalScore,
        result: 'eliminated',
        stage: currentStage,
      });
      eliminatedHere.forEach((m) => seatSpectator(m.socketId));
    }
  }

  if (room) {
    Object.values(room.players).forEach((p) => socketRoomMap.delete(p.playerId));
  }
  rooms.delete(roomId);

  stagePending -= 1;
  if (stagePending > 0) {
    return undefined;
  }

  // Stage 1 -> 2 pools and randomly reshuffles all survivors into fresh
  // STAGE_2_MAX_GROUP_SIZE-capped groups (see formStage2Groups) instead of
  // merging adjacent lineages pairwise -- replacing the old unbounded
  // pairwise-merge bracket that used to run until only one lineage (or
  // none) was left. Both fixed transitions below run unconditionally on
  // reaching their stage, regardless of how many lineages/groups survived
  // it -- surviving down to a single group here does NOT mean "crown a
  // champion now," it just means stage 2 (or 3) starts with fewer groups
  // than usual.
  if (currentStage === 1) {
    const stage2Groups = formStage2Groups(stageResults);
    if (stage2Groups.length === 0) {
      return endTournament();
    }
    startStage(stage2Groups, 2, 'TEAM');
    return undefined;
  }

  // Stage 2 -> 3 pools every stage-2 survivor into the single final SOLO
  // room (see formStage3Group) -- stage 3 always finishes the
  // tournament itself via the gameMode === 'SOLO' branch at the top of
  // this function, so nothing beyond this point should ever run for a
  // normal 3-stage tournament.
  if (currentStage === 2) {
    const stage3Group = formStage3Group(stageResults);
    if (stage3Group.length === 0) {
      return endTournament();
    }
    startStage(stage3Group, 3, 'SOLO');
    return undefined;
  }

  // Not reachable in the normal 3-stage bracket (stage 3 is always SOLO,
  // which returns via the early gameMode branch above) -- kept only so an
  // unexpected extra stage fails safe into ending the tournament instead
  // of silently hanging with stagePending stuck at 0.
  return endTournament();
}

// Reaching a later bracket stage always ranks above an earlier one,
// regardless of score -- someone who made it to stage 3 objectively placed
// better than anyone cut in stage 1/2, which a pure score sort can't
// guarantee (a long-surviving stage-1 elimination could easily outscore a
// stage-3 entrant who died early in the chaotic final). Within the same
// stage: stage 3 (the FINAL/SOLO finale) ranks by elimination order --
// never-eliminated (the winner) first, then whoever lasted longest -- per
// the operator's explicit call that the finale isn't score-based. Every
// other stage keeps the original score-based ordering (also covers a
// standalone 개인전 tournament, which is always "stage 1" and never
// reaches this eliminatedAt-based branch).
function compareRankings(a, b) {
  if (a.stage !== b.stage) {
    return b.stage - a.stage;
  }
  if (a.stage === 3) {
    const aAlive = a.eliminatedAt == null;
    const bAlive = b.eliminatedAt == null;
    if (aAlive !== bAlive) {
      return aAlive ? -1 : 1;
    }
    if (aAlive) {
      return 0; // both never eliminated -- shouldn't happen (one true winner), stable no-op
    }
    return b.eliminatedAt - a.eliminatedAt;
  }
  return b.score - a.score;
}

function endTournament() {
  const rankings = [...finalRankings].sort(compareRankings);
  // Global broadcast covers anyone already parked on a result screen from a
  // lineage that finished earlier; the room that just triggered this also
  // gets the rankings bundled directly into its own roomResult (see Room.js)
  // so there's no race between the two delivery paths for its players.
  io.emit('tournamentEnded', { rankings });

  globalPhase = 'LOBBY';
  currentStage = 0;
  stagePending = 0;
  stageResults = [];
  finalRankings = [];
  disconnectedSockets.clear();
  spectatorSockets.clear();
  clearReconnectState();
  broadcastLobby();

  return { rankings };
}

// Admin-triggered emergency reset (see the 'resetServer' handler) — same
// end state as endTournament() plus wiping every in-progress room and
// kicking every connected non-admin, rather than assuming a tournament
// wrapped up normally.
function resetServerState() {
  // Every Room.js setTimeout callback (tile warning/collapse, the
  // move-broadcast coalescing timer) already checks `this.finished` before
  // doing anything, since finishRoom() sets it for exactly this reason —
  // flipping it here is enough to make any already-scheduled callback a
  // silent no-op once it eventually fires, without needing to track down
  // and individually cancel each room's own timers.
  rooms.forEach((room) => {
    room.finished = true;
  });
  rooms.clear();
  socketRoomMap.clear();

  // Same force-disconnect treatment clearLobby already gives lobby-only
  // players, just extended to anyone currently seated in a room too —
  // Object.keys() snapshots the socket list up front, so disconnecting
  // sockets mid-loop (which mutates io.sockets.sockets) can't skip or
  // double-visit an entry.
  Object.keys(io.sockets.sockets).forEach((id) => {
    if (adminSockets.has(id)) {
      return;
    }
    const liveSocket = io.sockets.sockets[id];
    if (liveSocket) {
      liveSocket.disconnect(true);
    }
  });

  lobbyPlayers = {};
  globalPhase = 'LOBBY';
  currentStage = 0;
  stagePending = 0;
  stageResults = [];
  finalRankings = [];
  disconnectedSockets.clear();
  spectatorSockets.clear();
  clearReconnectState();
  broadcastLobby();

  // An admin currently parked on DashboardScene or a spectated GameScene
  // (rather than LobbyScene, where broadcastLobby() above already fully
  // refreshes them) has no listener that would otherwise notice any of
  // this — currentStage is back to 0, so the next tick's
  // broadcastDashboard() call now just early-returns forever, leaving
  // them staring at a stale room card that no longer exists server-side.
  // Reusing 'tournamentEnded' (with no rankings, same as the "still
  // waiting" empty-rankings case) routes them through the exact same
  // already-tested ResultScene -> 돌아가기 -> LobbyScene path any
  // spectator already takes when a tournament ends normally, rather than
  // inventing a new transition. A harmless no-op for an admin who was
  // already on LobbyScene (no handler there listens for this event).
  adminSockets.forEach((adminId) => {
    const adminSocket = io.sockets.sockets[adminId];
    if (adminSocket) {
      adminSocket.emit('tournamentEnded', { rankings: [] });
    }
  });
}

/**
 * Setup server event handlers.
 */
function setServerHandlers() {
  io.on('connection', (socket) => {
    console.log('Socket connected: ' + socket.id);

    // A reconnecting client offers its stable session token. Two distinct
    // seats can be waiting for it:
    //  1. A mid-round seat still inside its RECONNECT_GRACE_MS window
    //     (bot-proxied since the drop -- see the disconnect handler): move
    //     it onto this new socket.id, stop the bot proxy, and resume the
    //     player right where their avatar is now, at its current score.
    //  2. A between-rounds seat (no active Room -- the player's own room
    //     already finished and they're just waiting for the next stage's
    //     rooms to be built): nothing to bot-proxy, just move the pending
    //     stageResults membership onto this socket.id so the next stage's
    //     own pooling still finds them (see betweenRoundsGraceTimers).
    // Anything else (no such token, both windows already elapsed, seat
    // already gone) is a clean rejection the client turns into a normal
    // reload back to the login screen.
    socket.on('reconnectAttempt', (payload) => {
      const token = payload && typeof payload.token === 'string' ? payload.token : null;
      if (!token) {
        socket.emit('reconnectRejected', {});
        return;
      }

      if (graceTimers.has(token)) {
        const oldSocketId = tokenToSocket.get(token);
        const roomId = oldSocketId && socketRoomMap.get(oldSocketId);
        const room = roomId && rooms.get(roomId);
        if (oldSocketId && room && room.players[oldSocketId] && !room.finished) {
          clearGraceTimer(token);
          // Re-key everything that was tracking the old socket.id onto the
          // new one, then hand the avatar back to human control.
          room.reassignPlayerSocket(oldSocketId, socket.id);
          socketRoomMap.delete(oldSocketId);
          socketRoomMap.set(socket.id, roomId);
          socketToToken.delete(oldSocketId);
          socketToToken.set(socket.id, token);
          tokenToSocket.set(token, socket.id);
          socket.join(roomId);
          room.endProxyControl(socket.id, true);
          socket.emit('reconnectAccepted', {});
          socket.emit('gameStarting', room.getSnapshot());
          return;
        }
        clearGraceTimer(token);
        socket.emit('reconnectRejected', {});
        return;
      }

      if (betweenRoundsGraceTimers.has(token)) {
        clearBetweenRoundsGraceTimer(token);
        const oldSocketId = tokenToSocket.get(token);

        // The next stage's rooms may have already been built in the gap
        // between this player's disconnect and this reconnect -- startStage()
        // seats every member into socketRoomMap regardless of whether their
        // socket is actually live (see its own members.forEach), so the old,
        // now-dead socket.id can already be sitting as an unpiloted member of
        // a brand new room. Reclaim that seat directly rather than just
        // resuming the wait screen, or this player would be stuck as a silent
        // phantom in a room that already started without them.
        const newRoomId = oldSocketId && socketRoomMap.get(oldSocketId);
        const newRoom = newRoomId && rooms.get(newRoomId);
        if (oldSocketId && newRoom && newRoom.players[oldSocketId] && !newRoom.finished) {
          newRoom.reassignPlayerSocket(oldSocketId, socket.id);
          socketRoomMap.delete(oldSocketId);
          socketRoomMap.set(socket.id, newRoomId);
          socketToToken.delete(oldSocketId);
          socketToToken.set(socket.id, token);
          tokenToSocket.set(token, socket.id);
          socket.join(newRoomId);
          socket.emit('reconnectAccepted', {});
          socket.emit('gameStarting', newRoom.getSnapshot());
          return;
        }

        if (oldSocketId) {
          patchPendingSocketId(oldSocketId, socket.id);
          socketToToken.delete(oldSocketId);
        }
        socketToToken.set(socket.id, token);
        tokenToSocket.set(token, socket.id);
        socket.emit('reconnectAccepted', {});
        socket.emit('resumeWaiting', {});
        return;
      }

      socket.emit('reconnectRejected', {});
    });

    socket.on('join', (payload) => {
      const nickname = sanitizeNickname(payload && payload.nickname);
      if (!nickname) {
        socket.emit('joinRejected', { reason: 'invalid' });
        return;
      }
      if (socketRoomMap.has(socket.id)) {
        return;
      }

      const password = payload && payload.password;
      const isAdminAttempt = !!password;

      // A session is considered "open" once any admin has ever
      // authenticated (see sessionOpened's own comment for why this is
      // deliberately not the same check as "an admin is connected right
      // now"). Regular joins are rejected until then; an admin's own join
      // always goes through (that's literally what opens the session for
      // everyone else).
      if (!isAdminAttempt && !sessionOpened) {
        socket.emit('joinRejected', { reason: 'no-session' });
        return;
      }

      if (isAdminAttempt) {
        if (password !== ADMIN_PASSWORD) {
          socket.emit('joinRejected', { reason: 'bad-password' });
          return;
        }
        adminSockets.add(socket.id);
        sessionOpened = true;
      }

      // Admins never occupy a player slot (checked above via
      // countNonAdminLobbyPlayers' own filter), so only a regular join can
      // ever hit this -- an admin's own join always goes through.
      if (!isAdminAttempt && countNonAdminLobbyPlayers() >= MAX_LOBBY_PLAYERS) {
        socket.emit('joinRejected', { reason: 'lobby-full' });
        return;
      }

      lobbyPlayers[socket.id] = { nickname, animalIndex: Math.floor(Math.random() * ANIMAL_COUNT) };

      // Remember which browser (stable token) this socket belongs to, so a
      // later reconnectAttempt with the same token can be matched back to
      // whatever room seat this socket ends up in. Only regular players are
      // tracked for reclaim — an admin reconnect already has its own
      // re-auth path and never occupies a room seat.
      const token = payload && typeof payload.token === 'string' ? payload.token : null;
      if (token && !isAdminAttempt) {
        socketToToken.set(socket.id, token);
        tokenToSocket.set(token, socket.id);
      }

      broadcastLobby();
    });

    socket.on('addBot', () => {
      if (!adminSockets.has(socket.id) || globalPhase !== 'LOBBY') {
        return;
      }
      // Silently no-op at the cap, matching this handler's existing
      // early-return style for every other invalid state above -- the
      // roster grid the admin is already looking at makes "it stopped
      // growing" self-evident without a separate rejection event.
      if (countNonAdminLobbyPlayers() >= MAX_LOBBY_PLAYERS) {
        return;
      }
      botCounter += 1;
      const botId = `bot-${botCounter}`;
      lobbyPlayers[botId] = {
        nickname: `봇${botCounter}`,
        isBot: true,
        animalIndex: Math.floor(Math.random() * ANIMAL_COUNT),
      };
      broadcastLobby();
    });

    // A full reset, not just a stale-entry sweep: every bot entry and every
    // currently-connected real (non-admin) player gets cleared, and real
    // players are actually force-disconnected (not just dropped from the
    // roster) so their client runs through the existing disconnect/reload
    // flow in net/socket.js and lands back on a clean LoginScene — previous
    // roster info is explicitly not needed here, the whole point is a fresh
    // slate. The triggering admin (and any other connected admin) stays
    // connected; the session is immediately open again since at least one
    // admin is still present.
    socket.on('clearLobby', () => {
      if (!adminSockets.has(socket.id) || globalPhase !== 'LOBBY') {
        return;
      }
      Object.keys(lobbyPlayers).forEach((id) => {
        if (adminSockets.has(id)) {
          return;
        }
        const liveSocket = io.sockets.sockets[id];
        if (liveSocket) {
          liveSocket.disconnect(true);
        }
        delete lobbyPlayers[id];
      });
      broadcastLobby();
    });

    // Emergency "start over" for a stuck/misbehaving tournament -- unlike
    // clearLobby (LOBBY phase only, roster-scoped), this works from any
    // phase and also tears down every in-progress room, not just the lobby
    // roster. A soft reset, not a process restart: the Node process and its
    // event loop/timers keep running untouched, so this is ~instant with no
    // Cloud Run cold-start downtime -- it clears in-memory game state and
    // force-disconnects every non-admin socket, same as clearLobby already
    // does for lobby-only players. It does not recover from an actual
    // process crash or memory corruption; the existing
    // uncaughtException/unhandledRejection handlers above are what
    // protect against those.
    socket.on('resetServer', () => {
      if (!adminSockets.has(socket.id)) {
        return;
      }
      resetServerState();
      // resetServerState() deliberately never disconnects the triggering
      // admin (see its own comment) and broadcastLobby() only visibly
      // changes anything for them if the lobby wasn't already empty --
      // meaning a reset triggered against an already-quiet lobby produced
      // literally zero on-screen feedback, reported in practice as the
      // button "doing nothing". An explicit ack lets the client show a
      // one-time confirmation regardless of what the lobby looked like
      // before or after.
      socket.emit('resetServerDone');
    });

    socket.on('startTournament', (payload) => {
      if (!adminSockets.has(socket.id) || globalPhase !== 'LOBBY') {
        return;
      }
      // 팀전 (TEAM, the default/original bracket) merges adjacent lineages
      // across stages and shares one score per room; 개인전 (SOLO) is a
      // single flat SURVIVAL stage with no merging, ranked by each
      // player's own score — see handleRoomFinished()'s gameMode branch.
      const gameMode = payload && payload.mode === 'SOLO' ? 'SOLO' : 'TEAM';
      // The admin who starts the match watches it rather than playing —
      // never seated into a room, so they can't die and can't be counted
      // toward hasHumans/allHumansGone. See startStage() for how they're
      // instead joined as a spectator once the rooms actually exist.
      const members = Object.entries(lobbyPlayers)
        .filter(([socketId]) => !adminSockets.has(socketId))
        .map(([socketId, p]) => ({
          socketId,
          nickname: p.nickname,
          animalIndex: Number.isInteger(p.animalIndex) ? p.animalIndex : Math.floor(Math.random() * ANIMAL_COUNT),
          isBot: !!p.isBot,
        }));
      if (members.length === 0) {
        return;
      }

      lobbyPlayers = {};
      globalPhase = 'TOURNAMENT';
      finalRankings = [];
      broadcastLobby();
      startStage(chunkForInitialRound(members).map((group) => ({ members: group, score: 0 })), 1, gameMode);
    });

    socket.on('playerMovement', (movementData) => {
      if (!movementData || !Number.isFinite(movementData.x) || !Number.isFinite(movementData.y)) {
        return;
      }
      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) {
        return;
      }
      const room = rooms.get(roomId);
      if (!room) {
        return;
      }
      room.movePlayerTo(socket.id, movementData.x, movementData.y);
    });

    // A ghost's tap is now a bare "I touched the screen" signal with no
    // target of its own (see GameScene's handleGhostScreenTap) — Room.js's
    // reviveTile() picks which collapsed tile actually comes back itself
    // when row/col aren't a valid, currently-GONE tile, so an empty payload
    // is the normal case here, not a malformed one.
    socket.on('reviveTile', (payload) => {
      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) {
        return;
      }
      const room = rooms.get(roomId);
      if (!room) {
        return;
      }
      const hasCoords = payload && Number.isInteger(payload.row) && Number.isInteger(payload.col);
      room.reviveTile(socket.id, hasCoords ? payload.row : undefined, hasCoords ? payload.col : undefined);
    });

    // Admin manually picked a room's card on the multi-room dashboard
    // (stage 1/2) to watch in full — same seating mechanism already used
    // to auto-spectate the sole remaining room from stage 3 onward (see
    // startStage()'s index===0 admin branch), just triggered on demand for
    // whichever roomId the admin clicked instead of automatically for
    // room 0. `fromDashboard` tells the client to show a way back, since
    // (unlike the stage 3+ auto case) there's a dashboard to return to.
    socket.on('adminSpectateRoom', (payload) => {
      if (!adminSockets.has(socket.id)) {
        return;
      }
      const roomId = payload && payload.roomId;
      if (typeof roomId !== 'string') {
        return;
      }
      const room = rooms.get(roomId);
      if (!room) {
        return;
      }
      // Leaving the dashboard fan-out room while watching one full board,
      // so a stale membership doesn't keep pushing every-room dashboard
      // payloads to a client now rendering a single live game.
      socket.leave(DASHBOARD_ROOM);
      socket.join(roomId);
      socket.emit('gameStarting', {
        ...room.getSnapshot(), isSpectator: true, fromDashboard: true, isAdmin: true,
      });
    });

    // Leaves the spectated room's channel (so its tileWarning/tileCollapsed/
    // playerMoved broadcasts stop reaching a socket no longer rendering
    // that room) and, if the tournament is still in a dashboard-eligible
    // stage, re-sends the current stage's room list so the client can jump
    // straight back into DashboardScene instead of being stranded.
    socket.on('adminReturnToDashboard', (payload) => {
      if (!adminSockets.has(socket.id)) {
        return;
      }
      const roomId = payload && payload.roomId;
      if (typeof roomId === 'string') {
        socket.leave(roomId);
      }
      if (currentStage === 0 || currentStage > 2) {
        return;
      }
      socket.join(DASHBOARD_ROOM);
      socket.emit('dashboardStarting', { stage: currentStage, roomCount: rooms.size, isAdmin: true });
    });

    // socket.io's own disconnect reason (e.g. 'transport close', 'ping
    // timeout', 'transport error', 'client namespace disconnect', 'server
    // namespace disconnect') was previously discarded entirely -- logged now
    // so a real disconnect during play (as opposed to an intentional kick
    // via clearLobby/resetServer, which always logs as 'server namespace
    // disconnect' or 'transport close' right after this socket's own
    // .disconnect(true) call) can actually be diagnosed after the fact
    // instead of guessing.
    socket.on('disconnect', (reason) => {
      console.log(`Socket disconnected: ${socket.id} (reason: ${reason})`);
      adminSockets.delete(socket.id);
      spectatorSockets.delete(socket.id);

      if (lobbyPlayers[socket.id]) {
        delete lobbyPlayers[socket.id];
        broadcastLobby();
        return;
      }

      const roomId = socketRoomMap.get(socket.id);
      if (roomId) {
        const room = rooms.get(roomId);
        const token = socketToToken.get(socket.id);

        // Mid-round drop of a real player who has a session token and isn't
        // already out: don't eliminate yet. Hand their avatar to the bot AI
        // (Room.beginProxyControl) and start a RECONNECT_GRACE_MS countdown.
        // A reconnectAttempt with the same token before it fires reclaims
        // the seat in place; if it fires first, the reclaim window is over
        // and we run the normal disconnect elimination.
        const player = room && room.players[socket.id];
        const canReclaim = room && token && player && !player.eliminated && !room.finished;

        if (canReclaim) {
          room.beginProxyControl(socket.id);
          // socketRoomMap still points token's old socket.id at this room so
          // the grace timer and a reclaim can both find it; cleaned up
          // either on reclaim (moved to the new socket.id) or on timeout.
          const timer = setTimeout(() => {
            graceTimers.delete(token);
            const liveRoom = rooms.get(roomId);
            if (liveRoom) {
              liveRoom.endProxyControl(socket.id);
              liveRoom.handleDisconnect(socket.id);
            }
            socketRoomMap.delete(socket.id);
            tokenToSocket.delete(token);
            socketToToken.delete(socket.id);
          }, RECONNECT_GRACE_MS);
          graceTimers.set(token, timer);
          // Deliberately DON'T record into disconnectedSockets yet — that's
          // for players truly gone from the bracket; a reclaimable seat is
          // still in play. The timeout path above (via handleDisconnect)
          // covers the genuinely-gone case.
          return;
        }

        if (globalPhase === 'TOURNAMENT') {
          disconnectedSockets.add(socket.id);
        }
        if (room) {
          room.handleDisconnect(socket.id);
        }
        socketRoomMap.delete(socket.id);
        if (token) {
          tokenToSocket.delete(token);
          socketToToken.delete(socket.id);
        }
        return;
      }

      // Not in a room -- either still in the lobby (globalPhase LOBBY,
      // already handled above via lobbyPlayers) or, mid-tournament, a
      // survivor sitting between stages waiting for the next one's rooms to
      // be created (their own room's onFinished already deleted their
      // socketRoomMap entry). A bare connectivity blip here -- venue wifi
      // hiccup, not necessarily anything the player did -- used to write
      // them off the bracket immediately via disconnectedSockets even
      // though there's no active Room to actually be "gone" from yet. Give
      // the same session token a RECONNECT_GRACE_MS window to reconnect
      // (see 'reconnectAttempt's own betweenRoundsGraceTimers check) before
      // actually marking them gone -- without this, several survivors
      // hitting the same blip while waiting for the next stage could empty
      // that stage's own member list and end the tournament right as it
      // should have started.
      const waitingToken = socketToToken.get(socket.id);
      if (globalPhase === 'TOURNAMENT' && waitingToken) {
        const timer = setTimeout(() => {
          betweenRoundsGraceTimers.delete(waitingToken);
          disconnectedSockets.add(socket.id);
          tokenToSocket.delete(waitingToken);
          socketToToken.delete(socket.id);
        }, RECONNECT_GRACE_MS);
        betweenRoundsGraceTimers.set(waitingToken, timer);
        return;
      }

      if (globalPhase === 'TOURNAMENT') {
        disconnectedSockets.add(socket.id);
      }
      if (waitingToken) {
        tokenToSocket.delete(waitingToken);
        socketToToken.delete(socket.id);
      }
    });
  });
}
