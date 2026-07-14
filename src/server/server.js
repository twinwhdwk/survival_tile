import Http from 'http';
import Path from 'path';
import Helmet from 'helmet';
import Express from 'express';
import SocketIO from 'socket.io';
import Compression from 'compression';

import { ANIMAL_COUNT } from '../shared/animals';
import { MAX_PLAYERS, NICKNAME_MAX_LENGTH } from '../shared/roomConfig';
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
  botTickInterval = setInterval(tickAllBots, BOT_MOVE_INTERVAL_MS);
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
// Was 300ms originally, tuned purely so load-test bots visibly moved — not
// to model realistic pacing. A real player pauses, hesitates, reads the
// map; 300ms of nonstop stepping burns through tiles far faster than that
// (documented in roundConfig.js's AUTO_REGEN comment: worst case ~13
// tiles/sec per room). Slowed to better approximate a cautious human's
// pace, which also makes bot-driven test rounds a more realistic proxy for
// how balance will actually feel with real players — combined with the
// heading-bias in Room.js's pickWeightedByHeading(), bots now amble in
// winding paths at roughly human speed instead of jittering at full tilt.
const BOT_MOVE_INTERVAL_MS = 600;

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

function broadcastLobby() {
  // Personalized per-socket (rather than one io.emit payload) so each
  // client can be told whether *it* holds admin privileges.
  Object.keys(io.sockets.sockets).forEach((socketId) => {
    const socket = io.sockets.sockets[socketId];
    if (!socket) {
      return;
    }
    socket.emit('lobbyUpdate', {
      players: lobbyPlayers,
      phase: globalPhase,
      isAdmin: adminSockets.has(socketId),
    });
  });
}

// Round 1: aim for every group to land on exactly MAX_PLAYERS (4) or
// MAX_PLAYERS + 1 (5) members, spreading any remainder as +1 across
// multiple groups instead of dumping it all onto a single trailing group —
// the old fixed-chunk-then-merge-the-leftover approach could balloon one
// group well past 5 (e.g. 11 players used to become groups of [4, 7]).
// A handful of totals (6, 7, 11) have no exact 4-or-5 tiling at all (see
// the coin problem for {4,5}); those fall back to one oversized last group,
// which only matters for tiny ad-hoc tests since real tournaments run with
// far more players than that.
function chunkForInitialRound(members) {
  const shuffled = [...members].sort(() => Math.random() - 0.5);
  const total = shuffled.length;
  if (total === 0) {
    return [];
  }

  const numGroups = Math.max(1, Math.floor(total / MAX_PLAYERS));
  const sizes = new Array(numGroups).fill(MAX_PLAYERS);
  let remaining = total - numGroups * MAX_PLAYERS;

  for (let g = 0; g < numGroups && remaining > 0; g++) {
    sizes[g] += 1;
    remaining -= 1;
  }
  if (remaining > 0) {
    sizes[numGroups - 1] += remaining;
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

function startStage(lineages, stage) {
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
        onFinished: (advancing, finalScore) => handleRoomFinished(index, roomId, advancing, finalScore),
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
      handleRoomFinished(index, roomId, [], score, 'error');
    }
  });
}

function handleRoomFinished(lineageIndex, roomId, advancing, finalScore) {
  const room = rooms.get(roomId);
  const allMembers = room
    ? Object.values(room.players).map((p) => ({ socketId: p.playerId, nickname: p.nickname }))
    : [];

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

      // A session is considered "open" the moment at least one admin is
      // connected — no separate open/close toggle needed. Regular joins
      // are rejected until then; an admin's own join always goes through
      // (that's literally what opens the session for everyone else).
      if (!isAdminAttempt && adminSockets.size === 0) {
        socket.emit('joinRejected', { reason: 'no-session' });
        return;
      }

      if (isAdminAttempt) {
        if (password !== ADMIN_PASSWORD) {
          socket.emit('joinRejected', { reason: 'bad-password' });
          return;
        }
        adminSockets.add(socket.id);
      }

      lobbyPlayers[socket.id] = { nickname, animalIndex: Math.floor(Math.random() * ANIMAL_COUNT) };
      broadcastLobby();
    });

    socket.on('addBot', () => {
      if (!adminSockets.has(socket.id) || globalPhase !== 'LOBBY') {
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

    socket.on('startTournament', () => {
      if (!adminSockets.has(socket.id) || globalPhase !== 'LOBBY') {
        return;
      }
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
      startStage(chunkForInitialRound(members).map((group) => ({ members: group, score: 0 })), 1);
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
