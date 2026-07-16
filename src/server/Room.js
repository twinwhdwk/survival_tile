import {
  MAP_COLS,
  MAP_ROWS,
  TILE_STATE,
  WARNING_DELAY_MS,
  COLLAPSE_DELAY_MS,
} from '../shared/mapConfig';
import { hexToPixel, pixelToHex, hexNeighbors, DIRECTION_COUNT } from '../shared/hexGrid';
import {
  SURVIVAL_ROUND_DURATION_MS,
  BOSS_ROUND_DURATION_MS,
  START_COUNTDOWN_MS,
  BOUNDARY_SHRINK_GRACE_MS,
  BOUNDARY_SHRINK_INTERVAL_MS,
  BOUNDARY_WAVE_MS,
  AUTO_REGEN_BASE_BURST,
  AUTO_REGEN_BURST_PER_ALIVE_PLAYER,
  AUTO_REGEN_SOLID_RATIO_THRESHOLD,
  AUTO_REGEN_MIN_INTERVAL_MS,
  SURVIVAL_SCORE_PER_SECOND,
  SOLO_LAST_SURVIVOR_BONUS_SCORE,
  SOLO_BOT_PLACEHOLDER_SCORE_MAX,
  SOLO_BOT_SCORE_GAP_MIN,
  SOLO_BOT_SCORE_GAP_MAX,
  REGEN_GRACE_MS,
  GHOST_REVIVE_GAUGE_PER_TAP,
  GHOST_REVIVE_GAUGE_MAX,
  GHOST_RESPAWN_STILLNESS_MS,
} from '../shared/roundConfig';
import {
  GHOST_REVIVE_COOLDOWN_MS,
  GHOST_REVIVE_LAST_STAND_COOLDOWN_MS,
  BOSS_METEOR_DAMAGE,
  BOSS_HIT_SCORE,
  BOSS_KILL_SCORE,
  getBossMaxHp,
  CRITICAL_DAMAGE_MULTIPLIER,
  ADMIN_CRITICAL_COOLDOWN_MS,
  ADMIN_SHATTER_TILE_COUNT,
  ADMIN_SHATTER_COOLDOWN_MS,
} from '../shared/bossConfig';

const CENTER_ROW = Math.floor(MAP_ROWS / 2);
const CENTER_COL = Math.floor(MAP_COLS / 2);

// How far each edge of the safe rectangle can inset before that axis is
// fully closed. The map is wider than it is tall, so these differ — rows
// bottom out sooner than columns, which is fine: the safe zone becomes a
// horizontal sliver for the last few steps before finally closing on the
// column axis too, rather than snapping to a point all at once.
//
// Capped one ring short of fully closing (rather than the true geometric
// max) on both axes — a live audit found the boundary reaching its full
// extent (a 1-row-tall sliver, ~6 tiles) reliably *before* SURVIVAL's round
// timer ran out, and standing on a 1-tile-wide strip where every tile you
// touch is gone 1.2s later isn't survivable no matter how well someone
// plays: 3 of 4 tested rounds ended in a full wipeout before any room ever
// reached the boss stage. Leaving one extra ring standing (a ~3-row area)
// gives a real, if tight, endgame instead of a guaranteed-death final phase.
const MAX_ROW_INSET = Math.floor((MAP_ROWS - 1) / 2) - 1;
const MAX_COL_INSET = Math.floor((MAP_COLS - 1) / 2) - 1;

// How many tiles out a bot's findStepTowardSafety() BFS scans before giving
// up and falling back to simple immediate-neighbor avoidance. Deep enough to
// route around a locally-collapsed pocket, shallow enough to stay cheap
// running for every bot on its own turn (see BOT_MOVE_INTERVAL_MIN_MS below).
const BOT_SEARCH_DEPTH = 6;

// Each bot gets its own random movement interval in this range, assigned
// once (see moveBotsRandomly()'s botMoveIntervalMs map) rather than every
// bot in a room stepping in perfect lockstep on server.js's single global
// BOT_TICK_MS beat — a room full of bots that all move at literally the
// same instant every time reads as visibly mechanical/synchronized in a way
// real, independent players never are. 300-600ms mirrors the same range
// server.js's BOT_TICK_MS previously used as one fixed value for every bot.
const BOT_MOVE_INTERVAL_MIN_MS = 300;
const BOT_MOVE_INTERVAL_MAX_MS = 600;

// Chance a bot just stands still on any given movement turn instead of
// stepping — real players don't move in perfectly steady lockstep, they
// pause to look around, react, or hesitate. A flat per-turn skip is a
// simple stand-in for that. Harmless relative to the boundary's own
// timescale (BOUNDARY_SHRINK_INTERVAL_MS is 15s; this costs at most one
// bot's own movement interval, at most BOT_MOVE_INTERVAL_MAX_MS), and
// findStepTowardSafety() recomputes fresh every turn anyway, so a skipped
// turn never leaves a bot committed to a stale plan.
const BOT_HESITATION_CHANCE = 0.2;

// Minimum spacing (ms) between 'playerMoved' broadcasts for a single player.
// A real client emits 'playerMovement' every animation frame a direction key
// is held (~60/sec, uncapped), and each one otherwise fans out to every other
// socket in the room. Coalescing to ~20/sec (leading edge + a trailing emit
// for the final resting position) cuts that outbound volume ~3x with no
// visible cost: the client eases between updates via its own per-frame lerp,
// for which 20Hz of fresh targets is already smooth. Crucially this throttles
// *only the broadcast* — collision/collapse/boss logic in movePlayerTo still
// runs on every single move. Bots (one step every BOT_MOVE_INTERVAL_MIN_MS-
// MAX_MS, always slower than this window even at the fast end) always clear
// this window, so their cadence and behavior are unchanged.
const MOVE_BROADCAST_MIN_INTERVAL_MS = 50;

function createSolidTileMap() {
  const map = [];
  for (let row = 0; row < MAP_ROWS; row++) {
    map.push(new Array(MAP_COLS).fill(TILE_STATE.SOLID));
  }
  return map;
}

// Picks among candidates (each carrying a `.dir`, a hex direction index
// 0-5) with a soft bias toward whichever one continues closest to
// preferredDir, instead of pure uniform-random. Used to give bots a
// winding, continuous-looking path — hold roughly the same heading for a
// while, drift gently rather than jitter — instead of picking a brand new
// random direction on literally every tick, which read as erratic and
// (per BOT_MOVE_INTERVAL_MIN_MS's own comment) burned through tiles faster
// than deliberate human movement does. preferredDir === null (a bot's
// first move, or after a mode transition) falls back to true uniform
// random, same as before this existed.
function pickWeightedByHeading(candidates, preferredDir) {
  if (preferredDir === null || preferredDir === undefined || candidates.length <= 1) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  const weights = candidates.map((c) => {
    const raw = Math.abs(c.dir - preferredDir) % DIRECTION_COUNT;
    const circularDistance = Math.min(raw, DIRECTION_COUNT - raw);
    return DIRECTION_COUNT - circularDistance; // same dir -> heaviest, opposite -> lightest
  });
  const total = weights.reduce((sum, w) => sum + w, 0);

  let roll = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) {
      return candidates[i];
    }
  }
  return candidates[candidates.length - 1];
}

/**
 * One self-contained match. Multiple Rooms run concurrently; each owns its
 * own tile map, players, and timers.
 *
 * mode 'SURVIVAL' (stage 1): a battle-royale-style closing boundary. After a
 * short grace period the map's outer ring starts burning inward, one ring
 * every BOUNDARY_SHRINK_INTERVAL_MS, forcing everyone toward the center.
 * mode 'BOSS' (stage 2+): a single roaming tile deals damage to a shared
 * boss when stepped on. Boss HP scales with how many humans made it into
 * the room. Running out the clock is no longer a loss — whoever is still
 * alive simply carries their score into the next round. The only way a
 * team is cut short is every single member dying (nobody left to keep
 * scoring), which ends the room immediately.
 */
