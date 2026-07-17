import Http from 'http';
import Path from 'path';
import Helmet from 'helmet';
import Express from 'express';
import SocketIO from 'socket.io';
import Compression from 'compression';

import { ANIMAL_COUNT } from '../shared/animals';
import {
  NICKNAME_MAX_LENGTH, MAX_LOBBY_PLAYERS, STAGE_1_GROUP_COUNT,
  STAGE_2_GROUP_COUNT, STAGE_2_MAX_ROOM_SIZE,
} from '../shared/roomConfig';
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
app.use('/public', Express.static(Path.join(__dirname, '../public')));

// Request router.
app.get('/', function(request, response) {
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
  if (currentStage === 0 || currentStage > 2 || adminSockets.size === 0) {
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
  adminSockets.forEach((adminId) => {
    const adminSocket = io.sockets.sockets[adminId];
    if (adminSocket) {
      adminSocket.emit('dashboardUpdate', { stage: currentStage, rooms: summaries });
    }
  });
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
// Stage 1 lineages are the initial random groups; each later stage merges
// adjacent lineages (1&2, 3&4, ...) into one team that keeps playing
// together, carrying its combined score forward. An odd lineage out just
// carries forward alone. A lineage that loses every member is locked into
// the final ranking immediately and does not pass its score on.
let currentLineages = [];
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

// Round 1 always targets exactly STAGE_1_GROUP_COUNT (8) groups, sized as
// evenly as possible -- an operator running a fixed-format event wants a
// predictable stage 1 shape regardless of how close turnout lands to
// MAX_LOBBY_PLAYERS (40), rather than however many fixed-MAX_PLAYERS-size
// groups an unbounded headcount used to produce. Any remainder from an
// uneven split is spread as +1 across multiple groups instead of dumping
// it all onto a single trailing group. Only degrades below 8 groups when
// there are literally fewer than 8 people at all (never more groups than
// people) -- a small ad-hoc test session, not a real capped-at-40 event.
function chunkForInitialRound(members) {
  const shuffled = [...members].sort(() => Math.random() - 0.5);
  const total = shuffled.length;
  if (total === 0) {
    return [];
  }

  const numGroups = Math.max(1, Math.min(STAGE_1_GROUP_COUNT, total));
  const baseSize = Math.floor(total / numGroups);
  const sizes = new Array(numGroups).fill(baseSize);
  // total = numGroups * baseSize + remaining, and by definition of that
  // division remaining is always < numGroups -- so this loop alone always
  // fully spreads it (never leaves a trailing remainder to dump on the
  // last group the way the old MAX_PLAYERS-divided version occasionally
  // needed to).
  let remaining = total - numGroups * baseSize;
  for (let g = 0; g < numGroups && remaining > 0; g++) {
    sizes[g] += 1;
    remaining -= 1;
  }

  const groups = [];
  let cursor = 0;
  sizes.forEach((size) => {
    groups.push(shuffled.slice(cursor, cursor + size));
    cursor += size;
  });
  return groups;
}

function mergeAdjacentLineages(results) {
  const merged = [];
  for (let i = 0; i < results.length; i += 2) {
    const a = results[i] || { members: [], score: 0 };
    const b = i + 1 < results.length ? (results[i + 1] || { members: [], score: 0 }) : { members: [], score: 0 };
    const members = [...a.members, ...b.members];
    if (members.length === 0) {
      continue;
    }
    // An empty side was already eliminated and locked into the rankings —
    // its score doesn't carry over to whichever side is still playing.
    const score = (a.members.length > 0 ? a.score : 0) + (b.members.length > 0 ? b.score : 0);
    merged.push({ members, score });
  }
  return merged;
}

// Stage 2 pools every stage-1 survivor across all STAGE_1_GROUP_COUNT rooms
// (rather than mergeAdjacentLineages' pairwise merge) and randomly
// redistributes them into exactly STAGE_2_GROUP_COUNT new groups, evenly
// sized and capped at STAGE_2_MAX_ROOM_SIZE per room. Each returning
// lineage's own `score` is always 0 -- a fresh shared team score for the
// reshuffled group, not a continuation of any one stage-1 room's pool. Each
// pooled member already carries their own individual `score` (their stage-1
// total, added onto finishRoom()'s `advancing` list in Room.js) which rides
// along untouched so Room's constructor can seed it back into player.score
// -- see roomConfig.js's own comment on these two constants.
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
  const numGroups = Math.max(1, Math.min(STAGE_2_GROUP_COUNT, total));
  const baseSize = Math.floor(total / numGroups);
  const sizes = new Array(numGroups).fill(baseSize);
  let remaining = total - numGroups * baseSize;
  for (let g = 0; g < numGroups && remaining > 0; g++) {
    sizes[g] += 1;
    remaining -= 1;
  }

  // baseSize can't realistically exceed STAGE_2_MAX_ROOM_SIZE (40 stage-1
  // entrants max / 4 groups = 10 even at 100% survival), but guard
  // explicitly rather than assume -- any group that would overflow spills
  // its excess into extra trailing group(s) instead of overloading a room.
  const cappedSizes = [];
  sizes.forEach((size) => {
    let remainingSize = size;
    while (remainingSize > STAGE_2_MAX_ROOM_SIZE) {
      cappedSizes.push(STAGE_2_MAX_ROOM_SIZE);
      remainingSize -= STAGE_2_MAX_ROOM_SIZE;
    }
    cappedSizes.push(remainingSize);
  });

  const groups = [];
  let cursor = 0;
  cappedSizes.forEach((size) => {
    if (size === 0) {
      return;
    }
    groups.push({ members: shuffled.slice(cursor, cursor + size), score: 0 });
    cursor += size;
  });
  return groups;
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

  currentLineages = active;
  currentStage = stage;
  stagePending = active.length;
  stageResults = active.map(() => null);

  active.forEach(({ members, score }, index) => {
    roomCounter += 1;
    const roomId = `room-${roomCounter}`;
    const mode = stage === 1 ? 'SURVIVAL' : 'BOSS';

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
      // spawn them a controllable avatar.
      //
      // Stage 1/2 can have several simultaneous rooms (one per group), so
      // instead of seating the admin into just one of them, they get a
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
        adminSockets.forEach((adminId) => {
          const adminSocket = io.sockets.sockets[adminId];
          if (!adminSocket) {
            return;
          }
          if (stage <= 2) {
            adminSocket.emit('dashboardStarting', { stage, roomCount: active.length });
          } else {
            adminSocket.join(roomId);
            adminSocket.emit('gameStarting', { ...room.getSnapshot(), isSpectator: true });
          }
        });
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
  } else if (advancing.length < allMembers.length) {
    // Some teammates advance (into the merged lineage that plays on) but
    // not everyone did — e.g. an 8-player room where only 4 make it out.
    // Only a fully-wiped lineage (above) or the eventual champion (below)
    // used to get recorded in finalRankings, so a player cut from a room
    // whose lineage otherwise kept advancing would simply never appear in
    // the final results at all. Recorded here, at this room's own finish
    // time and score, rather than waiting on the lineage's eventual
    // fate — which the survivors who did advance don't share with them
    // from this point on anyway (their own path already diverged for good
    // reasons: mergeAdjacentLineages(), a later wipeout, etc).
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

  if (currentLineages.length === 1) {
    const finalEntry = stageResults[0];
    if (finalEntry.members.length > 0) {
      finalRankings.push({
        nicknames: finalEntry.members.map((m) => m.nickname),
        socketIds: finalEntry.members.map((m) => m.socketId),
        score: finalEntry.score,
        result: 'champion',
        stage: currentStage,
      });
    }
    return endTournament();
  }

  // Stage 1 -> 2 pools and randomly reshuffles all survivors into exactly
  // STAGE_2_GROUP_COUNT groups (see formStage2Groups) instead of merging
  // adjacent lineages pairwise -- the fixed 8-group-then-4-group bracket
  // shape the operator wants, replacing the old unbounded pairwise-merge
  // bracket for this specific transition.
  if (currentStage === 1) {
    const stage2Groups = formStage2Groups(stageResults);
    if (stage2Groups.length === 0) {
      return endTournament();
    }
    startStage(stage2Groups, 2, 'TEAM');
    return undefined;
  }

  const merged = mergeAdjacentLineages(stageResults);
  if (merged.length === 0) {
    return endTournament();
  }

  startStage(merged, currentStage + 1);
  return undefined;
}

function endTournament() {
  const rankings = [...finalRankings].sort((a, b) => b.score - a.score);
  // Global broadcast covers anyone already parked on a result screen from a
  // lineage that finished earlier; the room that just triggered this also
  // gets the rankings bundled directly into its own roomResult (see Room.js)
  // so there's no race between the two delivery paths for its players.
  io.emit('tournamentEnded', { rankings });

  globalPhase = 'LOBBY';
  currentLineages = [];
  currentStage = 0;
  stagePending = 0;
  stageResults = [];
  finalRankings = [];
  disconnectedSockets.clear();
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
  currentLineages = [];
  currentStage = 0;
  stagePending = 0;
  stageResults = [];
  finalRankings = [];
  disconnectedSockets.clear();
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

    socket.on('reviveTile', (payload) => {
      if (!payload || !Number.isInteger(payload.row) || !Number.isInteger(payload.col)) {
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
      room.reviveTile(socket.id, payload.row, payload.col);
    });

    // Admin-only "balance lever" triggered from the dashboard (or a
    // spectated room) — see Room.js's armCriticalHit()/
    // triggerBossShatterSkill() for why these produce no visible cue
    // beyond what normal play already looks like.
    socket.on('adminCritical', (payload) => {
      if (!adminSockets.has(socket.id)) {
        return;
      }
      const roomId = payload && payload.roomId;
      if (typeof roomId !== 'string') {
        return;
      }
      const room = rooms.get(roomId);
      if (room) {
        room.armCriticalHit();
      }
    });

    socket.on('adminShatterTiles', (payload) => {
      if (!adminSockets.has(socket.id)) {
        return;
      }
      const roomId = payload && payload.roomId;
      if (typeof roomId !== 'string') {
        return;
      }
      const room = rooms.get(roomId);
      if (room) {
        room.triggerBossShatterSkill();
      }
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
      socket.join(roomId);
      socket.emit('gameStarting', { ...room.getSnapshot(), isSpectator: true, fromDashboard: true });
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
      socket.emit('dashboardStarting', { stage: currentStage, roomCount: rooms.size });
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected: ' + socket.id);
      adminSockets.delete(socket.id);

      if (lobbyPlayers[socket.id]) {
        delete lobbyPlayers[socket.id];
        broadcastLobby();
        return;
      }

      const roomId = socketRoomMap.get(socket.id);
      if (roomId) {
        disconnectedSockets.add(socket.id);
        const room = rooms.get(roomId);
        if (room) {
          room.handleDisconnect(socket.id);
        }
        socketRoomMap.delete(socket.id);
      } else {
        disconnectedSockets.add(socket.id);
      }
    });
  });
}