export default class Room {
  constructor(id, io, members, { mode, stage, startingScore, gameMode, onFinished }) {
    this.id = id;
    this.io = io;
    this.mode = mode || 'SURVIVAL';
    this.stage = stage || 1;
    // 'TEAM' (default) is the tournament bracket this app was originally
    // built around: lineages merge across stages, revival/scoring are
    // shared team resources. 'SOLO' is a single flat SURVIVAL round with
    // no bracket, no lineage merging, and no ghost tile-revival/respawn —
    // see reviveTile() and eliminatePlayer()'s lastStandActive guard below
    // for where that mechanic gets switched off, and addSurvivalScore()
    // for the per-player score this mode ranks by instead of a shared
    // room score.
    this.gameMode = gameMode || 'TEAM';
    this.onFinished = onFinished;
    this.score = startingScore || 0;
    this.roundDurationMs = this.mode === 'BOSS' ? BOSS_ROUND_DURATION_MS : SURVIVAL_ROUND_DURATION_MS;

    this.players = {};
    this.tileMap = createSolidTileMap();
    this.pendingTiles = new Set();
    this.roundStartTime = Date.now();
    this.finished = false;
    this.reviveCooldowns = new Map();
    // One shared, room-wide revival gauge that every ghost's successful
    // tap contributes to (see reviveTile), replacing the earlier
    // per-player gauges — filling it respawns one random ghost
    // (respawnGhost via respawnRandomGhost), so ghosts are pulling
    // together toward the next revival instead of each grinding a
    // private meter.
    this.teamRevivalGauge = 0;
    // Tile key -> timestamp until which that tile is immune to
    // triggerTileCollapse() re-starting its collapse — set whenever a tile
    // comes back via autoRegenerateTiles() or a ghost's reviveTile(), so a
    // freshly-restored tile isn't instantly walked on and popped again.
    this.regenGraceUntil = new Map();
    // Per-player movement-broadcast throttle state (socketId -> { last, timer }),
    // kept off the player object itself so the Node Timeout it holds never ends
    // up in a serialized getSnapshot() payload. See broadcastPlayerMoved().
    this.moveBroadcast = new Map();
    // Per-bot remembered heading (socketId -> direction index 0-5), used to
    // bias movement choices toward continuing the same general direction
    // instead of picking a fresh random one every tick. See
    // pickWeightedByHeading().
    this.botHeadings = new Map();
    // Each bot's own randomized movement cadence (assigned once, on its
    // first moveBotsRandomly() turn) plus the next timestamp it's actually
    // due to act — see BOT_MOVE_INTERVAL_MIN_MS/MAX_MS above for why this
    // is per-bot rather than one shared interval.
    this.botMoveIntervalMs = new Map();
    this.botNextMoveAt = new Map();
    this.safeInset = 0;
    this.boundaryShrinkStepsDone = 0;
    this.lastRegenAt = 0;
    // Tracks the 0-alive -> 1-alive "last stand" state as an explicit
    // false->true->false transition (see eliminatePlayer()/respawnGhost())
    // rather than re-deriving it from aliveCount alone — the ghost-revive
    // gauge can bring a player back into the round and then have them
    // eliminated again later in the same round, which would otherwise
    // re-hit aliveCount === 1 repeatedly and re-broadcast the activation
    // event (and its full-screen client banner) every single time.
    this.lastStandActive = false;

    // Admin-only "balance lever" state (see armCriticalHit() and
    // triggerBossShatterSkill()) — never exposed to players.
    this.pendingCriticalHit = false;
    this.lastAdminCriticalAt = 0;
    this.lastAdminShatterAt = 0;

    members.forEach(({ socketId, nickname, animalIndex, isBot }) => {
      const spawn = this.getRandomSpawn();
      this.players[socketId] = {
        x: spawn.x,
        y: spawn.y,
        playerId: socketId,
        nickname,
        animalIndex,
        eliminated: false,
        isBot: !!isBot,
        // Individual score, credited alongside the shared this.score by
        // addSurvivalScore() below — TEAM mode doesn't rank by this (the
        // room's combined this.score is what carries forward), but SOLO
        // mode's finalRankings are built entirely from each player's own
        // value here (see Room.getPlayerResults()).
        score: 0,
        // Start of the window addSurvivalScore() will next credit — see that
        // method for why this can't just always be roundStartTime once
        // ghost respawns are in play.
        lastScoreCreditAt: this.roundStartTime,
      };
    });

    // Bots exist only for admin testing, not real matches. If this room did
    // start with at least one real player, there's no reason to keep it
    // (and the tournament bracket) alive for the rest of the round just
    // because a test bot is still wandering — that would otherwise stall
    // stagePending indefinitely once every human has left. A room that was
    // ALL bots from the start (possible in a big admin test where humans
    // land in other rooms) is unaffected and plays out normally.
    this.hasHumans = Object.values(this.players).some((p) => !p.isBot);

    if (this.mode === 'BOSS') {
      const maxHp = getBossMaxHp(Object.keys(this.players).length);
      const tile = this.pickRandomSolidTile();
      this.boss = {
        hp: maxHp,
        maxHp,
        row: tile ? tile.row : CENTER_ROW,
        col: tile ? tile.col : CENTER_COL,
      };
    }
  }

  getSnapshot() {
    return {
      roomId: this.id,
      mode: this.mode,
      gameMode: this.gameMode,
      stage: this.stage,
      score: this.score,
      players: this.players,
      tileMap: this.tileMap,
      roundStartTime: this.roundStartTime,
      roundDuration: this.roundDurationMs,
      boss: this.boss || null,
    };
  }

  emit(event, payload) {
    this.io.to(this.id).emit(event, payload);
  }

  // Lightweight per-room stats for the admin's multi-room dashboard (stage
  // 1/2, before the bracket narrows down to a single room worth watching in
  // full). Includes the full tileMap (same array getSnapshot() already
  // sends to real joiners, so the wire cost is proven fine) so each card
  // can render a small live thumbnail of the board instead of just numbers.
  getSummary() {
    const players = Object.values(this.players);
    const aliveCount = players.filter((p) => !p.eliminated).length;
    const elapsed = Date.now() - this.roundStartTime;
    const remainingMs = Math.max(0, this.roundDurationMs - elapsed);
    return {
      roomId: this.id,
      mode: this.mode,
      gameMode: this.gameMode,
      aliveCount,
      totalCount: players.length,
      score: this.score,
      remainingMs,
      tileMap: this.tileMap,
      boss: this.boss ? { hp: this.boss.hp, maxHp: this.boss.maxHp } : null,
    };
  }

  getTileCoords(x, y) {
    return pixelToHex(x, y);
  }

  isSafeTile(row, col) {
    const rowInset = Math.min(this.safeInset, MAX_ROW_INSET);
    const colInset = Math.min(this.safeInset, MAX_COL_INSET);
    return row >= rowInset && row <= MAP_ROWS - 1 - rowInset
      && col >= colInset && col <= MAP_COLS - 1 - colInset;
  }

  // How many rings inside the current safe rectangle (row, col) sits —
  // 0 means right on the current edge (the very next boundary shrink would
  // remove it), higher means further from danger. Negative means already
  // outside the safe zone. Used by findStepTowardSafety() to steer bots
  // toward the interior instead of merely "technically still safe right
  // now," so they aren't caught flat-footed by the next shrink step the
  // way a purely reactive "nearest safe tile" search would leave them.
  safeMargin(row, col) {
    const rowInset = Math.min(this.safeInset, MAX_ROW_INSET);
    const colInset = Math.min(this.safeInset, MAX_COL_INSET);
    return Math.min(
      row - rowInset,
      (MAP_ROWS - 1 - rowInset) - row,
      col - colInset,
      (MAP_COLS - 1 - colInset) - col,
    );
  }

  // The current safe rectangle's edges, in tile coordinates — sent along
  // with the boundary events so the client can draw an outline of what's
  // currently safe, rather than players only finding out tile-by-tile as
  // each one flashes a warning right before it burns.
  getSafeBounds() {
    const rowInset = Math.min(this.safeInset, MAX_ROW_INSET);
    const colInset = Math.min(this.safeInset, MAX_COL_INSET);
    return {
      rowStart: rowInset,
      rowEnd: MAP_ROWS - 1 - rowInset,
      colStart: colInset,
      colEnd: MAP_COLS - 1 - colInset,
    };
  }

  getSafeZoneTiles(inset = this.safeInset) {
    const rowInset = Math.min(inset, MAX_ROW_INSET);
    const colInset = Math.min(inset, MAX_COL_INSET);
    const tiles = [];
    for (let row = rowInset; row <= MAP_ROWS - 1 - rowInset; row++) {
      for (let col = colInset; col <= MAP_COLS - 1 - colInset; col++) {
        tiles.push({ row, col });
      }
    }
    return tiles;
  }

  pickRandomSolidTile() {
    const tiles = [];
    for (let row = 0; row < MAP_ROWS; row++) {
      for (let col = 0; col < MAP_COLS; col++) {
        if (this.tileMap[row][col] === TILE_STATE.SOLID) {
          tiles.push({ row, col });
        }
      }
    }
    if (tiles.length === 0) {
      return null;
    }
    return tiles[Math.floor(Math.random() * tiles.length)];
  }

  // SURVIVAL-only variant of pickRandomSolidTile(), scoped to the current
  // safe zone via getSafeZoneTiles() — the same restriction pattern
  // autoRegenerateTiles() already uses. Used by respawnGhost() so a filled
  // revival gauge never drops a player outside the shrinking boundary,
  // where they'd render as alive and safe but can never count as a
  // survivor at round end (finishRoom's SURVIVAL branch checks isSafeTile)
  // and would keep accruing SURVIVAL_SCORE_PER_SECOND for standing outside
  // the play area.
  pickRandomSolidTileInSafeZone() {
    const tiles = this.getSafeZoneTiles().filter(({ row, col }) => this.tileMap[row][col] === TILE_STATE.SOLID);
    if (tiles.length === 0) {
      return null;
    }
    return tiles[Math.floor(Math.random() * tiles.length)];
  }

  // Used by moveBotsRandomly()'s eliminated-bot branch, which calls
  // reviveTile() the same way a real ghost's tile click does, just picked
  // at random rather than aimed by a cursor.
  pickRandomGoneTile() {
    const tiles = [];
    for (let row = 0; row < MAP_ROWS; row++) {
      for (let col = 0; col < MAP_COLS; col++) {
        if (this.tileMap[row][col] === TILE_STATE.GONE) {
          tiles.push({ row, col });
        }
      }
    }
    if (tiles.length === 0) {
      return null;
    }
    return tiles[Math.floor(Math.random() * tiles.length)];
  }

  getRandomSpawn() {
    const tiles = [];
    for (let row = 0; row < MAP_ROWS; row++) {
      for (let col = 0; col < MAP_COLS; col++) {
        if (this.tileMap[row][col] === TILE_STATE.SOLID) {
          tiles.push({ row, col });
        }
      }
    }
    if (tiles.length === 0) {
      return hexToPixel(CENTER_ROW, CENTER_COL);
    }
    const { row, col } = tiles[Math.floor(Math.random() * tiles.length)];
    return hexToPixel(row, col);
  }

  triggerTileCollapse(row, col) {
    const key = `${row}_${col}`;
    if (this.tileMap[row][col] !== TILE_STATE.SOLID || this.pendingTiles.has(key)) {
      return;
    }
    const graceUntil = this.regenGraceUntil.get(key);
    if (graceUntil && Date.now() < graceUntil) {
      return;
    }
    this.pendingTiles.add(key);

    setTimeout(() => {
      if (this.finished) {
        return;
      }
      this.tileMap[row][col] = TILE_STATE.WARNING;
      this.emit('tileWarning', { row, col });

      setTimeout(() => {
        if (this.finished) {
          return;
        }
        this.tileMap[row][col] = TILE_STATE.GONE;
        this.pendingTiles.delete(key);
        this.emit('tileCollapsed', { row, col });
        this.dropPlayersOnTile(row, col);
      }, COLLAPSE_DELAY_MS);
    }, WARNING_DELAY_MS);
  }

  dropPlayersOnTile(row, col) {
    Object.keys(this.players).forEach((id) => {
      const player = this.players[id];
      if (player.eliminated) {
        return;
      }
      const coords = this.getTileCoords(player.x, player.y);
      if (coords.row === row && coords.col === col) {
        this.eliminatePlayer(id);
      }
    });
  }

  // SURVIVAL rounds have no boss to hit for points, so the score instead
  // rewards how long each teammate personally lasted (whole seconds, summed
  // across the lineage) — called once per player, either the instant they're
  // eliminated or (for whoever's still standing) at finishRoom time.
  //
  // Credits only the window since this player's last credited timestamp
  // (initialized to roundStartTime, advanced on every credit and on every
  // ghost respawn — see respawnGhost()), not the full time since round
  // start. The ghost-revival gauge lets an eliminated player come back and
  // potentially get eliminated again later in the same round; crediting
  // from roundStartTime every time would re-count their earlier alive time
  // (and even their dead-ghost time) on every subsequent elimination —
  // exploitable by deliberately cycling elimination/respawn for a better
  // score than just surviving normally.
  addSurvivalScore(player, endTime) {
    const creditFrom = player.lastScoreCreditAt || this.roundStartTime;
    const survivedMs = Math.max(0, endTime - creditFrom);
    const gained = Math.floor(survivedMs / 1000) * SURVIVAL_SCORE_PER_SECOND;
    this.score += gained;
    // Always credited alongside the shared this.score above (not just in
    // SOLO) — cheap to keep, and TEAM mode simply never reads it back out.
    player.score = (player.score || 0) + gained;
    player.lastScoreCreditAt = endTime;
  }

  eliminatePlayer(id) {
    const player = this.players[id];
    if (!player || player.eliminated || this.finished) {
      return;
    }
    player.eliminated = true;
    if (this.mode === 'SURVIVAL') {
      this.addSurvivalScore(player, Date.now());
    }
    this.emit('playerEliminated', { playerId: id, score: this.score, playerScore: player.score || 0 });

    const aliveCount = Object.values(this.players).filter((p) => !p.eliminated).length;
    // Last-stand only means anything where ghosts can actually rally to
    // revive someone (see reviveTile()'s own SOLO guard below) — 개인전 has
    // no revival at all, so skip the activation/banner entirely there
    // rather than firing a cue with nothing behind it.
    if (this.gameMode !== 'SOLO' && aliveCount === 1 && !this.lastStandActive) {
      // Same "last-stand" threshold reviveTile() already waives the ghost
      // cooldown down to (see its aliveCount > 1 check) — this just tells
      // every client that moment has arrived, so ghosts know to tap freely
      // and the lone survivor knows why the map is suddenly filling back
      // in. Only fired on the actual false->true transition (see
      // this.lastStandActive's own comment) — respawnGhost() flips it back
      // and re-emits with active: false once the gauge brings someone back
      // and aliveCount rises above 1 again.
      this.lastStandActive = true;
      this.emit('lastStandActivated', { active: true });
    }

    const allEliminated = Object.values(this.players).every((p) => p.eliminated);
    // TEAM mode ends the room the instant every real human is gone even if
    // bots are still "alive" -- bots only exist for admin testing there,
    // so there's no one left to actually watch the room continue.
    const allHumansGone = this.gameMode !== 'SOLO'
      && this.hasHumans && Object.values(this.players).every((p) => p.isBot || p.eliminated);

    // 개인전: once every real player in the room is gone, nobody is left who
    // would ever see how the remaining bots' round actually plays out, so
    // rather than keep ticking them forward in real time for no one to
    // watch, the round ends right here and randomizeBotResults() replaces
    // every bot's own final score/standing with a placeholder -- see its
    // own comment for why that's preferable to just freezing them at
    // whatever mid-round state they happened to be in.
    const soloAllHumansEliminated = this.gameMode === 'SOLO' && !allEliminated
      && this.hasHumans
      && Object.values(this.players).filter((p) => !p.isBot).every((p) => p.eliminated);
    if (soloAllHumansEliminated) {
      this.randomizeBotResults();
    }

    // 개인전's own last-survivor case: only reachable with a *human* as the
    // sole remaining player now -- soloAllHumansEliminated above already
    // ends the round the instant the last human dies, so a bot can never
    // again be the one left standing alone by the time this check runs.
    // Still worth ending early (rather than idling out the rest of the
    // round with no bots left to threaten them) and topping the winner's
    // score up — see SOLO_LAST_SURVIVOR_BONUS_SCORE's own comment.
    const soloLastSurvivorStanding = this.gameMode === 'SOLO' && !allEliminated
      && !soloAllHumansEliminated && aliveCount === 1;
    if (soloLastSurvivorStanding) {
      const winner = Object.values(this.players).find((p) => !p.eliminated);
      if (winner) {
        winner.score = (winner.score || 0) + SOLO_LAST_SURVIVOR_BONUS_SCORE;
      }
    }

    if (allEliminated || allHumansGone || soloAllHumansEliminated || soloLastSurvivorStanding) {
      const reason = soloAllHumansEliminated ? 'solo-human-eliminated'
        : (soloLastSurvivorStanding ? 'last-survivor' : 'all-eliminated');
      this.finishRoom(reason);
    }
  }

  // 개인전 only: once every real player is gone (see soloAllHumansEliminated,
  // this method's sole caller), there is no one left in the room whose
  // opinion of the bots' "accuracy" matters — the operator's own call here
  // was that continuing to simulate them in real time for an empty audience
  // isn't worth it, and the human never looks at bot scores anyway. Forcing
  // every bot to `eliminated: true` (regardless of whether they technically
  // still had a live avatar the instant the round ended) keeps
  // getPlayerResults()' shape uniform — a real mid-round bot state mixed in
  // among faked ones would look inconsistent for no benefit, since nothing
  // downstream distinguishes "genuinely eliminated" from "round ended
  // around them" for a bot anyway.
  randomizeBotResults() {
    const bots = Object.values(this.players).filter((p) => p.isBot);
    // Shuffle first (Fisher-Yates) -- this shuffled order *is* the random
    // ranking among the bots. Assigning each bot its own fully independent
    // random score (the previous approach) could easily land two bots on
    // the exact same value, which read on the results screen as a tie
    // despite nothing about a "last survivor, everyone else already dead"
    // outcome actually being tied. Walking the shuffled order and strictly
    // decreasing the score every step guarantees a clean 1st/2nd/3rd/...
    // ranking with no possible tie, while still keeping which bot lands
    // where entirely random.
    for (let i = bots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bots[i], bots[j]] = [bots[j], bots[i]];
    }
    let score = SOLO_BOT_PLACEHOLDER_SCORE_MAX;
    bots.forEach((bot) => {
      bot.eliminated = true;
      bot.score = Math.max(0, score);
      score -= SOLO_BOT_SCORE_GAP_MIN + Math.floor(Math.random() * (SOLO_BOT_SCORE_GAP_MAX - SOLO_BOT_SCORE_GAP_MIN + 1));
    });
  }

  movePlayerTo(id, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }

    const player = this.players[id];
    if (!player || player.eliminated || this.finished) {
      return;
    }

    // The client shows a 10s pre-game countdown, but that's just an
    // overlay — without this check bots (and any real player whose input
    // beat the countdown) would already be roaming and popping tiles while
    // everyone else is still watching numbers count down.
    if (Date.now() - this.roundStartTime < START_COUNTDOWN_MS) {
      return;
    }

    const { row, col } = this.getTileCoords(x, y);
    if (this.tileMap[row][col] === TILE_STATE.GONE) {
      return;
    }

    player.x = x;
    player.y = y;
    this.broadcastPlayerMoved(player);
    this.triggerTileCollapse(row, col);

    if (this.mode === 'BOSS' && this.boss && this.boss.hp > 0 && row === this.boss.row && col === this.boss.col) {
      this.damageBoss();
    }
  }

  // Rate-limited, trimmed movement broadcast (see MOVE_BROADCAST_MIN_INTERVAL_MS).
  //
  // Payload is just { playerId, x, y } — the only fields the client's
  // interpolation actually reads — rather than the whole player object
  // (nickname, animalIndex, eliminated, isBot, ...), none of which change
  // per-move and all of which the client already has from the initial
  // snapshot. Everything that legitimately needs full player data
  // (getSnapshot, playerEliminated) is untouched.
  //
  // Leading edge fires immediately; if further moves arrive inside the
  // window they're coalesced and a single trailing emit sends whatever the
  // latest position ended up being — so a player who stops mid-window still
  // has their final resting spot broadcast exactly once. player.x/y is always
  // current by the time the trailing timer fires, so it needs no captured
  // coordinates of its own.
  broadcastPlayerMoved(player) {
    const id = player.playerId;
    const now = Date.now();
    let state = this.moveBroadcast.get(id);
    if (!state) {
      state = { last: 0, timer: null };
      this.moveBroadcast.set(id, state);
    }

    if (now - state.last >= MOVE_BROADCAST_MIN_INTERVAL_MS) {
      state.last = now;
      this.emit('playerMoved', { playerId: id, x: player.x, y: player.y });
      return;
    }

    if (!state.timer) {
      state.timer = setTimeout(() => {
        state.timer = null;
        if (this.finished || player.eliminated) {
          return;
        }
        state.last = Date.now();
        this.emit('playerMoved', { playerId: id, x: player.x, y: player.y });
      }, MOVE_BROADCAST_MIN_INTERVAL_MS - (now - state.last));
    }
  }

  damageBoss() {
    // A one-shot flag armed by the admin's "C" dashboard key (see
    // armCriticalHit()) rather than a random chance — this hit's damage
    // simply comes out bigger than usual, which the client renders through
    // the exact same showFloatingDamage()/bossDamaged path as any other
    // hit. No distinct "critical!" cue anywhere, by design.
    const isCritical = this.pendingCriticalHit;
    this.pendingCriticalHit = false;
    const damage = BOSS_METEOR_DAMAGE * (isCritical ? CRITICAL_DAMAGE_MULTIPLIER : 1);

    this.boss.hp = Math.max(0, this.boss.hp - damage);
    const defeated = this.boss.hp <= 0;
    this.score += defeated ? BOSS_KILL_SCORE : BOSS_HIT_SCORE;

    if (defeated) {
      this.emit('bossDamaged', {
        hp: 0,
        maxHp: this.boss.maxHp,
        row: this.boss.row,
        col: this.boss.col,
        defeated: true,
        score: this.score,
      });
      this.finishRoom('boss-defeated');
      return;
    }

    const tile = this.pickRandomSolidTile() || this.forceOpenTileAtCenter();
    this.boss.row = tile.row;
    this.boss.col = tile.col;
    this.emit('bossDamaged', {
      hp: this.boss.hp,
      maxHp: this.boss.maxHp,
      row: this.boss.row,
      col: this.boss.col,
      defeated: false,
      score: this.score,
    });
  }

  // "C" on the admin's dashboard (or spectator view) for this room. Arms a
  // one-shot flag rather than dealing damage directly — the *next* real hit
  // on the boss tile (by whichever player actually gets there) is what
  // deals it, so it still requires someone to be playing rather than the
  // admin unilaterally moving the boss's HP. Rate-limited so a held key (or
  // a curious admin mashing it) can't repeatedly re-arm it before that next
  // hit even lands.
  armCriticalHit() {
    if (this.mode !== 'BOSS') {
      return;
    }
    const now = Date.now();
    if (now - this.roundStartTime < START_COUNTDOWN_MS) {
      return;
    }
    if (now - this.lastAdminCriticalAt < ADMIN_CRITICAL_COOLDOWN_MS) {
      return;
    }
    this.lastAdminCriticalAt = now;
    this.pendingCriticalHit = true;
  }

  // "S" on the admin's dashboard (or spectator view) for this room. Picks
  // ADMIN_SHATTER_TILE_COUNT random currently-standing tiles and routes them
  // through the exact same triggerTileCollapse() every ordinary footstep
  // uses — same crack-then-break timing/visuals as a normal collapse, so it
  // reads as bad luck rather than a deliberate intervention. The one thing
  // that IS distinct is 'bossShatterSkill' below: a room-wide camera
  // shake/rumble cue so it lands as "the boss just did something," not a
  // silent handful of tiles quietly vanishing — that's still just boss
  // flavor to players, not a tell that it was admin-triggered.
  triggerBossShatterSkill() {
    if (this.mode !== 'BOSS') {
      return;
    }
    const now = Date.now();
    if (now - this.roundStartTime < START_COUNTDOWN_MS) {
      return;
    }
    if (now - this.lastAdminShatterAt < ADMIN_SHATTER_COOLDOWN_MS) {
      return;
    }
    this.lastAdminShatterAt = now;

    const standingTiles = [];
    for (let row = 0; row < MAP_ROWS; row++) {
      for (let col = 0; col < MAP_COLS; col++) {
        const key = `${row}_${col}`;
        if (this.tileMap[row][col] === TILE_STATE.SOLID && !this.pendingTiles.has(key)) {
          standingTiles.push({ row, col });
        }
      }
    }

    for (let i = standingTiles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [standingTiles[i], standingTiles[j]] = [standingTiles[j], standingTiles[i]];
    }
    const chosen = standingTiles.slice(0, ADMIN_SHATTER_TILE_COUNT);
    if (chosen.length > 0) {
      this.emit('bossShatterSkill', {});
    }
    chosen.forEach(({ row, col }) => {
      this.triggerTileCollapse(row, col);
    });
  }

  // Last resort if every tile on the map has collapsed: punch one back
  // open at the center so the boss can never get stranded on a tile
  // nobody can reach again.
  forceOpenTileAtCenter() {
    this.tileMap[CENTER_ROW][CENTER_COL] = TILE_STATE.SOLID;
    this.emit('tileRevived', { row: CENTER_ROW, col: CENTER_COL });
    return { row: CENTER_ROW, col: CENTER_COL };
  }

  reviveTile(id, row, col) {
    // 개인전 has no ghost tile-revival/respawn mechanic at all — elimination
    // is permanent, so there's nothing for a ghost's tap to do. Guarding
    // here (rather than only hiding the tap UI client-side) is what
    // actually keeps respawnRandomGhost()/respawnGhost() unreachable in
    // this mode, since they're only ever invoked from the gauge-fill
    // branch at the end of this method.
    if (this.gameMode === 'SOLO') {
      return;
    }
    if (!Number.isInteger(row) || !Number.isInteger(col)) {
      return;
    }

    const player = this.players[id];
    if (!player || !player.eliminated || this.finished) {
      return;
    }
    if (row < 0 || row >= MAP_ROWS || col < 0 || col >= MAP_COLS) {
      return;
    }
    if (this.tileMap[row][col] !== TILE_STATE.GONE) {
      return;
    }
    // SURVIVAL only: shrinkBoundary() only ever sweeps the *one* ring
    // transitioning at that moment, so a tile revived outside the current
    // safe zone would never get swept again — permanently wasting the tap
    // on ground nobody can get survivor credit for standing on (finishRoom's
    // SURVIVAL branch requires isSafeTile at round end). BOSS has no
    // shrinking boundary (safeInset stays 0, isSafeTile covers the whole
    // map), so this is a no-op there.
    if (this.mode === 'SURVIVAL' && !this.isSafeTile(row, col)) {
      return;
    }

    // Last-stand rally: once only one teammate is still standing, every
    // ghost's revive cooldown shortens from the normal GHOST_REVIVE_COOLDOWN_MS
    // to GHOST_REVIVE_LAST_STAND_COOLDOWN_MS instead of being waived
    // entirely — a genuinely unlimited tap rate (every client click hitting
    // the server with zero throttling, from however many ghosts are already
    // eliminated) risks real load if several people spam-tap at once. Still
    // dramatically faster than normal, just not literally unbounded.
    const aliveCount = Object.values(this.players).filter((p) => !p.eliminated).length;
    const cooldownMs = aliveCount > 1 ? GHOST_REVIVE_COOLDOWN_MS : GHOST_REVIVE_LAST_STAND_COOLDOWN_MS;
    const now = Date.now();
    const lastRevive = this.reviveCooldowns.get(id) || 0;
    if (now - lastRevive < cooldownMs) {
      return;
    }
    this.reviveCooldowns.set(id, now);

    this.tileMap[row][col] = TILE_STATE.SOLID;
    this.regenGraceUntil.set(`${row}_${col}`, Date.now() + REGEN_GRACE_MS);
    this.emit('tileRevived', { row, col });

    // Every successful tap (ghost or bot alike — see moveBotsRandomly's
    // eliminated-bot branch) fills the room's *shared* revival gauge —
    // broadcast room-wide so everyone (alive players included) can watch
    // it climb. Reaching GHOST_REVIVE_GAUGE_MAX brings one random ghost
    // back (see respawnRandomGhost), rather than each ghost grinding a
    // private per-player meter as before.
    this.teamRevivalGauge = Math.min(GHOST_REVIVE_GAUGE_MAX, this.teamRevivalGauge + GHOST_REVIVE_GAUGE_PER_TAP);
    this.emit('reviveGaugeUpdate', { gauge: this.teamRevivalGauge, max: GHOST_REVIVE_GAUGE_MAX });
    if (this.teamRevivalGauge >= GHOST_REVIVE_GAUGE_MAX) {
      this.respawnRandomGhost();
    }
  }

  // A filled team gauge revives one ghost chosen at random — random (not
  // "whoever tapped most") keeps it a genuinely shared effort: a slow
  // tapper has the same shot at coming back as a fast one, so there's no
  // incentive to hold back help hoping to bank personal credit.
  respawnRandomGhost() {
    const ghosts = Object.keys(this.players).filter((pid) => this.players[pid].eliminated);
    if (ghosts.length === 0) {
      return;
    }
    // Reset (and tell every client) before the respawn itself, so the bar
    // on screen empties at the same moment the revival banner fires.
    this.teamRevivalGauge = 0;
    this.emit('reviveGaugeUpdate', { gauge: 0, max: GHOST_REVIVE_GAUGE_MAX });
    const luckyId = ghosts[Math.floor(Math.random() * ghosts.length)];
    this.respawnGhost(luckyId);
  }

  // Brings an eliminated player back into the round once the *team*
  // revival gauge fills (see respawnRandomGhost, its only caller) — not a
  // full re-seat (name/animal/score all stay as they were), just clearing
  // `eliminated` and dropping them back onto a currently-standing tile,
  // since their old position may well be gone by now.
  respawnGhost(id) {
    const player = this.players[id];
    if (!player || !player.eliminated || this.finished) {
      return;
    }
    // SURVIVAL restricts the candidate pool to the current safe zone (see
    // pickRandomSolidTileInSafeZone()); BOSS has no shrinking boundary, so
    // it keeps picking from the whole map as before.
    const tile = this.mode === 'SURVIVAL' ? this.pickRandomSolidTileInSafeZone() : this.pickRandomSolidTile();
    if (!tile) {
      return; // nothing standing anywhere (in the safe zone, for SURVIVAL) to respawn onto — stay a ghost
    }
    const { x, y } = hexToPixel(tile.row, tile.col);
    const respawnTime = Date.now();
    player.eliminated = false;
    player.x = x;
    player.y = y;
    // addSurvivalScore() was already called for this player at their most
    // recent elimination, crediting them up to that moment. Without this,
    // the *next* elimination would credit all the way back from that old
    // timestamp again — incorrectly including the dead-ghost time in
    // between as if they'd been alive and scoring the whole time.
    player.lastScoreCreditAt = respawnTime;
    this.reviveCooldowns.delete(id);
    this.emit('playerRevived', { playerId: id, nickname: player.nickname, score: player.score || 0, x, y });

    // A revived player who just stands there has effectively taken
    // themselves back out of the round without the tile pressure everyone
    // else is under — collapse their respawn tile out from under them if
    // they haven't moved off it within GHOST_RESPAWN_STILLNESS_MS.
    // Re-reads this.players[id] fresh (not the closed-over `player`) since
    // by the time this fires they may have been eliminated again, revived
    // yet again onto a different tile, or disconnected entirely — coords
    // are compared against the *tile* they respawned onto here, not their
    // exact x/y, so drifting within the same hex still counts as "hasn't
    // moved."
    setTimeout(() => {
      if (this.finished) {
        return;
      }
      const current = this.players[id];
      if (!current || current.eliminated) {
        return;
      }
      const coords = this.getTileCoords(current.x, current.y);
      if (coords.row === tile.row && coords.col === tile.col) {
        this.triggerTileCollapse(tile.row, tile.col);
      }
    }, GHOST_RESPAWN_STILLNESS_MS);

    // Mirror image of the activation in eliminatePlayer(): a respawn is the
    // only way aliveCount can go back up mid-round, so this is the one place
    // last-stand can end. Only fires on the true->false transition, and only
    // once aliveCount has actually climbed back above 1 — respawning the
    // very last ghost when aliveCount was already 0 would be impossible
    // anyway (finishRoom('all-eliminated') already ended the room by then).
    if (this.lastStandActive) {
      const aliveCount = Object.values(this.players).filter((p) => !p.eliminated).length;
      if (aliveCount > 1) {
        this.lastStandActive = false;
        this.emit('lastStandActivated', { active: false });
      }
    }
  }

  // Fired once, right when the grace period ends and the boundary starts
  // closing in — a heads-up cue (banner + camera shake on the client) that
  // the free-roam phase is over. Called after shrinkBoundary() has already
  // pulled in the first ring, so safeBounds reflects the zone as it is
  // right now, not the pre-shrink one.
  announceBoundaryShrink() {
    this.emit('massCollapseStarted', { safeBounds: this.getSafeBounds() });
  }

  // Pulls the safe zone in by one ring, burning the outgoing ring through
  // the normal warning->collapse sequence (each tile's delay jittered
  // across BOUNDARY_WAVE_MS so the ring crumbles organically rather than
  // vanishing all at once). Tiles are plain SOLID the whole time — there's
  // no special "safe zone" tile state or color; isSafeTile() alone
  // decides what still counts as inside the shrinking boundary.
  shrinkBoundary() {
    if (this.safeInset >= MAX_ROW_INSET && this.safeInset >= MAX_COL_INSET) {
      return;
    }

    const oldInset = this.safeInset;
    this.safeInset += 1;

    this.getSafeZoneTiles(oldInset).forEach(({ row, col }) => {
      if (this.isSafeTile(row, col) || this.tileMap[row][col] !== TILE_STATE.SOLID) {
        return;
      }
      const delay = Math.random() * BOUNDARY_WAVE_MS;
      setTimeout(() => {
        if (!this.finished) {
          this.triggerTileCollapse(row, col);
        }
      }, delay);
    });
  }

  // Breadth-first search outward from (startRow, startCol) — traversing
  // only SOLID, non-pending tiles (a WARNING or collapse-scheduled tile is
  // a hole by the time a second step could land on it, so it's neither a
  // valid destination nor a valid stepping stone) — collecting every
  // reachable safe tile within BOT_SEARCH_DEPTH, then picking among them
  // by a score that favors *margin* from the current safe-zone edge
  // (safeMargin()) first, local connectivity (few neighboring holes)
  // second, with a mild penalty for crowding onto other players and a
  // light tiebreak toward nearer options. A purely "nearest safe tile"
  // bot reads as reactive rather than skilled: it settles on a tile right
  // on the current edge, at the tip of a peninsula of holes, or on top of
  // a teammate — then gets caught out by exactly the hazard it ignored.
  //
  // Returns just the *first step* of the winning path (an adjacent tile,
  // plus its direction index), not the whole route — moveBotsRandomly()
  // only needs to know which way to lean this tick, and recomputes fresh
  // next tick anyway as the map keeps changing under it (tiles collapsing,
  // boundary closing in). Capped at BOT_SEARCH_DEPTH tiles out so a bot in
  // a small isolated pocket doesn't scan the entire map every tick; returns
  // null if nothing suitable is found within that radius (caller falls
  // back to immediate-neighbor logic).
  //
  // preferredDir (a bot's remembered heading, or null) gives a small
  // continuity bonus so a bot facing several similarly-good options keeps
  // drifting roughly the same way instead of jittering between directions
  // every tick — see pickWeightedByHeading(), used here only to add
  // organic variety among the top-scoring candidates rather than always
  // picking a single deterministic "best" tile.
  findStepTowardSafety(startRow, startCol, preferredDir) {
    const startKey = `${startRow}_${startCol}`;
    const visited = new Set([startKey]);
    let frontier = [{ row: startRow, col: startCol, firstStep: null, firstStepDir: null }];
    const found = [];

    // Where every *other* still-alive player currently stands — used below
    // to penalize candidates on/next to occupied tiles. Bots that all
    // score tiles identically converge on the same interior spots, burn
    // the shared floor under each other, and box each other into fresh
    // holes; a human instinctively keeps a little distance for exactly
    // that reason. Built once per call, not per candidate.
    const occupied = new Set();
    Object.values(this.players).forEach((p) => {
      if (!p.eliminated) {
        const c = this.getTileCoords(p.x, p.y);
        occupied.add(`${c.row}_${c.col}`);
      }
    });
    occupied.delete(startKey); // never penalize a bot for its own position

    for (let depth = 0; depth < BOT_SEARCH_DEPTH && frontier.length > 0; depth++) {
      const next = [];

      for (const node of frontier) {
        const neighbors = hexNeighbors(node.row, node.col);
        for (const { row, col, dir } of neighbors) {
          const key = `${row}_${col}`;
          if (visited.has(key)) {
            continue;
          }
          visited.add(key);

          const state = this.tileMap[row][col];

          // Only SOLID, non-pending tiles are traversable at all — not
          // merely excluded as destinations. A bot walks one tile per
          // 600ms tick while a stepped-on tile is fully GONE 1200ms after
          // its collapse was scheduled, so any "path" through a WARNING or
          // pending tile is fiction: by the time the bot's second step
          // would land there, it's a hole. Worse, the *first step* of the
          // returned path could itself be such a tile (the old code pushed
          // them into the frontier as pass-through nodes), sending bots
          // directly onto ground with <600ms left — one of the main
          // reasons they kept dying almost immediately.
          const isPending = this.pendingTiles.has(key);
          if (state !== TILE_STATE.SOLID || isPending) {
            continue;
          }

          const firstStep = node.firstStep || { row, col };
          const firstStepDir = node.firstStepDir !== null ? node.firstStepDir : dir;
          if (this.isSafeTile(row, col)) {
            // Local connectivity: how many of this tile's own neighbors
            // are still standing. A high-margin tile at the tip of a
            // peninsula of holes is a trap a human would read at a glance;
            // counting solid neighbors is the cheap proxy for that.
            let solidNeighbors = 0;
            let crowdedNeighbors = 0;
            hexNeighbors(row, col).forEach((n) => {
              const nKey = `${n.row}_${n.col}`;
              if (this.tileMap[n.row][n.col] === TILE_STATE.SOLID && !this.pendingTiles.has(nKey)) {
                solidNeighbors++;
              }
              if (occupied.has(nKey)) {
                crowdedNeighbors++;
              }
            });

            found.push({
              row: firstStep.row,
              col: firstStep.col,
              dir: firstStepDir,
              depth,
              margin: this.safeMargin(row, col),
              solidNeighbors,
              crowded: (occupied.has(key) ? 2 : 0) + crowdedNeighbors,
            });
          } else {
            next.push({ row, col, firstStep, firstStepDir });
          }
        }
      }
      frontier = next;
    }

    if (found.length === 0) {
      return null;
    }

    // Margin still dominates (each ring of safety beats a couple tiles of
    // detour), with connectivity as a real secondary factor (avoid
    // peninsulas/dead ends), crowding as a mild repulsion (spread out
    // instead of stacking onto teammates' tiles), and depth as a light
    // tiebreak toward nearer options.
    let bestScore = -Infinity;
    found.forEach((c) => {
      c.score = c.margin * 2 + c.solidNeighbors * 0.6 - c.crowded * 0.8 - c.depth * 0.5;
      if (c.score > bestScore) {
        bestScore = c.score;
      }
    });

    // Keep every candidate within a point of the best score (not just
    // ties) so pickWeightedByHeading() still has real, comparably-good
    // options to weigh by heading continuity — otherwise a bot would
    // re-plan a brand new direction every single tick even among tiles
    // that are all roughly equally safe.
    const topCandidates = found.filter((c) => c.score >= bestScore - 1);
    return pickWeightedByHeading(topCandidates, preferredDir);
  }

  // Test bots have no client sending 'playerMovement', so the room drives
  // them itself: one step per call, through the same movePlayerTo() path a
  // real player uses (so collapse/elimination/boss damage all behave
  // identically for a bot as for a human). Called from a dedicated,
  // faster-than-1s interval in server.js — a real player sends a steady
  // stream of small movements every frame, so bots that only stepped once a
  // second (tied to the round-state tick) read as barely moving by
  // comparison.
  //
  // Looks ahead with findStepTowardSafety() rather than only checking
  // immediate neighbors, so a bot near a burning edge or a locally-collapsed
  // pocket actually navigates toward standing ground instead of just
  // avoiding the one hole directly next to it. Falls back to the simpler
  // "don't step on a hole if a solid neighbor exists" logic when no path is
  // found within the search radius (e.g. everything reachable nearby is
  // already gone).
  moveBotsRandomly() {
    if (Date.now() - this.roundStartTime < START_COUNTDOWN_MS) {
      return;
    }

    Object.keys(this.players).forEach((id) => {
      const player = this.players[id];
      if (!player.isBot) {
        return;
      }

      // A bot that's been eliminated is now a "ghost" exactly like a real
      // eliminated player — same reviveTile() path, same cooldown/last-stand
      // rules, same revival-gauge payoff — just aimed at a random collapsed
      // tile each attempt instead of a real cursor click. Without this,
      // bots went completely idle the moment they died, which is both a
      // wasted teammate and (per the person's own report) reads as "do bots
      // even help revive tiles?" — no, previously; now yes.
      if (player.eliminated) {
        // reviveTile() already no-ops for SOLO, but skip the
        // pickRandomGoneTile() scan entirely there too — there's no point
        // spending a tile scan every tick on a tap that can never do
        // anything in this mode.
        if (this.gameMode !== 'SOLO') {
          const target = this.pickRandomGoneTile();
          if (target) {
            this.reviveTile(id, target.row, target.col);
          }
        }
        return;
      }

      // Gate live (non-ghost) movement to this bot's own randomized
      // cadence rather than server.js's much finer BOT_TICK_MS polling
      // interval — that tick just needs to run fine enough to never miss
      // any one bot's due time by much, not dictate how often bots
      // actually step. Assigned lazily on this bot's first turn so it
      // starts acting almost immediately rather than waiting out a full
      // interval before its very first move.
      const now = Date.now();
      if (!this.botMoveIntervalMs.has(id)) {
        const interval = BOT_MOVE_INTERVAL_MIN_MS
          + Math.random() * (BOT_MOVE_INTERVAL_MAX_MS - BOT_MOVE_INTERVAL_MIN_MS);
        this.botMoveIntervalMs.set(id, interval);
        this.botNextMoveAt.set(id, now);
      }
      if (now < this.botNextMoveAt.get(id)) {
        return;
      }
      this.botNextMoveAt.set(id, now + this.botMoveIntervalMs.get(id));

      const { row: currentRow, col: currentCol } = this.getTileCoords(player.x, player.y);

      // Every tile a bot stands on is already on the collapse clock (its
      // own arrival scheduled it — WARNING at +600ms, GONE at +1200ms),
      // and bots step once per ~600ms tick. Hesitating on such a tile is
      // therefore a coin-flip with death: one skipped tick pushes the next
      // move attempt to exactly the 1200ms deadline, two skipped ticks
      // (4% per pair, compounding over dozens of moves a round) is a
      // guaranteed drop. A human never "pauses to look around" while the
      // floor under them is cracking — so hesitation only applies when
      // the current tile is genuinely stable.
      const standingOnDoomedTile = this.pendingTiles.has(`${currentRow}_${currentCol}`)
        || this.tileMap[currentRow][currentCol] !== TILE_STATE.SOLID;
      if (!standingOnDoomedTile && Math.random() < BOT_HESITATION_CHANCE) {
        return;
      }

      const preferredDir = this.botHeadings.has(id) ? this.botHeadings.get(id) : null;

      const step = this.findStepTowardSafety(currentRow, currentCol, preferredDir);
      if (step) {
        const { x, y } = hexToPixel(step.row, step.col);
        this.botHeadings.set(id, step.dir);
        this.movePlayerTo(id, x, y);
        return;
      }

      // hexNeighbors() never returns the cell itself, so every candidate
      // here is already a genuine, in-bounds different tile — no need to
      // filter out a "didn't actually move" case the way pixel-delta
      // directions used to require.
      const candidates = hexNeighbors(currentRow, currentCol).map(({ row, col, dir }) => {
        const { x, y } = hexToPixel(row, col);
        return { x, y, dir, state: this.tileMap[row][col], pending: this.pendingTiles.has(`${row}_${col}`) };
      });

      if (candidates.length === 0) {
        return;
      }

      const safe = candidates.filter(({ state, pending }) => state === TILE_STATE.SOLID && !pending);
      const pool = safe.length > 0 ? safe : candidates;
      const choice = pickWeightedByHeading(pool, preferredDir);

      this.botHeadings.set(id, choice.dir);
      this.movePlayerTo(id, choice.x, choice.y);
    });
  }

  // Runs for both SURVIVAL and BOSS rounds, for the round's whole duration
  // (including after SURVIVAL's boundary starts closing in, not just the
  // pre-boundary grace period — a 36-person load test showed every single
  // stage-1 room going to a total wipeout within seconds of the boundary
  // activating, because regen used to switch off entirely right when it
  // was needed most: several players packed into a shrinking area burn
  // through standing tiles with their own footsteps far faster than a
  // fixed-schedule trickle can keep up, independent of whatever the
  // boundary itself is doing). BOSS rounds have no shrinking boundary at
  // all — this.safeInset stays 0 for their whole duration, so
  // getSafeZoneTiles() below naturally covers the entire board instead of
  // a shrinking rectangle, and the exact same threshold/burst logic just
  // applies map-wide.
  //
  // Triggered by tile scarcity rather than a fixed timer: once fewer than
  // AUTO_REGEN_SOLID_RATIO_THRESHOLD of the *current safe zone's* tiles are
  // still SOLID, restore a burst of them, sized to the room's current
  // alive-player count (see roundConfig.js's AUTO_REGEN_BASE_BURST /
  // AUTO_REGEN_BURST_PER_ALIVE_PLAYER comment) rather than a fixed number —
  // this self-adjusts to however many players/bots are actually eating
  // through the floor right now. AUTO_REGEN_MIN_INTERVAL_MS just
  // rate-limits re-triggering so it doesn't refire every single tick while
  // sitting right at the threshold.
  //
  // Candidates are restricted to the current safe zone (getSafeZoneTiles())
  // rather than the whole map — in SURVIVAL, regenerating ground *outside*
  // the shrinking boundary would undermine the entire point of it once
  // active; in BOSS, that same call just returns the whole map since
  // there's no boundary to restrict to.
  autoRegenerateTiles() {
    const zoneTiles = this.getSafeZoneTiles();
    const goneTiles = [];
    let solidCount = 0;

    zoneTiles.forEach(({ row, col }) => {
      const state = this.tileMap[row][col];
      if (state === TILE_STATE.GONE) {
        goneTiles.push({ row, col });
      } else if (state === TILE_STATE.SOLID) {
        solidCount += 1;
      }
    });

    if (zoneTiles.length === 0 || solidCount / zoneTiles.length >= AUTO_REGEN_SOLID_RATIO_THRESHOLD) {
      return false;
    }

    for (let i = goneTiles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [goneTiles[i], goneTiles[j]] = [goneTiles[j], goneTiles[i]];
    }

    // Scales with how many players are actually still alive right now —
    // a nearly-full room burns through tiles far faster than one down to
    // its last survivor, so a flat burst size can't be tuned right for
    // both at once. See roundConfig.js's AUTO_REGEN_BASE_BURST /
    // AUTO_REGEN_BURST_PER_ALIVE_PLAYER comment for the throughput math.
    const aliveCount = Object.values(this.players).filter((p) => !p.eliminated).length;
    const burstSize = AUTO_REGEN_BASE_BURST + AUTO_REGEN_BURST_PER_ALIVE_PLAYER * aliveCount;

    goneTiles.slice(0, burstSize).forEach(({ row, col }) => {
      this.tileMap[row][col] = TILE_STATE.SOLID;
      this.regenGraceUntil.set(`${row}_${col}`, Date.now() + REGEN_GRACE_MS);
      this.emit('tileRevived', { row, col });
    });
    return true;
  }

  checkRoundState() {
    if (this.finished) {
      return;
    }

    const elapsed = Date.now() - this.roundStartTime;
    const boundaryActive = elapsed >= BOUNDARY_SHRINK_GRACE_MS;

    // Not SURVIVAL-only: BOSS rounds have no shrinking boundary, so
    // this.safeInset stays 0 for their whole duration and getSafeZoneTiles()
    // naturally covers the entire board — the same threshold/burst logic
    // just applies map-wide instead of to a shrinking rectangle. BOSS mode
    // previously had no auto-regen at all (this check used to require
    // mode === 'SURVIVAL'), which meant the only tiles that ever came back
    // during a 3-minute boss fight were whatever eliminated teammates
    // manually clicked — with everyone still alive and actively chasing a
    // teleporting boss across a floor that collapses under every footstep,
    // the whole map could run out of standing ground with no safety net at
    // all until the first elimination created a ghost.
    if (elapsed - this.lastRegenAt >= AUTO_REGEN_MIN_INTERVAL_MS) {
      if (this.autoRegenerateTiles()) {
        this.lastRegenAt = elapsed;
      }
    }

    if (this.mode === 'SURVIVAL' && boundaryActive) {
      const stepsDue = Math.floor((elapsed - BOUNDARY_SHRINK_GRACE_MS) / BOUNDARY_SHRINK_INTERVAL_MS) + 1;
      if (stepsDue > this.boundaryShrinkStepsDone) {
        const isFirstStep = this.boundaryShrinkStepsDone === 0;
        this.boundaryShrinkStepsDone = stepsDue;

        this.shrinkBoundary();

        if (isFirstStep) {
          this.announceBoundaryShrink();
        } else {
          this.emit('boundaryPulse', { safeBounds: this.getSafeBounds() });
        }
      }
    }

    if (elapsed >= this.roundDurationMs) {
      this.finishRoom(this.mode === 'BOSS' ? 'timeout' : 'rescue');
    }
  }

  // Every member's own final standing — SOLO's only source of ranking data
  // (server.js's handleRoomFinished builds one finalRankings entry per
  // player straight from this), and harmless extra detail for TEAM, which
  // still ranks by the shared this.score/advancing list instead.
  getPlayerResults() {
    return Object.values(this.players).map((p) => ({
      socketId: p.playerId,
      nickname: p.nickname,
      animalIndex: p.animalIndex,
      score: p.score || 0,
      eliminated: p.eliminated,
    }));
  }

  finishRoom(reason) {
    if (this.finished) {
      return;
    }
    this.finished = true;

    // Cancel any still-pending trailing movement broadcasts (their handlers
    // already guard on this.finished, but clearing them releases the timers
    // immediately rather than up to MOVE_BROADCAST_MIN_INTERVAL_MS later).
    this.moveBroadcast.forEach((state) => {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
    });

    // Whoever wasn't already eliminated made it all the way to this moment —
    // credit them for the full time elapsed, same as an eliminated
    // teammate's addSurvivalScore() call got their own cutoff timestamp.
    if (this.mode === 'SURVIVAL') {
      const endTime = Date.now();
      Object.values(this.players).forEach((player) => {
        if (!player.eliminated) {
          this.addSurvivalScore(player, endTime);
        }
      });
    }

    let survivorIds;

    if (reason === 'all-eliminated') {
      survivorIds = [];
    } else if (this.mode === 'BOSS') {
      // Both a boss kill and a timeout let everyone still standing carry on.
      survivorIds = Object.keys(this.players).filter((id) => !this.players[id].eliminated);
    } else {
      survivorIds = Object.keys(this.players).filter((id) => {
        const player = this.players[id];
        if (player.eliminated) {
          return false;
        }
        const coords = this.getTileCoords(player.x, player.y);
        return this.isSafeTile(coords.row, coords.col);
      });
    }

    const totalHumans = Object.keys(this.players).length;

    const advancing = survivorIds.map((id) => ({
      socketId: id,
      nickname: this.players[id].nickname,
      animalIndex: this.players[id].animalIndex,
    }));

    // onFinished may end the whole tournament right here (this was the last
    // lineage standing). If so it hands back the final rankings, which we
    // fold into this same roomResult broadcast — bundling avoids a race
    // where a separate later 'tournamentEnded' event arrives before this
    // client has finished transitioning off GameScene to listen for it.
    const tournamentResult = this.onFinished(advancing, this.score, reason, this.getPlayerResults());

    this.emit('roomResult', {
      survivorIds,
      totalHumans,
      reason,
      score: this.score,
      rankings: (tournamentResult && tournamentResult.rankings) || null,
    });
  }

  handleDisconnect(socketId) {
    this.eliminatePlayer(socketId);
  }
}
