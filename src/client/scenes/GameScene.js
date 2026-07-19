import Phaser from 'phaser';

import { getSocket } from '../net/socket';
import { ensureAnimalTexture } from '../utilities/AnimalTextures';
import { generateTileTextures, generateBackgroundTexture, generateShieldLightBeamTexture } from '../utilities/EffectTextures';
import {
  playClick,
  playWarning,
  playCollapse,
  playRevive,
  playEliminate,
  playOtherEliminate,
  playBoundaryAlarm,
  playCountdownTick,
  playCountdownGo,
  playBombArm,
  playBombExplode,
} from '../utilities/SoundFx';
import { vibrateWarning, vibrateEliminate, vibrateVictory, vibrateTap, vibrateBombExplode } from '../utilities/Haptics';
import { MAP_COLS, MAP_ROWS, TILE_STATE } from '../../shared/mapConfig';
import {
  hexToPixel, pixelToHex, WORLD_WIDTH, WORLD_HEIGHT, HEX_WIDTH, HEX_HEIGHT, getTilesWithinHexRadius,
} from '../../shared/hexGrid';
import { FONT_DISPLAY, FONT_BODY, COLORS, TEXT_STROKE } from '../theme/Theme';
import {
  START_COUNTDOWN_MS, REGEN_GRACE_MS, SURVIVAL_SCORE_PER_SECOND, BOMB_FUSE_MS, SHIELD_GRACE_MS, SHIELD_RADIUS,
} from '../../shared/roundConfig';
import { fitAnchoredRoundedPanel, drawRoundedRect } from '../utilities/RoundedPanel';
import { applyButtonFx } from '../utilities/ButtonFx';

// The joystick lives as plain DOM elements pinned to the real viewport
// (position:fixed), not Phaser GameObjects -- see createJoystick()'s own
// comment for why. Sizes are real CSS pixels, not world units, and are
// deliberately larger than the old canvas-drawn version (42/18px radii),
// which read as too small to comfortably steer with a thumb.
const JOYSTICK_ZONE_WIDTH_VW = 55;
const JOYSTICK_ZONE_HEIGHT_VH = 55;
const JOYSTICK_BASE_DIAMETER_PX = 132;
const JOYSTICK_THUMB_DIAMETER_PX = 60;
const JOYSTICK_RADIUS_PX = 66;
const JOYSTICK_DEADZONE_PX = 10;
// norm (joystickVector's magnitude) is linear in how far the thumb has
// dragged from center, so even a small, easy-to-overshoot drag near the
// deadzone already produced a large fraction of max speed -- halving it
// here (applied only to joystick-driven movement, not the keyboard
// cursors update() also handles) makes a given drag distance translate to
// gentler, more controllable movement. Nudged back up ~20% (0.5 -> 0.6,
// "10 -> 12" per an operator request that full-deflection joystick movement
// on Android/iPhone felt a bit slow) -- still well short of the original
// unscaled 1.0, so the same "more controllable near the deadzone" intent
// this was introduced for still holds, just with a faster ceiling at full
// push.
const JOYSTICK_SENSITIVITY = 0.6;

// Mirrors Room.js's own MOVE_BROADCAST_MIN_INTERVAL_MS (50ms) -- the server
// only ever broadcasts this player's position to everyone else at that
// granularity, so a held direction key emitting 'playerMovement' on every
// single rendered frame (~60/sec uncapped) was pure wasted inbound socket
// traffic past whatever the server was already throttling its own
// broadcast to. See emitPlayerMovement().
const MOVEMENT_EMIT_MIN_INTERVAL_MS = 50;

// The generic mid-round announcement banner (round start, last stand, ...)
// was pinned at WORLD_HEIGHT/2 - 60. That's harmless on a tall canvas, but
// WORLD_HEIGHT is derived from MAP_COLS/MAP_ROWS (mapConfig.js), which have
// been re-tuned for gameplay-tile-size reasons down to as little as ~270px
// -- at that size WORLD_HEIGHT/2 - 60 lands close enough to the top HUD
// panels to visibly overlap them. A fixed offset from the top (like
// LoginScene/ResultScene/LobbyScene's own fixes for the same root cause)
// keeps the banner clear of them regardless of how short WORLD_HEIGHT gets,
// at the cost of no longer being truly centered on a much taller canvas.
//
// At that same ~270px WORLD_HEIGHT, the gap this sits in is only ~70px
// tall (top HUD panels' bottom edge down to the ghost hint panel's top
// edge at ~152, see BANNER_BACKDROP_HEIGHT_PADDING below) -- a 2-line
// banner (last stand, revive) at the original 24px padding needed ~86px
// and visibly overlapped the ghost hint panel underneath it. 117 is the
// vertical midpoint of that 70px gap, not an arbitrary number -- if
// BANNER_BACKDROP_HEIGHT_PADDING or the ghost hint panel's own position
// ever move, recheck this still centers between them.
const BANNER_Y = 117;
// Only the backdrop's *height* padding needs trimming to fit that gap --
// its width padding (see the drawRoundedRect call below) is unrelated to
// this collision and stays as it was.
const BANNER_BACKDROP_HEIGHT_PADDING = 10;

// Room.js's eliminatePlayer() emits 'playerEliminated' and, if this was the
// last player standing, calls finishRoom('all-eliminated') immediately
// after with zero delay between them -- so a room-ending elimination (own
// or, for a spectator watching, anyone else's) risks scene.start() tearing
// this scene down before the elimination effects below finish playing
// (showFloatingLabel's pop-in + float-and-fade is
// 180+600=780ms; this covers that plus the 300ms camera flash the own-
// elimination path also plays, with a little room to spare).
const OWN_ELIMINATION_EFFECT_MS = 900;

// A third instance of the same pattern: eliminatePlayer() can fire
// 'lastStandActivated' (active: true) and then finish the room in that
// same call too -- reachable whenever the elimination that drops
// aliveCount to exactly 1 *also* happens to empty out every human (that
// lone survivor is a bot). A still-connected ghost watching GameScene
// would otherwise see the "라스트 스탠드!" banner cut off practically
// before it appeared.
const LAST_STAND_BANNER_MS = 1000;

// Time constant (ms) for the exponential smoothing that eases each *other*
// player's avatar toward its latest server-reported position. Roughly: the
// avatar closes ~63% of the remaining gap every this-many-ms, so it fully
// catches up within ~3x this. Tuned to feel like the old 180ms glide while
// staying continuous — a bot that only steps once per its own randomized
// cadence (BOT_MOVE_INTERVAL_MIN_MS/MAX_MS in Room.js) keeps gliding smoothly
// between steps
// instead of the previous restart-a-fresh-tween-every-message hitch (which
// finished its 180ms tween then sat still until the next step re-triggered it).
const OTHER_PLAYER_LERP_TAU = 70;

// Default ghostHintText copy, shown while a ghost's cooldown is the normal
// GHOST_REVIVE_COOLDOWN_MS rate. Swapped out for the "라스트 스탠드" copy while
// that's active (see the lastStandActivated handler) and restored here once
// the server signals it's deactivated again.
const GHOST_HINT_DEFAULT_TEXT = '유령 모드 - 화면을 계속 터치하세요 (모두의 게이지가 차면 유령 1명 부활!)';

// Throttles both the golden tap effect and the server emit while a ghost
// keeps their finger down and drags across the screen (see
// handleGhostScreenTap()) -- comfortably below GHOST_REVIVE_LAST_STAND_COOLDOWN_MS
// (roundConfig.js, 400ms) so a last-stand ghost's faster server cooldown is
// never the bottleneck, while still nowhere near firing on every single
// pointermove pixel.
const GHOST_TAP_EFFECT_INTERVAL_MS = 150;

// The base tone of the temporary shimmering gold glow the protected hex
// area pulses through once a shield tile's actually stepped on (playShieldGlow())
// -- an armed-but-unstepped shield tile itself is marked with its own golden
// shield shape instead (createShieldTileMarker()), not a tile tint. Deep
// gold (not the board's own lighter bronze tile tint, nor the app's
// brighter textGold accent) so the shielded area still reads as distinct
// from ordinary ground while staying in the same warm palette as everything
// else -- purple was tried first and didn't fit that palette.
const SHIELD_COLOR = 0xd4af37;

export default class GameScene extends Phaser.Scene {

  constructor() {
    super({
      key: 'GameScene',
    });
  }

  preload() {

  }

  create(data) {
    generateTileTextures(this);
    generateBackgroundTexture(this, 'bg_gradient', WORLD_WIDTH, WORLD_HEIGHT);
    generateShieldLightBeamTexture(this, 'shield_light_beam');

    this.socket = getSocket();
    this.player = null;
    this.otherPlayers = {};
    this.tileSprites = {};
    this.localTileMap = null;
    this.cursors = this.input.keyboard.createCursorKeys();

    this.roomId = null;
    this.roundStartTime = null;
    // 개인전's live "내 점수" ticker (updateLiveScoreText) counts up from
    // these rather than raw elapsed-since-roundStartTime, so a revival
    // partway through the round doesn't make it jump to "as if alive the
    // whole time" — reset to the player's real score-so-far and Date.now()
    // on every revival (see handleOwnRevival).
    this.liveScoreBaseline = 0;
    this.liveScoreSince = null;
    this.roundDuration = null;
    this.eliminated = false;
    this.roomFinished = false;
    this.isSpectator = false;
    this.isAdmin = false;
    this.fromDashboard = false;
    this.mode = 'SURVIVAL';
    this.gameMode = 'TEAM';
    this.score = 0;
    this.bombTileMarkers = [];
    this.bombFuseMarkers = {};
    this.shieldTileMarkers = [];
    this.angelTileMarker = null;
    this.lastLiveScoreSecond = null;
    this.lastTimerSecond = null;
    this.lastRemainingSeconds = null;
    this.currentSafeBounds = null;
    this.countdownActive = false;
    this.lastGhostTapEffectAt = 0;
    this.wasInDanger = false;
    this.movementEmitLast = 0;
    this.movementEmitTimer = null;

    this.createBackground();
    this.createEffects();
    this.createHud();
    this.createJoystick();
    this.bindSocketEvents();

    // Ghost mode's entire input surface — see handleGhostScreenTap() for
    // why this is a scene-level listener (fires for every touch/drag
    // anywhere on screen) rather than a per-tile one. Registered
    // unconditionally; the handler itself gates on this.eliminated so it's
    // a no-op for anyone still alive. Phaser tears down and rebuilds a
    // fresh InputPlugin (and all its listeners) on every scene
    // create/shutdown cycle, so this never double-registers across the
    // stage-2+ re-entries into this same scene.
    this.input.on('pointerdown', (pointer) => this.handleGhostScreenTap(pointer));
    this.input.on('pointermove', (pointer) => {
      if (pointer.isDown) {
        this.handleGhostScreenTap(pointer);
      }
    });
    this.applySnapshot(data);
  }

  createBackground() {
    this.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'bg_gradient').setDepth(-30);
  }

  createEffects() {
    this.debrisEmitter = this.add.particles('particle_debris').setDepth(2).createEmitter({
      speed: { min: 60, max: 180 },
      angle: { min: 0, max: 360 },
      gravityY: 360,
      lifespan: { min: 350, max: 550 },
      scale: { start: 1.2, end: 0 },
      alpha: { start: 1, end: 0 },
      quantity: 0,
      on: false,
    });

    this.sparkEmitter = this.add.particles('particle_spark').setDepth(2).createEmitter({
      speed: { min: 30, max: 90 },
      angle: { min: 0, max: 360 },
      lifespan: { min: 300, max: 500 },
      scale: { start: 0.9, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: 0xfff2b0,
      quantity: 0,
      on: false,
    });

    this.hitEmitter = this.add.particles('particle_spark').setDepth(16).createEmitter({
      speed: { min: 80, max: 200 },
      angle: { min: 0, max: 360 },
      lifespan: { min: 250, max: 400 },
      scale: { start: 1, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: 0xff5555,
      quantity: 0,
      on: false,
    });

    // A heavier, wider burst than hitEmitter — for a multi-tile AoE moment
    // (e.g. a bomb tile's blast radius) that should read as bigger and more
    // menacing than an ordinary hit landing, not just the same spark burst
    // scaled up.
    this.shatterEmitter = this.add.particles('particle_debris').setDepth(16).createEmitter({
      speed: { min: 140, max: 340 },
      angle: { min: 0, max: 360 },
      lifespan: { min: 400, max: 650 },
      scale: { start: 1.4, end: 0.1 },
      alpha: { start: 1, end: 0 },
      gravityY: 260,
      tint: [0xff6633, 0xff2222, 0x8a1a0a],
      quantity: 0,
      on: false,
    });

    // One-shot golden burst at wherever a ghost's finger actually is (see
    // handleGhostScreenTap) — same shape as hitEmitter, just gold instead of
    // hitEmitter's red, so a ghost's own tap reads as a distinct kind of
    // impact rather than reusing the "something got hurt" color.
    this.ghostTapEmitter = this.add.particles('particle_spark').setDepth(20).createEmitter({
      speed: { min: 60, max: 160 },
      angle: { min: 0, max: 360 },
      lifespan: { min: 220, max: 380 },
      scale: { start: 1, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: 0xffd700,
      quantity: 0,
      on: false,
    });

    this.eliminationEmitter = this.add.particles('particle_spark').setDepth(6).createEmitter({
      speed: { min: 60, max: 160 },
      angle: { min: 0, max: 360 },
      lifespan: { min: 300, max: 500 },
      scale: { start: 1, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: 0x99ccff,
      quantity: 0,
      on: false,
    });

    this.add.particles('particle_spark').setDepth(-10).createEmitter({
      x: { min: 0, max: WORLD_WIDTH },
      y: WORLD_HEIGHT + 10,
      speedY: { min: -18, max: -8 },
      speedX: { min: -6, max: 6 },
      lifespan: { min: 6000, max: 9000 },
      scale: { start: 0.4, end: 0.1 },
      alpha: { start: 0.18, end: 0 },
      tint: 0x8899ff,
      frequency: 400,
      quantity: 1,
    });

    this.footstepEmitter = this.add.particles('particle_debris').setDepth(2).createEmitter({
      speed: { min: 5, max: 20 },
      angle: { min: 200, max: 340 },
      lifespan: { min: 200, max: 350 },
      scale: { start: 0.5, end: 0 },
      alpha: { start: 0.4, end: 0 },
      tint: 0xdadde8,
      quantity: 0,
      on: false,
    });
    this.lastFootstepAt = 0;
  }

  applySnapshot({
    roomId, players, tileMap, roundStartTime, roundDuration, mode, gameMode, score, isSpectator, fromDashboard, isAdmin, bombTiles, shieldTiles, angelTile,
  }) {
    this.roomId = roomId;
    this.gameMode = gameMode || 'TEAM';
    this.isSpectator = !!isSpectator;
    // Distinct from isSpectator now that a real player cut from the bracket
    // can also reach this scene as a spectator (see DashboardScene's own
    // isAdmin comment) -- backToDashboardNode's visibility below must gate
    // on this, not just "am I spectating."
    this.isAdmin = !!isAdmin;
    this.fromDashboard = !!fromDashboard;
    this.renderMap(tileMap);
    this.initBombTiles(bombTiles);
    this.initShieldTiles(shieldTiles);
    this.initAngelTile(angelTile);

    // A spectator's own socket id is never a key in `players` (the server
    // never seats an admin into a room — see startTournament/startStage in
    // server.js), so this loop naturally renders everyone else as
    // addOtherPlayer() and never calls addPlayer(): this.player stays
    // null, which already makes update()'s movement handling and the
    // joystick inert with no further guards needed.
    Object.keys(players).forEach((id) => {
      if (id === this.socket.id) {
        this.addPlayer(players[id]);
      } else {
        this.addOtherPlayer(players[id]);
      }
    });
    this.updatePlayerCount();

    if (this.isSpectator) {
      this.hideJoystick();
      // fromDashboard is already only ever true via adminSpectateRoom's
      // reply (admin-only, see DashboardScene's own spectateRoom() guard),
      // but the isAdmin check here is cheap defense in depth against that
      // ever changing quietly.
      this.backToDashboardNode.setVisible(this.fromDashboard && this.isAdmin);
    }

    this.roundStartTime = roundStartTime;
    this.liveScoreBaseline = 0;
    this.liveScoreSince = roundStartTime;
    this.roundDuration = roundDuration;
    this.mode = mode || 'SURVIVAL';

    // Every mode now scores teammates by survival time (see Room.js
    // addSurvivalScore), so the readout is visible from the start
    // regardless of mode. Skipped for a spectating admin -- "내 점수"/"팀
    // 점수" both read as if the viewer were a participant, which they never
    // are (see applySnapshot's own comment above on why a spectator's id
    // never ends up in `players`).
    this.scorePanel.setVisible(!this.isSpectator);
    this.scoreText.setVisible(!this.isSpectator);
    this.updateScoreText(score || 0);

    // Fades in from the same warm near-black the scene's own background
    // gradient/canvas backgroundColor settle on (EffectTextures.js /
    // client.js's #0d0805, in decimal RGB) rather than a mismatched color,
    // so the very first frame of a round doesn't visibly flash before
    // easing into place.
    this.cameras.main.fadeIn(400, 13, 8, 5);
    this.showStartCountdown(() => {
      // Both messages are player instructions ("버티세요", "물리치세요") --
      // meaningless to an admin who's only watching, so skip the banner
      // entirely for spectators rather than showing it to no functional end.
      if (this.isSpectator) {
        return;
      }
      if (this.mode === 'FINAL') {
        this.showBanner('최종 개인전!\n마지막까지 살아남으세요!', '#ffcc55');
      } else {
        this.showBanner('생존하라!\n타일이 무너지기 전에 버티세요', '#88ccff');
      }
    });
  }

  // A purely cosmetic 10-second countdown before each round (including
  // every later bracket stage, not just the very first) — gives players a
  // moment to get their bearings before movement is allowed. The server's
  // own timers (mass regen, bots, etc.) keep running underneath this the
  // whole time; only local input is held back via countdownActive.
  //
  // Derived from the server's own roundStartTime (already stored on this
  // scene by applySnapshot) rather than always starting a fresh local
  // "10, 9, 8..." the instant this scene finishes loading — a client that
  // took a couple seconds to get here (texture generation on first load,
  // DOM setup, plain network/scene-transition delay) would otherwise show
  // a full 10s count with no relation to how much of START_COUNTDOWN_MS
  // the server has already burned through, and the server's own bot/
  // movement gating (Room.js, purely server-clock-based) could unlock
  // well before this client's own countdown visually finished — exactly
  // what made bots look like they started moving only ~2s in.
  showStartCountdown(onDone) {
    this.countdownActive = true;
    this.setAvatarsFrozenTint(true);

    const countdownText = this.add.text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 20, '', {
      fontFamily: FONT_DISPLAY,
      fontSize: '72px',
      color: COLORS.textPrimary,
      stroke: TEXT_STROKE,
      strokeThickness: 8,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(35);

    const deadline = (this.roundStartTime || Date.now()) + START_COUNTDOWN_MS;

    const tick = () => {
      const remainingMs = deadline - Date.now();
      const count = Math.ceil(remainingMs / 1000);

      if (count <= 0) {
        countdownText.setText('시작!');
        countdownText.setColor('#55ff88');
        countdownText.setScale(0.6).setAlpha(1);
        playCountdownGo();
        this.tweens.add({
          targets: countdownText,
          scale: 1.4,
          alpha: 0,
          duration: 500,
          ease: 'Cubic.easeOut',
          onComplete: () => {
            countdownText.destroy();
            this.countdownActive = false;
            this.setAvatarsFrozenTint(false);
            if (onDone) {
              onDone();
            }
          },
        });
        return;
      }

      countdownText.setText(String(count));
      countdownText.setColor(count <= 3 ? '#ff5555' : '#ffffff');
      countdownText.setScale(1.6).setAlpha(1);
      playCountdownTick(count <= 3);
      this.tweens.add({
        targets: countdownText,
        scale: 1,
        duration: 350,
        ease: 'Back.easeOut',
      });

      // Re-aligns the next tick to the real next whole-second boundary
      // before the deadline, instead of a flat 1000ms step that would
      // otherwise compound this callback's own scheduling jitter over
      // 10 ticks — msIntoThisSecond is how far *into* the current
      // displayed second we already are.
      const msIntoThisSecond = remainingMs - (count - 1) * 1000;
      this.time.delayedCall(Math.max(50, msIntoThisSecond), tick);
    };

    tick();
  }

  // A visible confirmation that the countdown freeze is real and applies
  // to everyone (bots included), not just a local overlay blocking this
  // one client's input — every avatar gets an icy tint for the duration.
  setAvatarsFrozenTint(frozen) {
    const avatars = [this.player, ...Object.values(this.otherPlayers)].filter(Boolean);
    avatars.forEach((avatar) => {
      if (avatar.sprite) {
        if (frozen) {
          avatar.sprite.setTint(0x99ccff);
        } else {
          avatar.sprite.clearTint();
        }
      }
    });
  }

  createHud() {
    // Top-aligned with playerCountPanel/scorePanel (y=8) so the whole top
    // HUD row reads as one even strip — taller (30 vs 24) since the timer
    // text itself is bigger, but that's the only dimension that should differ.
    // A rounded Graphics panel now (matching every other panel in the app),
    // not a Rectangle — .setScrollFactor(0)/.setDepth(1) still apply the
    // same way, Graphics is a normal GameObject. See fitAnchoredRoundedPanel
    // for how (0.5, 0) below reproduces the old .setOrigin(0.5, 0) anchor.
    // Depth 29 (not the map/avatar range) so a player standing near the
    // top map edge — row 0 sits at screen y~21-42, squarely inside this
    // strip, since the camera never scrolls — never renders on top of it.
    this.timerPanel = this.add.graphics().setScrollFactor(0).setDepth(29);

    // HUD label strokes are deliberately thinner (proportionally) than the
    // display-tier titles/banners elsewhere -- a 3-4px stroke on this small
    // a font was a much heavier relative outline than the same stroke on a
    // 26-72px title (see BANNER_Y-area comment / showStartCountdown's own
    // 72px/8px pairing), reading as thick "clip art" edges on quick-glance
    // HUD text rather than the clean, modern look every other panel now has.
    this.timerText = this.add.text(WORLD_WIDTH / 2, 14, '', {
      fontFamily: FONT_BODY,
      fontSize: '20px',
      color: COLORS.textPrimary,
      stroke: TEXT_STROKE,
      strokeThickness: 3,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(30);

    this.playerCountPanel = this.add.graphics().setScrollFactor(0).setDepth(29);

    this.playerCountText = this.add.text(WORLD_WIDTH - 10, 12, '', {
      fontFamily: FONT_BODY,
      fontSize: '14px',
      color: COLORS.textPrimary,
      stroke: TEXT_STROKE,
      strokeThickness: 2,
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(30);

    this.bannerText = this.add.text(WORLD_WIDTH / 2, BANNER_Y, '', {
      fontFamily: FONT_DISPLAY,
      fontSize: '26px',
      color: COLORS.textPrimary,
      stroke: TEXT_STROKE,
      strokeThickness: 5,
      align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(30).setAlpha(0);

    this.scorePanel = this.add.graphics().setScrollFactor(0).setDepth(29).setVisible(false);

    this.scoreText = this.add.text(10, 12, '', {
      fontFamily: FONT_BODY,
      fontSize: '14px',
      color: COLORS.textGold,
      stroke: TEXT_STROKE,
      strokeThickness: 2,
    }).setOrigin(0, 0).setScrollFactor(0).setDepth(30).setVisible(false);

    // Only shown when the admin reached this room by clicking a card on
    // the multi-room dashboard (see applySnapshot's `fromDashboard` flag) —
    // the stage-3+ auto-spectate case has no dashboard to go back to, so
    // that path never sets fromDashboard and this stays hidden for it.
    // Anchored to a bottom-left corner rather than dead center — centered
    // sat right on top of the play area an admin is trying to actually
    // watch, which (along with a separate "관전 모드" badge that used to
    // live here too, since removed entirely as unnecessary clutter for an
    // admin who already knows they're spectating) blocked the view.
    const backButtonHtml = `
      <button id="back-to-dashboard-button" type="button"
        style="padding:6px 12px;font-size:12px;border-radius:7px;border:none;background:#1c130dcc;color:#ffd9a0;cursor:pointer;font-family:${FONT_BODY};border:1px solid #ffa94d88;">
        ← 현황판으로
      </button>
    `;
    this.backToDashboardNode = this.add.dom(90, WORLD_HEIGHT - 24).createFromHTML(backButtonHtml).setScrollFactor(0).setDepth(30).setVisible(false);
    this.backToDashboardButton = this.backToDashboardNode.getChildByID('back-to-dashboard-button');
    // Every other button in the app (login, lobby, result) gets this same
    // hover-lift/press feedback plus click sound+haptic via one shared
    // helper — this was the one DOM button in the whole game that never
    // called it, so it alone felt inert/unresponsive next to everything else.
    applyButtonFx(this.backToDashboardButton);
    this.backToDashboardButton.addEventListener('click', () => {
      // Just ask the server; the actual scene.start('DashboardScene') is left
      // to the 'dashboardStarting' entry in this.handlers, which already
      // listens for exactly this reply. A local socket.once here as well would
      // fire *in addition* to that handler on the same event (component-emitter
      // snapshots its listener list before dispatch, so once() removing itself
      // doesn't spare the already-queued handlers-map handler), double-starting
      // DashboardScene — it boots, then gets torn down and re-created mid-frame,
      // replaying its fade-in and dropping any dashboardUpdate that lands in the
      // gap.
      this.socket.emit('adminReturnToDashboard', { roomId: this.roomId });
    });

    this.ghostHintPanel = this.add.graphics().setScrollFactor(0).setDepth(29).setVisible(false);

    this.ghostHintText = this.add.text(WORLD_WIDTH / 2, WORLD_HEIGHT - 100, GHOST_HINT_DEFAULT_TEXT, {
      fontFamily: FONT_BODY,
      fontSize: '13px',
      color: COLORS.textInfo,
      stroke: TEXT_STROKE,
      strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(30).setVisible(false);

    // Fills as this ghost successfully taps collapsed tiles (see the
    // 'reviveGaugeUpdate' handler) — reaching the end respawns them back
    // into the round (Room.respawnGhost), so this doubles as visible
    // progress toward that instead of tapping feeling directionless.
    // Graphics (rounded, bordered), not a flat Rectangle -- every other
    // bar/panel in the app already gets the rounded-with-border treatment
    // (drawRoundedRect), and this was the one remaining flat-cornered,
    // borderless HUD element next to it.
    this.reviveGaugeX = WORLD_WIDTH / 2 - 80;
    this.reviveGaugeY = WORLD_HEIGHT - 70;
    this.reviveGaugeWidth = 160;
    this.reviveGaugeHeight = 8;
    this.reviveGaugeBarBg = this.add.graphics().setScrollFactor(0).setDepth(29).setVisible(false);
    drawRoundedRect(
      this.reviveGaugeBarBg,
      this.reviveGaugeX + this.reviveGaugeWidth / 2,
      this.reviveGaugeY,
      this.reviveGaugeWidth,
      this.reviveGaugeHeight + 2,
      {
        radius: 5, fillColor: 0x1a1108, fillAlpha: 0.85, strokeColor: 0x88ccff, strokeAlpha: 0.35, strokeWidth: 1,
      },
    );
    this.reviveGaugeBarFill = this.add.graphics().setScrollFactor(0).setDepth(30).setVisible(false);
    this.drawReviveGaugeFill(0);

    // A whole-screen blue-gray wash so ghost mode reads as "you're now
    // spectating," not just a slightly-faded version of normal play —
    // everything else on screen keeps its own colors, just seen through
    // this tint.
    this.ghostOverlay = this.add.rectangle(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT, 0x1a2a44, 0)
      .setScrollFactor(0)
      .setDepth(17);

    this.bannerBackdrop = this.add.graphics().setScrollFactor(0).setDepth(29).setVisible(false);

    this.boundaryOutline = this.add.graphics().setDepth(2).setVisible(false);
    this.boundaryOutlineRect = null;
    this.tweens.add({
      targets: this.boundaryOutline,
      alpha: 0.5,
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    const dimColor = 0x1a0000;
    this.dimTop = this.add.rectangle(0, 0, 0, 0, dimColor, 0.5).setOrigin(0, 0).setDepth(1.5).setVisible(false);
    this.dimBottom = this.add.rectangle(0, 0, 0, 0, dimColor, 0.5).setOrigin(0, 0).setDepth(1.5).setVisible(false);
    this.dimLeft = this.add.rectangle(0, 0, 0, 0, dimColor, 0.5).setOrigin(0, 0).setDepth(1.5).setVisible(false);
    this.dimRight = this.add.rectangle(0, 0, 0, 0, dimColor, 0.5).setOrigin(0, 0).setDepth(1.5).setVisible(false);

    // Embers drifting up off the burning boundary line itself, so it reads
    // as fire rather than just a static warning outline.
    this.boundaryEmberEmitter = this.add.particles('particle_spark').setDepth(2.2).createEmitter({
      speed: { min: 8, max: 26 },
      angle: { min: 250, max: 290 },
      lifespan: { min: 500, max: 950 },
      scale: { start: 0.7, end: 0 },
      alpha: { start: 0.9, end: 0 },
      tint: [0xff8844, 0xff5533, 0xffcc55],
      frequency: 40,
      quantity: 1,
      on: false,
    });

    // A personal alarm, distinct from the shared boundary outline: pulses
    // around the screen edge specifically when *this* player is currently
    // standing outside the safe area, so being in danger is unmissable
    // even if they're not looking at the boundary line itself.
    this.dangerVignette = this.add.rectangle(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH - 6, WORLD_HEIGHT - 6)
      .setStrokeStyle(8, 0xff2222, 0.85)
      .setScrollFactor(0)
      .setDepth(32)
      .setVisible(false);
    this.tweens.add({
      targets: this.dangerVignette,
      alpha: 0.35,
      duration: 350,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // A distinct amber pulse (vs. the red danger vignette above) for "the
    // clock is almost up" — a shared, whole-round urgency cue rather than
    // a personal safety warning, so the two never fight for the same
    // visual language.
    this.timeUrgencyVignette = this.add.rectangle(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH - 16, WORLD_HEIGHT - 16)
      .setStrokeStyle(6, 0xffaa00, 0.7)
      .setScrollFactor(0)
      .setDepth(31)
      .setVisible(false);
    this.tweens.add({
      targets: this.timeUrgencyVignette,
      alpha: 0.25,
      duration: 450,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  // Draws (and, on later calls, smoothly resizes) a glowing rectangle
  // showing the boundary's current safe area in world coordinates, so
  // players can see at a glance where's still safe instead of only
  // discovering it tile-by-tile as each one flashes a warning.
  updateBoundaryOutline(safeBounds) {
    if (!safeBounds) {
      return;
    }
    this.currentSafeBounds = safeBounds;

    // Approximate rather than pixel-exact: on a hex grid, a row/col range
    // isn't a perfect rectangle in pixel space (alternating columns are
    // vertically offset by up to half a hex-height) — close enough for a
    // cosmetic boundary outline, using the top-left and bottom-right cells'
    // centers padded out by half a hex on each side.
    const topLeft = hexToPixel(safeBounds.rowStart, safeBounds.colStart);
    const bottomRight = hexToPixel(safeBounds.rowEnd, safeBounds.colEnd);
    const target = {
      x: topLeft.x - HEX_WIDTH / 2,
      y: topLeft.y - HEX_HEIGHT / 2,
      width: (bottomRight.x - topLeft.x) + HEX_WIDTH,
      height: (bottomRight.y - topLeft.y) + HEX_HEIGHT,
    };

    this.boundaryOutline.setVisible(true);
    this.dimTop.setVisible(true);
    this.dimBottom.setVisible(true);
    this.dimLeft.setVisible(true);
    this.dimRight.setVisible(true);
    this.boundaryEmberEmitter.on = true;

    if (!this.boundaryOutlineRect) {
      this.boundaryOutlineRect = target;
      this.redrawBoundaryOutline();
      return;
    }

    this.tweens.killTweensOf(this.boundaryOutlineRect);
    this.tweens.add({
      targets: this.boundaryOutlineRect,
      ...target,
      duration: 900,
      ease: 'Sine.easeInOut',
      onUpdate: () => this.redrawBoundaryOutline(),
    });
  }

  redrawBoundaryOutline() {
    const r = this.boundaryOutlineRect;
    this.boundaryOutline.clear();
    this.boundaryOutline.lineStyle(3, 0xff5555, 0.9);
    this.boundaryOutline.strokeRect(r.x, r.y, r.width, r.height);

    this.dimTop.setPosition(0, 0).setSize(WORLD_WIDTH, r.y);
    this.dimBottom.setPosition(0, r.y + r.height).setSize(WORLD_WIDTH, WORLD_HEIGHT - r.y - r.height);
    this.dimLeft.setPosition(0, r.y).setSize(r.x, r.height);
    this.dimRight.setPosition(r.x + r.width, r.y).setSize(WORLD_WIDTH - r.x - r.width, r.height);

    this.boundaryEmberEmitter.setEmitZone({
      type: 'edge',
      source: new Phaser.Geom.Rectangle(r.x, r.y, r.width, r.height),
      quantity: 64,
    });
  }

  // A quick expanding-ring shockwave at (x, y) — used by a ghost's own tap
  // effect (see handleGhostScreenTap) so a landed hit reads as a real
  // impact instead of just a particle puff with no sense of force
  // radiating outward.
  spawnImpactRing(x, y, { color = 0xff5555, startRadius = 10, endScale = 4, duration = 350, strokeWidth = 4 } = {}) {
    const ring = this.add.circle(x, y, startRadius, 0x000000, 0)
      .setStrokeStyle(strokeWidth, color, 0.9)
      .setDepth(17);
    this.tweens.add({
      targets: ring,
      scale: endScale,
      alpha: 0,
      duration,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  // Rebuilds every armed-but-not-yet-stepped-on bomb tile's marker from
  // scratch on each bombTiles snapshot -- mirrors the removed boss mode's
  // own attack-tile marker lifecycle (clear-then-recreate), which is simple
  // and cheap enough at this scale (a handful of tiles) rather than diffing.
  initBombTiles(bombTiles) {
    (this.bombTileMarkers || []).forEach((marker) => marker.destroy());
    this.bombTileMarkers = [];
    (bombTiles || []).forEach((tile) => {
      this.bombTileMarkers.push(this.createBombTileMarker(tile));
    });
  }

  createBombTileMarker(tile) {
    const { x, y } = hexToPixel(tile.row, tile.col);
    const marker = this.add.text(x, y, '💣', {
      fontSize: '22px',
    }).setOrigin(0.5).setDepth(12);

    this.tweens.add({
      targets: marker,
      scale: 1.18,
      duration: 480,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    return marker;
  }

  // Rebuilds every armed-but-not-yet-stepped-on shield tile's marker from
  // scratch on each shieldTiles snapshot -- same clear-then-recreate
  // lifecycle as initBombTiles().
  initShieldTiles(shieldTiles) {
    (this.shieldTileMarkers || []).forEach((marker) => marker.destroy());
    this.shieldTileMarkers = [];
    (shieldTiles || []).forEach((tile) => {
      this.shieldTileMarkers.push(this.createShieldTileMarker(tile));
    });
  }

  // Drawn as a real shield silhouette (bronze-gold body + a smaller gold
  // rim for a raised/embossed look) rather than the 🛡️ emoji -- an emoji
  // glyph's own colors are fixed and mostly blue/steel on every platform's
  // emoji font, so it can't actually be made to read as "golden" the way
  // this shape can. A first version used dead-straight edges (a plain
  // pentagon); real heraldic shield icons almost always curve the top and
  // both sides instead, which is what curvedOutlinePoints()'s sampled
  // quadratic segments give here -- a gently domed top and sides that
  // bulge slightly before tapering to the bottom point, rather than flat
  // panel edges.
  createShieldTileMarker(tile) {
    const { x, y } = hexToPixel(tile.row, tile.col);
    const marker = this.add.graphics({ x, y }).setDepth(12);

    const outer = this.curvedOutlinePoints(-9, -9, [
      [9, -9, 0, -13],
      [9, 2, 12, -4],
      [0, 13, 10, 9],
      [-9, 2, -10, 9],
      [-9, -9, -12, -4],
    ]);
    // A rim, not a small inset badge -- scaled down just enough (0.74) to
    // read as the shield's own gold face inside a bronze border, rather
    // than a separate little panel floating in the middle of it.
    const inner = outer.map((p) => ({ x: p.x * 0.74, y: p.y * 0.74 - 1 }));

    // Same offset-dark-silhouette drop shadow every panel in the app already
    // uses (see RoundedPanel.js's drawRoundedRect) -- gives the shield a
    // lifted, "sitting on the tile" feel instead of a flat sticker.
    const shadow = outer.map((p) => ({ x: p.x + 1.5, y: p.y + 2 }));
    marker.fillStyle(0x000000, 0.3);
    marker.fillPoints(shadow, true);

    marker.fillStyle(0x8a6a10, 1);
    marker.fillPoints(outer, true);
    marker.lineStyle(1.5, 0xfff2b0, 0.9);
    marker.strokePoints(outer, true);
    marker.fillStyle(0xffd700, 1);
    marker.fillPoints(inner, true);

    // A thin raised center ridge, like a real shield's embossed spine,
    // plus a small round boss where the ridge meets its own highlight --
    // classic heraldic shield icons almost always carry one of these two
    // details, rather than a flat gold face with nothing on it.
    marker.lineStyle(1.2, 0xfff6c8, 0.8);
    marker.lineBetween(0, -6, 0, 8);
    marker.fillStyle(0xfff6c8, 0.7);
    marker.fillCircle(0, -3, 2.2);
    marker.fillStyle(0x8a6a10, 1);
    marker.fillCircle(0, -3, 1.1);

    this.tweens.add({
      targets: marker,
      scale: 1.18,
      duration: 480,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    return marker;
  }

  // Shimmering gold pulse across the hex area a shield tile just protected
  // (see Room.armShieldTile()) -- reuses the same tile.graceTintTween/
  // stopTileTween() interplay playReviveGraceGlow() already established,
  // just without that one's alpha-from-zero fade-in (these tiles are
  // already fully visible, nothing to materialize in) and cycling between
  // three gold-family tones instead of a single one-way fade, for an
  // "aurora" flicker rather than a flat color wash. Paired with an
  // immediate spark burst and a couple of smaller follow-ups so the tile
  // keeps twinkling rather than only flashing once. Purely cosmetic -- the
  // real protection is the server's regenGraceUntil window; the tween
  // duration only needs to roughly track SHIELD_GRACE_MS so the glow fades
  // out around when the protection actually lapses.
  playShieldGlow(tile, isCenter = false) {
    // A pillar of light shooting straight up out of the ground -- makes
    // the activation read as a genuine magic effect (grounded, radiant)
    // rather than just a particle burst with no sense of *where* the power
    // is coming from. The stepped-on tile (isCenter) gets a noticeably
    // taller/brighter beam than its 6 neighbors, so the whole 7-tile
    // activation composes as one hero pillar with shorter supporting ones
    // around it instead of 7 identical flashes.
    this.createLightBeam(tile.baseX, tile.baseY, isCenter ? 1.6 : 1);
    if (isCenter) {
      // A second, slightly delayed beam right on top of the first widens
      // the base and lingers a touch longer -- reads as the light
      // "swelling" rather than a single flat pulse, reserved for the
      // center tile so it doesn't compete with the supporting ones.
      this.time.delayedCall(120, () => this.createLightBeam(tile.baseX, tile.baseY, 1.3));
    }

    // Bigger, more frequent bursts than before (was 8/4/4 at 3 fixed
    // points) -- spread across the now-longer SHIELD_GRACE_MS window so a
    // longer-lasting shield still reads as continuously twinkling rather
    // than front-loaded and quiet for the second half.
    const burstSchedule = [
      [0, 14], [0.25, 7], [0.5, 10], [0.75, 7], [0.92, 12],
    ];
    burstSchedule.forEach(([atFraction, quantity]) => {
      this.time.delayedCall(SHIELD_GRACE_MS * atFraction, () => {
        this.sparkEmitter.setTint(SHIELD_COLOR);
        this.sparkEmitter.explode(quantity, tile.baseX, tile.baseY);
      });
    });

    const auroraTones = [
      Phaser.Display.Color.ValueToColor(SHIELD_COLOR),
      Phaser.Display.Color.ValueToColor(0xfff6c8),
      Phaser.Display.Color.ValueToColor(0xd8ffb0),
    ];
    tile.setTint(SHIELD_COLOR);

    tile.graceTintTween = this.tweens.addCounter({
      from: 0,
      to: 100,
      duration: SHIELD_GRACE_MS,
      ease: 'Linear',
      onUpdate: (tween) => {
        // Cycles through the 3 tones 3 times across the whole window (6
        // half-segments, up from the original 4/twice) -- SHIELD_GRACE_MS
        // grew from 3s to 5s, and without more segments the same two full
        // cycles would just stretch out slower instead of keeping the
        // lively "twinkle" pace. onComplete below settles it back to
        // neutral once the window ends.
        const cyclePos = (tween.getValue() / 100) * 6;
        const segment = Math.floor(cyclePos) % auroraTones.length;
        const t = cyclePos - Math.floor(cyclePos);
        const from = auroraTones[segment];
        const to = auroraTones[(segment + 1) % auroraTones.length];
        const step = Phaser.Display.Color.Interpolate.ColorWithColor(from, to, 100, t * 100);
        tile.setTint(Phaser.Display.Color.GetColor(step.r, step.g, step.b));
      },
      onComplete: () => {
        tile.clearTint();
        tile.graceTintTween = null;
      },
    });
  }

  // A single shared texture (generateShieldLightBeamTexture, drawn once
  // with a real canvas gradient rather than a flat tint) anchored at its
  // own bottom-center and scaled per call, so one beam can stand taller
  // than another without needing a separate texture for every size. Starts
  // short and dim, shoots upward while widening slightly, then fades --
  // additive blending so overlapping beams (the 7-tile shield burst) pile
  // up into a brighter glow instead of just stacking flat sprites.
  createLightBeam(x, y, scale = 1) {
    const beam = this.add.image(x, y, 'shield_light_beam')
      .setOrigin(0.5, 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(11)
      .setScale(scale * 0.8, scale * 0.35)
      .setAlpha(0.9);

    this.tweens.add({
      targets: beam,
      scaleY: scale * 1.15,
      scaleX: scale * 0.95,
      alpha: 0,
      duration: 650,
      ease: 'Cubic.easeOut',
      onComplete: () => beam.destroy(),
    });
  }

  // Mirrors initBombTiles()'s clear-then-recreate lifecycle for the single
  // angel tile -- there's ever at most one on the map at a time (see
  // Room.maintainAngelTile()), so this is just a destroy-if-present /
  // create-if-given pair rather than a full array rebuild.
  initAngelTile(angelTile) {
    if (this.angelTileMarker) {
      this.angelTileMarker.destroy();
      this.angelTileMarker = null;
    }
    if (angelTile) {
      this.angelTileMarker = this.createAngelTileMarker(angelTile);
    }
  }

  // One feathered wing -- a real drawn shape reads far better at this size
  // than any stock emoji glyph, whose fixed art/colors can't be tuned to
  // match the rest of the game's warm, hand-drawn look. createAngelTileMarker()
  // draws two of these facing the same way rather than mirroring one, so
  // this has no orientation parameter of its own.
  // Phaser's Graphics GameObject has no quadraticCurveTo() the way a native
  // Canvas 2D context does (this crashed every time an angel tile spawned or
  // was already on the board when a spectator's snapshot arrived -- "i.
  // quadraticCurveTo is not a function" -- since createWingGraphic() called
  // it unconditionally). Phaser.Curves.Path *does* support quadratic curves
  // (quadraticBezierTo, though its argument order is destination-then-
  // control, the reverse of Canvas 2D's control-then-destination), so this
  // samples the same curve shape into a plain point list and feeds that to
  // fillPoints()/strokePoints() -- the same approach createShieldTileMarker()
  // already uses for its own straight-edged shape, just with curved segments
  // sampled into points first.
  curvedOutlinePoints(startX, startY, segments) {
    const path = new Phaser.Curves.Path(startX, startY);
    segments.forEach(([endX, endY, controlX, controlY]) => {
      path.quadraticBezierTo(endX, endY, controlX, controlY);
    });
    return path.getPoints(32);
  }

  // A single smooth closed outline (the first version of this shape) read
  // as a fish fin, not a wing -- a fin's whole silhouette is one plain
  // curve with no texture at all, which is exactly what that outline was.
  // A real wing's tell is its trailing edge broken up into individual
  // feathers, so this instead lays a row of overlapping round feather
  // lobes -- shrinking from the body out to the tip -- along the underside
  // of a smooth leading-edge spine, and strokes that spine on top for a
  // clean upper border. The lobes' own overlap is what keeps the row
  // reading as one continuous scalloped edge instead of a string of
  // separate dots.
  createWingGraphic() {
    const g = this.add.graphics({ x: 0, y: 0 });
    const spine = this.curvedOutlinePoints(0, 2, [[19, -15, 9, -13]]);

    // Same offset-dark-silhouette drop shadow every other panel/marker in
    // the app already uses (see RoundedPanel.js's drawRoundedRect), applied
    // to the same lobe row below it.
    for (let i = spine.length - 1; i >= 0; i -= 3) {
      const t = i / (spine.length - 1);
      const { x, y } = spine[i];
      const radius = 3 + (1 - t) * 4.5;
      g.fillStyle(0x000000, 0.22);
      g.fillCircle(x + radius * 0.4 + 1, y + radius * 0.4 + 1.5, radius);
    }

    for (let i = spine.length - 1; i >= 0; i -= 3) {
      const t = i / (spine.length - 1);
      const { x, y } = spine[i];
      const radius = 3 + (1 - t) * 4.5;
      const lobeX = x + radius * 0.4;
      const lobeY = y + radius * 0.4;
      g.fillStyle(0xfff6e8, 1);
      g.fillCircle(lobeX, lobeY, radius);
      g.lineStyle(1, 0xd9b466, 0.85);
      g.strokeCircle(lobeX, lobeY, radius);
    }

    g.lineStyle(1.5, 0xd9b466, 0.9);
    g.strokePoints(spine, false);

    return g;
  }

  // A pair of wings facing the same direction, layered with a small offset,
  // rather than mirrored into a left/right spread -- reads as one dynamic
  // wing emblem (like a badge/insignia) instead of a symmetric angel-wing
  // silhouette. The back copy sits behind and slightly down-left, dimmer and
  // a touch smaller, so it reads as depth behind the front wing rather than
  // a second, equally prominent wing competing with it.
  createAngelTileMarker(tile) {
    const { x, y } = hexToPixel(tile.row, tile.col);
    const backWing = this.createWingGraphic();
    backWing.setPosition(-3, 3);
    backWing.setScale(0.82);
    backWing.setAlpha(0.5);
    const frontWing = this.createWingGraphic();
    const marker = this.add.container(x, y, [backWing, frontWing]).setDepth(12);

    this.tweens.add({
      targets: marker,
      y: y - 6,
      scale: 1.12,
      duration: 520,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    return marker;
  }

  showFloatingDamage(x, y, amount) {
    const text = this.add.text(x, y - 10, `-${amount}`, {
      fontFamily: FONT_BODY,
      fontSize: '16px',
      color: '#ffdd55',
      stroke: TEXT_STROKE,
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(25);

    this.tweens.add({
      targets: text,
      y: y - 40,
      alpha: 0,
      duration: 700,
      ease: 'Cubic.easeOut',
      onComplete: () => text.destroy(),
    });
  }

  showFloatingLabel(x, y, message, color) {
    const text = this.add.text(x, y - 20, message, {
      fontFamily: FONT_BODY,
      fontSize: '15px',
      color,
      stroke: TEXT_STROKE,
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(25).setScale(0.6).setAlpha(0);

    this.tweens.add({
      targets: text,
      scale: 1.1,
      alpha: 1,
      duration: 180,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: text,
          y: y - 50,
          alpha: 0,
          duration: 600,
          delay: 250,
          ease: 'Cubic.easeOut',
          onComplete: () => text.destroy(),
        });
      },
    });
  }

  updateScoreText(score) {
    const changed = score !== this.score;
    this.score = score;
    const label = this.gameMode === 'SOLO' ? '내 점수' : '팀 점수';
    this.scoreText.setText(`${label} ${score}`);
    fitAnchoredRoundedPanel(this.scorePanel, 6, 8, 0, 0, 24, this.scoreText, 20);

    if (changed) {
      this.tweens.killTweensOf(this.scoreText);
      this.scoreText.setScale(1);
      this.tweens.add({
        targets: this.scoreText,
        scale: 1.25,
        duration: 140,
        yoyo: true,
        ease: 'Quad.easeOut',
      });
    }
  }

  // A small "+N" popup next to the score HUD, distinct from
  // showFloatingDamage/showFloatingLabel because those are placed in world
  // space (they follow a tile or avatar); the score readout is a fixed HUD
  // element (scrollFactor 0), so the popup needs to live in that same space.
  showScoreGainPopup(amount) {
    // The score panel itself is hidden for a spectator (see applySnapshot)
    // -- without this guard a TEAM-mode elimination would still
    // pop a "+N" next to where that now-invisible panel would have been,
    // reading as a stray floating number with nothing anchoring it.
    if (!(amount > 0) || this.isSpectator) {
      return;
    }
    const text = this.add.text(this.scoreText.x + this.scoreText.width + 12, this.scoreText.y + 6, `+${amount}`, {
      fontFamily: FONT_BODY,
      fontSize: '13px',
      color: '#88ff99',
      stroke: TEXT_STROKE,
      strokeThickness: 2,
    }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(31).setAlpha(0);

    this.tweens.add({
      targets: text,
      y: text.y - 16,
      alpha: 1,
      duration: 180,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: text,
          y: text.y - 14,
          alpha: 0,
          delay: 300,
          duration: 450,
          onComplete: () => text.destroy(),
        });
      },
    });
  }

  // Plain DOM elements appended straight to document.body -- deliberately
  // NOT Phaser GameObjects and NOT this.add.dom() (which Phaser transforms
  // in lockstep with the scaled canvas, i.e. the same world-coordinate
  // space a GameObject lives in). Phaser.Scale.FIT centers the canvas and
  // can letterbox/pillarbox it on any device whose aspect ratio doesn't
  // exactly match WORLD_WIDTH/HEIGHT, so a joystick anchored to a fixed
  // *world* position could end up visually inset from the real screen edge
  // by however wide that margin happens to be on a given device --
  // position:fixed CSS against the real viewport sidesteps that outright.
  // It's also dynamic rather than fixed to one exact spot: touching
  // anywhere inside the bottom-left zone re-anchors the base right where
  // the thumb landed, rather than only working if the touch happens to
  // land exactly on one pre-drawn circle -- both closer to how a real
  // mobile game's virtual joystick behaves, and easier to hit reliably one-
  // handed than a small fixed target.
  createJoystick() {
    this.joystickVector = { x: 0, y: 0 };
    this.joystickPointerId = null;
    this.joystickEnabled = true;

    const zone = document.createElement('div');
    zone.style.cssText = `position:fixed;left:0;bottom:0;width:${JOYSTICK_ZONE_WIDTH_VW}vw;height:${JOYSTICK_ZONE_HEIGHT_VH}vh;touch-action:none;z-index:500;`;
    document.body.appendChild(zone);

    const glow = document.createElement('div');
    glow.style.cssText = `position:fixed;width:${JOYSTICK_BASE_DIAMETER_PX + 12}px;height:${JOYSTICK_BASE_DIAMETER_PX + 12}px;border-radius:50%;background:rgba(255,170,68,0.12);transform:translate(-50%,-50%);pointer-events:none;z-index:500;display:none;transition:opacity 120ms;`;
    document.body.appendChild(glow);

    const base = document.createElement('div');
    base.style.cssText = `position:fixed;width:${JOYSTICK_BASE_DIAMETER_PX}px;height:${JOYSTICK_BASE_DIAMETER_PX}px;border-radius:50%;background:rgba(255,170,68,0.15);border:3px solid rgba(255,204,102,0.5);transform:translate(-50%,-50%);pointer-events:none;z-index:501;display:none;`;
    document.body.appendChild(base);

    const thumb = document.createElement('div');
    thumb.style.cssText = `position:fixed;width:${JOYSTICK_THUMB_DIAMETER_PX}px;height:${JOYSTICK_THUMB_DIAMETER_PX}px;border-radius:50%;background:rgba(255,204,102,0.4);transform:translate(-50%,-50%);pointer-events:none;z-index:502;display:none;`;
    document.body.appendChild(thumb);

    this.joystickZoneEl = zone;
    this.joystickGlowEl = glow;
    this.joystickBaseEl = base;
    this.joystickThumbEl = thumb;

    let anchorX = 0;
    let anchorY = 0;

    const setPos = (el, x, y) => {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    };

    const updateFromPoint = (x, y) => {
      const dx = x - anchorX;
      const dy = y - anchorY;
      const dist = Math.min(JOYSTICK_RADIUS_PX, Math.hypot(dx, dy));
      const angle = Math.atan2(dy, dx);
      setPos(thumb, anchorX + Math.cos(angle) * dist, anchorY + Math.sin(angle) * dist);

      if (dist < JOYSTICK_DEADZONE_PX) {
        this.joystickVector = { x: 0, y: 0 };
        return;
      }
      const norm = dist / JOYSTICK_RADIUS_PX;
      this.joystickVector = { x: Math.cos(angle) * norm, y: Math.sin(angle) * norm };
    };

    const onPointerDown = (e) => {
      if (!this.joystickEnabled || this.joystickPointerId !== null) {
        return;
      }
      this.joystickPointerId = e.pointerId;
      anchorX = e.clientX;
      anchorY = e.clientY;
      setPos(glow, anchorX, anchorY);
      setPos(base, anchorX, anchorY);
      setPos(thumb, anchorX, anchorY);
      glow.style.display = 'block';
      base.style.display = 'block';
      thumb.style.display = 'block';
      thumb.style.background = 'rgba(255,204,102,0.65)';
    };

    const onPointerMove = (e) => {
      if (e.pointerId !== this.joystickPointerId) {
        return;
      }
      updateFromPoint(e.clientX, e.clientY);
    };

    const onPointerUp = (e) => {
      if (e.pointerId !== this.joystickPointerId) {
        return;
      }
      this.joystickPointerId = null;
      this.joystickVector = { x: 0, y: 0 };
      glow.style.display = 'none';
      base.style.display = 'none';
      thumb.style.display = 'none';
      thumb.style.background = 'rgba(255,204,102,0.4)';
    };

    zone.addEventListener('pointerdown', onPointerDown);
    // move/up are on window rather than the zone -- a real thumb routinely
    // drags outside the zone's own bounds once it's mid-drag (the whole
    // point of a large drag radius), and only the zone's own bounds would
    // otherwise stop delivering pointermove the instant the touch crosses
    // that boundary, silently freezing the vector at whatever it last was.
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    // Torn down from the scene's own 'shutdown' handler (see create()) --
    // these are raw window-level listeners outside Phaser's own event
    // system, so nothing else would ever remove them, and a stage
    // transition/spectator hand-off re-runs create() (and this method)
    // fresh each time without a page reload in between.
    this.joystickCleanup = () => {
      zone.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      zone.remove();
      glow.remove();
      base.remove();
      thumb.remove();
    };
  }

  // A spectator has no avatar to steer, so the joystick would just sit
  // there doing nothing — hide/disable it rather than leave a dead control
  // (and a dead-but-still-touch-intercepting zone) on screen. Disabling the
  // zone specifically matters for a ghost, whose only real interaction is
  // tapping collapsed tiles to revive — the zone would otherwise silently
  // swallow taps meant for the board underneath it.
  hideJoystick() {
    this.joystickEnabled = false;
    this.joystickZoneEl.style.pointerEvents = 'none';
    this.joystickGlowEl.style.display = 'none';
    this.joystickBaseEl.style.display = 'none';
    this.joystickThumbEl.style.display = 'none';
  }

  bindSocketEvents() {
    this.handlers = {
      tileWarning: ({ row, col }) => {
        this.setTileState(row, col, TILE_STATE.WARNING);
        playWarning();
      },

      tileCollapsed: ({ row, col }) => {
        this.setTileState(row, col, TILE_STATE.GONE);
        playCollapse();
      },

      tileRevived: ({ row, col, causedBy }) => {
        // Auto-regen bursts (and other players'/bots' taps) also fire this
        // same event with no causedBy of their own — Room.reviveTile() only
        // sets it for a real ghost tap, so this is the only case that gets
        // the deliberate-action payoff below rather than looking identical
        // to an unrelated ambient regen elsewhere on the board.
        if (causedBy === this.socket.id) {
          const { x: reviveX, y: reviveY } = hexToPixel(row, col);
          this.showFloatingLabel(reviveX, reviveY, '복구!', '#88ccff');
          vibrateTap();
        }
        this.setTileState(row, col, TILE_STATE.SOLID);
        playRevive();
      },

      // Room-wide: the revival gauge is a shared team meter now (see
      // Room.reviveTile / respawnRandomGhost), so every client — alive
      // players included — watches the same bar fill. Shown whenever it
      // has any progress and hidden again once a payout resets it to 0
      // (ghosts keep it visible regardless; see handleOwnElimination).
      reviveGaugeUpdate: ({ gauge, max }) => {
        this.updateReviveGauge(gauge, max);
        const show = gauge > 0 || this.eliminated;
        this.reviveGaugeBarBg.setVisible(show);
        this.reviveGaugeBarFill.setVisible(show);
      },

      // Room-wide: everyone hears the moment only one lineage member is
      // still standing, since it changes what ghosts should do (tap
      // freely, faster cooldown) and explains to the survivor why the map
      // is suddenly filling back in around them. Room.js now only fires
      // this on the real false->true/true->false transition (a ghost
      // respawning via the gauge and dying again no longer re-triggers it),
      // and sends an { active: false } deactivation once a respawn brings
      // the alive-count back above 1 — handled here by reverting the ghost
      // hint text back to its normal (non-last-stand) copy rather than
      // leaving it claiming the fast cooldown is still active.
      lastStandActivated: ({ active } = {}) => {
        if (active === false) {
          // Reset unconditionally, not just while currently a ghost: when
          // this deactivation is triggered by *this* client's own respawn,
          // 'playerRevived' (which flips this.eliminated to false) is
          // always processed first, so an `if (this.eliminated)` guard here
          // would skip the reset and leave stale "last stand" copy sitting
          // in the text object for this player's *next* elimination.
          // setText on a currently-hidden object is harmless either way.
          this.ghostHintText.setText(GHOST_HINT_DEFAULT_TEXT);
          fitAnchoredRoundedPanel(this.ghostHintPanel, WORLD_WIDTH / 2, WORLD_HEIGHT - 106, 0.5, 0, 24, this.ghostHintText, 24);
          return;
        }
        this.showBanner('⚡ 라스트 스탠드!\n유령들이 훨씬 빠르게 타일을 복구합니다', '#ffd700');
        this.roomTransitionHoldUntil = this.time.now + LAST_STAND_BANNER_MS;
        if (this.eliminated) {
          this.ghostHintText.setText('지금 미친듯이 화면을 터치하세요! 게이지 채워 동료를 부활시키세요!');
          fitAnchoredRoundedPanel(this.ghostHintPanel, WORLD_WIDTH / 2, WORLD_HEIGHT - 106, 0.5, 0, 24, this.ghostHintText, 24);
        }
      },

      playerRevived: ({ playerId, nickname, score, x, y }) => {
        // The team gauge filling is the only way anyone comes back (see
        // Room.respawnRandomGhost, respawnGhost's sole caller), so this
        // moment doubles as the "gauge full" announcement for the room.
        this.showBanner(`💫 부활 게이지 가득!\n${nickname || '유령'} 부활!`, '#88ff99');
        if (playerId === this.socket.id) {
          this.handleOwnRevival(x, y, score);
          return;
        }
        const avatar = this.otherPlayers[playerId];
        if (avatar) {
          avatar.targetX = x;
          avatar.targetY = y;
          avatar.setPosition(x, y);
          this.showFloatingLabel(x, y, '부활!', '#88ff99');
          this.tweens.add({ targets: avatar, alpha: 1, scale: 1, duration: 300, ease: 'Back.easeOut' });
        }
        this.updatePlayerCount();
      },

      massCollapseStarted: ({ safeBounds }) => {
        this.cameras.main.shake(400, 0.008);
        this.cameras.main.flash(250, 255, 60, 60);
        this.showBanner('경계가 불타오릅니다!\n중앙으로 대피하세요!', '#ff5555');
        this.updateBoundaryOutline(safeBounds);
        playBoundaryAlarm();
        vibrateWarning();
      },

      // Fired on every later boundary ring after the first (which already
      // got the full banner/flash treatment above) — a lighter shake so
      // each step still reads as an event without repeating the same
      // attention-grabbing flash/banner every 15s.
      boundaryPulse: ({ safeBounds }) => {
        this.cameras.main.shake(200, 0.004);
        this.updateBoundaryOutline(safeBounds);
        playBoundaryAlarm();
      },

      // Room.armBombTile() sends this both when a bomb is stepped on (its
      // spot leaves this.bombTiles) and again right after with a fresh
      // replacement spot already appended -- always just a full re-render
      // rather than trying to diff which single tile changed.
      bombTilesUpdate: ({ bombTiles }) => {
        this.initBombTiles(bombTiles);
      },

      // The tile that was just armed already left the bombTiles list (see
      // bombTilesUpdate above), so its calm pulsing 💣 marker is already
      // gone by the time this fires -- this instead plants an urgent
      // fuse-countdown marker right on top of it for the BOMB_FUSE_MS
      // window until bombExploded below cleans it up.
      bombArmed: ({ row, col }) => {
        const key = `${row}_${col}`;
        if (this.bombFuseMarkers[key]) {
          this.bombFuseMarkers[key].destroy();
        }
        const { x, y } = hexToPixel(row, col);
        const marker = this.add.text(x, y, '💥', {
          fontSize: '26px',
        }).setOrigin(0.5).setDepth(13);
        this.tweens.add({
          targets: marker,
          scale: 1.4,
          duration: BOMB_FUSE_MS,
          ease: 'Cubic.easeIn',
        });
        this.bombFuseMarkers[key] = marker;
        playBombArm();
        vibrateTap();
      },

      bombExploded: ({ row, col }) => {
        const key = `${row}_${col}`;
        if (this.bombFuseMarkers[key]) {
          this.bombFuseMarkers[key].destroy();
          delete this.bombFuseMarkers[key];
        }
        const { x, y } = hexToPixel(row, col);
        this.cameras.main.shake(300, 0.01);
        this.cameras.main.flash(200, 255, 140, 40);
        this.spawnImpactRing(x, y, { color: 0xffaa33, endScale: 5, duration: 400 });
        this.spawnImpactRing(x, y, { color: 0xff5555, startRadius: 6, endScale: 7, duration: 550 });
        this.shatterEmitter.explode(24, x, y);
        playBombExplode();
        vibrateBombExplode();
      },

      // Room.armShieldTile() sends this both when a shield is stepped on
      // (its spot leaves this.shieldTiles) and again right after with a
      // fresh replacement spot already appended -- same full-re-render
      // approach as bombTilesUpdate above.
      shieldTilesUpdate: ({ shieldTiles }) => {
        this.initShieldTiles(shieldTiles);
      },

      // The hex area Room.armShieldTile() just protected -- pulses every
      // tile in it through playShieldGlow()'s own aurora-cycling tint plus
      // its spark bursts. getTilesWithinHexRadius() (hexGrid.js, shared with
      // Room.js's own identical protected-area computation) gives the tile
      // itself plus its true (up to 6) hex neighbors, 7 tiles for
      // SHIELD_RADIUS=1 -- a square dr/dc loop was tried here first and
      // visibly didn't line up with the hex tiles actually protected on
      // this odd-q offset grid. The stepped-on tile itself already lost its
      // own 🛡️ marker via shieldTilesUpdate just above, so this is the
      // only cue for it (and the only cue at all for its neighbors).
      // playShieldGlow() itself is staggered a beat apart per tile (BFS
      // order already radiates outward from the center tile, see
      // getTilesWithinHexRadius()) so the whole area lights up as a ripple
      // rather than every tile popping in the same frame.
      shieldActivated: ({ row, col }) => {
        // A warmer, more rewarding chime than a flat click -- same one
        // ghost revival already uses, fitting for another "good news"
        // moment rather than a plain UI-tap acknowledgement.
        playRevive();
        vibrateTap();
        const { x: centerX, y: centerY } = hexToPixel(row, col);
        // One big flash + ring right at the stepped-on tile so the whole
        // activation reads as a single, unmistakable "boom" moment, with
        // the per-tile aurora glow below carrying the effect outward from
        // there rather than being the only cue.
        this.cameras.main.flash(220, 255, 215, 120);
        this.spawnImpactRing(centerX, centerY, {
          color: SHIELD_COLOR, startRadius: 6, endScale: 6, duration: 500, strokeWidth: 5,
        });
        this.spawnImpactRing(centerX, centerY, {
          color: 0xfff6c8, startRadius: 4, endScale: 4.5, duration: 380, strokeWidth: 3,
        });
        getTilesWithinHexRadius(row, col, SHIELD_RADIUS).forEach(({ row: tRow, col: tCol }, i) => {
          const tile = this.tileSprites[`${tRow}_${tCol}`];
          if (!tile) {
            return;
          }
          this.stopTileTween(tile);
          // getTilesWithinHexRadius() always returns the center tile itself
          // first (see hexGrid.js), before BFS-expanding out to its
          // neighbors -- i === 0 is exactly the stepped-on tile, which gets
          // the tallest light beam (see playShieldGlow) so the 7-tile
          // effect reads as one hero pillar with 6 shorter supporting ones
          // around it, not 7 identical flashes.
          this.time.delayedCall(i * 60, () => this.playShieldGlow(tile, i === 0));
        });
      },

      // Room.maintainAngelTile()/armAngelTile() both send this -- a fresh
      // placement, a stranded one swept away by the boundary, or the spot
      // just stepped on (see Room.armAngelTile(), which revives a ghost
      // separately -- that side of it already rides the existing
      // playerRevived handler below with no extra wiring needed here).
      angelTileUpdate: ({ angelTile }) => {
        this.initAngelTile(angelTile);
      },

      playerMoved: (playerInfo) => {
        const avatar = this.otherPlayers[playerInfo.playerId];
        if (avatar) {
          // Flip toward travel direction, comparing against the last known
          // *target* (not the mid-glide rendered x, which lags behind it).
          if (playerInfo.x < avatar.targetX) {
            avatar.sprite.setFlipX(true);
          } else if (playerInfo.x > avatar.targetX) {
            avatar.sprite.setFlipX(false);
          }

          // Just record the latest authoritative position; the per-frame
          // lerp in interpolateOtherPlayers() (driven by update()'s delta)
          // eases the avatar toward it. This replaced killing and
          // allocating a fresh Phaser tween on *every* network message —
          // for a bot stepping on its own randomized cadence that was a
          // new tween per step, each restarting before the previous one
          // had settled. A persistent lerp is both cheaper (no per-message
          // allocation or tween-manager bookkeeping) and smoother
          // (continuous glide rather than a 180ms tween that completed
          // then idled until the next step).
          // Network/round-trip latency is unchanged — nothing client-side
          // can remove that — but the rendered motion no longer adds jank.
          avatar.targetX = playerInfo.x;
          avatar.targetY = playerInfo.y;
        }
      },

      playerEliminated: ({ playerId, score, playerScore, x, y }) => {
        // eliminatePlayer() can finish the room in this exact same call
        // (see the roomTransitionHoldUntil constants' own comments) --
        // regardless of whose elimination this is. A spectator (never a
        // "player" themselves, so never reaches handleOwnElimination())
        // watching the room's very last elimination would otherwise see
        // this other avatar's burst/label cut off just as much as a
        // player's own would be. Set once here, before branching, so both
        // the own- and other-player paths below are covered uniformly.
        this.roomTransitionHoldUntil = this.time.now + OWN_ELIMINATION_EFFECT_MS;

        // TEAM rounds score teammates by how long each of them lasted (see
        // Room.js addSurvivalScore), so every elimination in the room — not
        // just the local player's own — can bump the shared team score
        // (showScoreGainPopup itself no-ops on a zero/negative delta). 개인전
        // has no shared score at all — only this player's own elimination
        // should touch the HUD, using their individual playerScore rather
        // than the room-wide total.
        if (this.gameMode === 'SOLO') {
          if (playerId === this.socket.id && Number.isFinite(playerScore)) {
            this.updateScoreText(playerScore);
          }
        } else if (Number.isFinite(score) && score !== this.score) {
          const delta = score - this.score;
          this.updateScoreText(score);
          this.showScoreGainPopup(delta);
        }

        if (playerId === this.socket.id) {
          this.handleOwnElimination(x, y);
          return;
        }
        const avatar = this.otherPlayers[playerId];
        if (avatar) {
          this.eliminationEmitter.explode(14, avatar.x, avatar.y);
          this.showFloatingLabel(avatar.x, avatar.y, '탈락!', COLORS.textDanger);
          this.tweens.add({ targets: avatar, alpha: 0.35, scale: 0.85, duration: 300 });
          // The server parks a ghost's x/y just outside the safe zone the
          // instant it dies (Room.js's eliminatePlayer()), so its floating
          // corpse stops cluttering the actively-playable area. Reusing
          // avatar.targetX/Y here (not a snap) rides the same per-frame
          // lerp interpolateOtherPlayers() already applies to ordinary
          // movement, so the ghost visibly drifts off to the side rather
          // than teleporting.
          if (Number.isFinite(x) && Number.isFinite(y)) {
            avatar.targetX = x;
            avatar.targetY = y;
          }
          playOtherEliminate();
        }
      },

      roomResult: ({ survivorIds, rankings }) => {
        if (this.roomFinished) {
          return;
        }

        const proceed = () => {
          if (this.isSpectator) {
            // Never a player, so never "eliminated" — either the tournament
            // just ended (rankings present, same bundling as the player
            // path below) or this room's round wrapped and the bracket is
            // about to advance to the next stage. In the latter case there's
            // nothing to transition to yet; just wait here for the
            // 'dashboardStarting'/'gameStarting'/'tournamentEnded' handlers
            // below to fire next -- roomFinished deliberately stays false
            // in that branch (only set right before an actual scene.start()
            // below), since setting it here too would make THEIR own
            // anti-double-transition guard incorrectly treat this "just
            // show a banner and keep waiting" moment as if this scene had
            // already transitioned away, permanently skipping the real
            // transition once the next stage actually starts (observed
            // live: a stage-<=2 admin spectating a room stayed stuck on
            // its stale "라운드 종료" banner instead of following the
            // bracket into DashboardScene).
            if (rankings) {
              this.roomFinished = true;
              this.scene.start('ResultScene', { status: 'waiting', rankings });
            } else {
              this.showBanner('라운드 종료! 다음 라운드를 준비하는 중...', '#ffd700');
            }
            return;
          }

          this.roomFinished = true;
          this.eliminated = true;

          // If the tournament ended in this same moment, the final rankings
          // ride along right here instead of a separate later event, so we
          // never risk missing a 'tournamentEnded' broadcast that fires
          // before ResultScene has finished loading.
          if (rankings) {
            this.scene.start('ResultScene', { status: 'eliminated', rankings });
            return;
          }

          if (survivorIds.includes(this.socket.id)) {
            this.scene.start('ResultScene', { status: 'waiting', message: '생존!' });
          } else {
            this.scene.start('ResultScene', { status: 'eliminated', message: '탈락했습니다.' });
          }
        };

        // The server emits 'playerEliminated' and this 'roomResult'
        // essentially back-to-back with no delay -- if this player's own (or,
        // for a spectator, anyone's) elimination effect just started, hold
        // the actual scene transition open long enough for it to be seen
        // instead of tearing GameScene down (camera flash, floating labels
        // and all) within milliseconds of it starting. Any other finish
        // reason has no pending effect to wait out, so this resolves to 0
        // and proceeds immediately exactly as before.
        const holdRemaining = this.roomTransitionHoldUntil
          ? Math.max(0, this.roomTransitionHoldUntil - this.time.now)
          : 0;
        if (holdRemaining > 0) {
          this.time.delayedCall(holdRemaining, proceed);
        } else {
          proceed();
        }
      },

      // Only meaningful for a spectator: a real player is always already
      // off this scene (ResultScene or LobbyScene, each with their own
      // 'gameStarting' listener) by the time the next stage's rooms exist,
      // since their own roomResult above just sent them there. A
      // spectator instead stays parked in GameScene between rounds, so
      // this is how they follow the bracket into round 2 and beyond.
      gameStarting: (payload) => {
        if (this.isSpectator) {
          this.scene.start('GameScene', payload);
        }
      },

      // A player dropped mid-round and their avatar is now bot-proxied
      // during their reconnect grace window (or just reclaimed it). Dim
      // other players' avatars while proxied so it's visible they're on
      // autopilot, matching the ghost/spectator dimming cue. Never fires
      // for this client's own avatar in a way it needs to react to — a
      // proxied local player is disconnected and not looking at the screen.
      playerProxyControl: ({ playerId, proxied }) => {
        const avatar = this.otherPlayers[playerId];
        if (avatar) {
          avatar.setAlpha(proxied ? 0.5 : 1);
        }
      },

      // Covers the case where the spectator's own watched room already
      // wrapped its round (no rankings yet) while a *different* room ends
      // up being the one that finishes the tournament.
      tournamentEnded: ({ rankings }) => {
        if (this.isSpectator) {
          this.scene.start('ResultScene', { status: 'waiting', rankings });
        }
      },

      // Only ever sent to admin sockets (see server.js's startStage() and
      // adminReturnToDashboard handler) — a stage-<=2 admin who double-clicked
      // into a room via 'adminSpectateRoom' to watch it in full has no
      // listener for this without it, so if the bracket advances to the next
      // stage while they're still parked in GameScene, they were left
      // stranded on a dead, frozen board (stale "라운드 종료" banner) instead
      // of being routed back to DashboardScene the way LobbyScene's
      // identical handleDashboardStarting already does for a lobby-phase
      // admin.
      // Also how a real player cut from the bracket gets seated into a
      // dashboard the moment their own room finishes (see server.js's
      // seatSpectator()) — the server emits this to them *before*
      // 'roomResult' in that exact case, so this can arrive and tear down
      // GameScene before the roomResult handler above ever runs for them.
      // Same roomTransitionHoldUntil wait as roomResult itself, for the
      // same reason: without it, a player eliminated on the very same tick
      // their room ends would have their own "탈락!" effect cut off
      // mid-flight by the immediate scene teardown.
      dashboardStarting: (payload) => {
        // Guards the exact same race roomResult's own `if (this.roomFinished)
        // return` guards against: Phaser's scene.start() doesn't tear this
        // scene's socket handlers down synchronously, so a 'roomResult' the
        // server sent right after this can still reach GameScene's own
        // roomResult handler and queue a *second*, conflicting scene
        // transition (observed live: a stray ResultScene "대기실로
        // 돌아가기" button surviving on top of the DashboardScene that
        // actually ends up active). Setting this here makes that second
        // handler's own guard catch it and no-op, exactly as if this
        // player's own roomResult had arrived and been handled first.
        if (this.roomFinished) {
          return;
        }
        this.roomFinished = true;

        const proceed = () => this.scene.start('DashboardScene', payload);
        const holdRemaining = this.roomTransitionHoldUntil
          ? Math.max(0, this.roomTransitionHoldUntil - this.time.now)
          : 0;
        if (holdRemaining > 0) {
          this.time.delayedCall(holdRemaining, proceed);
        } else {
          proceed();
        }
      },

    };

    Object.entries(this.handlers).forEach(([event, handler]) => {
      this.socket.on(event, handler);
    });

    this.events.once('shutdown', () => {
      Object.entries(this.handlers).forEach(([event, handler]) => {
        this.socket.off(event, handler);
      });
      // The joystick's own window-level pointer listeners and DOM elements
      // (createJoystick) live outside Phaser's event system entirely, so
      // nothing else would ever remove them -- without this a stage
      // transition/spectator hand-off (which re-runs create() on the same
      // scene instance without a page reload) would pile up a fresh, fully
      // duplicated joystick and listener set on top of the old one every
      // single time.
      if (this.joystickCleanup) {
        this.joystickCleanup();
      }
      // setDefaultCursor() is a canvas-level CSS style, not scene-scoped --
      // a round that ends (roomResult) while the mouse is still sitting
      // over a revivable tile tears this scene down without ever firing
      // that tile's pointerout, which would otherwise leave the *next*
      // scene (ResultScene/LobbyScene) permanently stuck showing a pointer
      // cursor everywhere.
      this.input.setDefaultCursor('default');
    });
  }

  handleOwnElimination(x, y) {
    if (this.eliminated) {
      return;
    }
    this.eliminated = true;

    if (this.player) {
      this.eliminationEmitter.explode(18, this.player.x, this.player.y);
      // Same red used for the *other*-player elimination label just above
      // (playerEliminated handler) -- these previously diverged (#ff5555
      // here vs #ff8888 there) for the exact same message with no
      // discernible reason to.
      this.showFloatingLabel(this.player.x, this.player.y, '탈락!', COLORS.textDanger);
      // Death effects (explosion/label/aura, all above and below) stay
      // right where it happened -- only the avatar itself drifts off to
      // the server-parked spot just outside the safe zone (see Room.js's
      // eliminatePlayer()), same reasoning as the other-player case just
      // above. update() already no-ops movement once eliminated, so
      // nothing fights this tween the way interpolateOtherPlayers() would.
      this.startGhostAura(this.player.x, this.player.y);
      const tweenTarget = { targets: this.player, alpha: 0.35, scale: 0.85, duration: 300 };
      if (Number.isFinite(x) && Number.isFinite(y)) {
        tweenTarget.x = x;
        tweenTarget.y = y;
      }
      this.tweens.add(tweenTarget);
    }

    this.cameras.main.flash(300, 255, 80, 80);
    playEliminate();
    vibrateEliminate();
    // roomTransitionHoldUntil is already set by playerEliminated (the sole
    // caller of this method) before branching here -- no need to set it
    // again.

    // Same reasoning as the spectator case: a ghost has no avatar left to
    // steer (movement is already a no-op once eliminated — see update()),
    // so leaving the joystick on screen is a dead control that still looks
    // interactive. Ghost mode's actual input is tapping collapsed tiles.
    this.hideJoystick();

    // Team modes get the full ghost-revival HUD (hint text + shared gauge
    // bar); 개인전 has no revival mechanic at all, so an eliminated solo
    // player just gets the translucent spectator wash below with nothing
    // to interact with.
    if (this.gameMode !== 'SOLO') {
      this.ghostHintText.setAlpha(0).setVisible(true).setScale(1);
      this.ghostHintPanel.setVisible(true);
      fitAnchoredRoundedPanel(this.ghostHintPanel, WORLD_WIDTH / 2, WORLD_HEIGHT - 106, 0.5, 0, 24, this.ghostHintText, 24);
      this.tweens.add({ targets: [this.ghostHintText, this.ghostHintPanel], alpha: 1, duration: 400 });

      // A one-time fade-in reads as decoration, not an instruction — this
      // is the only thing telling a ghost what to actually do, so it keeps
      // a slow, continuous breathing pulse for as long as ghost mode lasts
      // (stopped in handleOwnRevival), instead of going still and easy to
      // tune out the moment the fade-in finishes.
      this.ghostHintPulse = this.tweens.add({
        targets: this.ghostHintText,
        scale: 1.08,
        duration: 550,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
        delay: 400,
      });

      this.reviveGaugeBarBg.setVisible(true);
      this.reviveGaugeBarFill.setVisible(true);
      this.drawReviveGaugeFill(0);
    }

    this.tweens.add({ targets: this.ghostOverlay, alpha: 0.3, duration: 600 });
  }

  // Server sends the running total on every successful tap (Room.reviveTile
  // -> 'reviveGaugeUpdate'), so this just renders whatever it says rather
  // than tracking taps independently — a dropped/out-of-order event can
  // never leave the bar showing a stale value for long.
  updateReviveGauge(gauge, max) {
    const ratio = max > 0 ? Phaser.Math.Clamp(gauge / max, 0, 1) : 0;
    this.drawReviveGaugeFill(ratio);
  }

  // Graphics has no persistent .setSize() the way the old flat Rectangle
  // did, so growing the fill means clearing + redrawing it at the new
  // width every update, same as every other rounded bar/panel in the app.
  // Radius is clamped to the fill's own half-height/half-width so a
  // near-empty gauge (a few px wide) doesn't ask fillRoundedRect for a
  // corner radius bigger than the shape itself.
  drawReviveGaugeFill(ratio) {
    this.reviveGaugeBarFill.clear();
    const width = this.reviveGaugeWidth * ratio;
    if (width <= 0) {
      return;
    }
    const radius = Math.min(4, this.reviveGaugeHeight / 2, width / 2);
    drawRoundedRect(
      this.reviveGaugeBarFill,
      this.reviveGaugeX + width / 2,
      this.reviveGaugeY,
      width,
      this.reviveGaugeHeight,
      {
        radius, fillColor: 0x88ccff, fillAlpha: 1, strokeAlpha: 0,
      },
    );
  }

  // Inverse of hideJoystick() — needed once a ghost fills their revival
  // gauge and comes back into the round mid-game, which (unlike a
  // spectator, the only other case that hides the joystick) genuinely
  // needs it back.
  showJoystick() {
    this.joystickEnabled = true;
    this.joystickZoneEl.style.pointerEvents = 'auto';
  }

  // Server-authoritative respawn (Room.respawnGhost) landed on this exact
  // client — reverses everything handleOwnElimination did, rather than
  // re-running the create()/applySnapshot() setup from scratch.
  handleOwnRevival(x, y, score) {
    this.eliminated = false;

    // Re-anchor 개인전's live "내 점수" ticker to this exact moment (see
    // updateLiveScoreText's comment) — otherwise it would resume counting
    // from roundStartTime and briefly display every other alive player's
    // identical number until the next elimination corrected it.
    if (this.gameMode === 'SOLO') {
      this.liveScoreBaseline = Number.isFinite(score) ? score : 0;
      this.liveScoreSince = Date.now();
      this.lastLiveScoreSecond = null;
    }

    if (this.player) {
      this.player.setPosition(x, y);
      this.tweens.add({ targets: this.player, alpha: 1, scale: 1, duration: 300, ease: 'Back.easeOut' });
      this.showFloatingLabel(x, y, '부활!', '#88ff99');
    }

    if (this.ghostAuraEmitter) {
      this.ghostAuraEmitter.stop();
      this.ghostAuraEmitter = null;
    }

    if (this.ghostHintPulse) {
      this.ghostHintPulse.stop();
      this.ghostHintPulse = null;
      this.ghostHintText.setScale(1);
    }

    this.tweens.add({ targets: [this.ghostHintText, this.ghostHintPanel, this.reviveGaugeBarBg, this.reviveGaugeBarFill], alpha: 0, duration: 300, onComplete: () => {
      this.ghostHintText.setVisible(false);
      this.ghostHintPanel.setVisible(false);
      this.reviveGaugeBarBg.setVisible(false);
      this.reviveGaugeBarFill.setVisible(false);
      // Tweened alpha to 0 for the fade-out above; restore full alpha now
      // so these are ready to fade back in cleanly next time this player
      // is eliminated again. The gauge bars were missing from this reset
      // (only the ghost-hint text/panel got it) -- since nothing else in
      // handleOwnElimination() ever restores their alpha either, a player
      // revived once would find the gauge bar permanently stuck invisible
      // (alpha 0, even though .setVisible(true) fires again) every time
      // they died again for the rest of that room.
      this.ghostHintText.setAlpha(1);
      this.ghostHintPanel.setAlpha(1);
      this.reviveGaugeBarBg.setAlpha(1);
      this.reviveGaugeBarFill.setAlpha(1);
    } });
    this.tweens.add({ targets: this.ghostOverlay, alpha: 0, duration: 400 });

    this.showJoystick();
    this.cameras.main.flash(300, 120, 255, 150);
    // playRevive(), not playVictory() -- a ghost respawning mid-round can
    // happen several times over a tournament, and reusing the exact same
    // 5-note fanfare celebrateChampion() plays for the actual tournament
    // win would blunt that moment's distinctiveness by the time it matters.
    playRevive();
    vibrateVictory();
    this.updatePlayerCount();

    // SURVIVAL only -- this code path is never reached in FINAL mode anyway
    // (always SOLO, which has no ghost revival at all, see reviveTile()'s
    // own SOLO guard), so no other mode needs this instruction.
    // Room.respawnGhost() always drops a revived player on a tile that's
    // safe *at that instant*, but the boundary keeps shrinking afterward --
    // finishRoom() only counts someone as advancing if they're both alive
    // AND inside the safe zone at the exact moment the round timer expires,
    // with no grace period for a just-revived player. Without a clear
    // prompt, a late revival easily reads as silently pointless: the player
    // never dies again, sees no elimination event, and simply doesn't
    // advance -- this is purely local/client-side (not shown to the rest of
    // the room, unlike the shared "부활!" banner above), personal to
    // whoever actually needs to move. Delayed so it doesn't immediately
    // clobber that shared banner (showBanner() reuses one text object) --
    // this way both are actually readable in sequence instead of the first
    // getting cut off mid-display.
    if (this.mode === 'SURVIVAL') {
      this.time.delayedCall(2000, () => {
        if (!this.eliminated) {
          this.showBanner('안전지대 안으로 돌아가세요!', '#ff8888');
        }
      });
    }
  }

  startGhostAura(x, y) {
    this.ghostAuraEmitter = this.add.particles('particle_spark').setDepth(4).createEmitter({
      x,
      y: y - 10,
      speedY: { min: -14, max: -6 },
      speedX: { min: -4, max: 4 },
      lifespan: { min: 900, max: 1400 },
      scale: { start: 0.5, end: 0 },
      alpha: { start: 0.5, end: 0 },
      tint: 0x99ccff,
      frequency: 300,
      quantity: 1,
    });
  }

  // Ghost mode's whole input surface, registered once in create() as a
  // scene-level 'pointerdown'/'pointermove' listener (not a per-tile one —
  // there's no longer a specific tile to aim for) — a ghost just keeps
  // touching/dragging across the screen and every point they touch fills
  // the shared revival gauge a little, with the server itself picking which
  // collapsed tile actually comes back (see Room.reviveTile()'s auto-pick
  // branch). Throttled to GHOST_TAP_EFFECT_INTERVAL_MS so a held drag
  // doesn't spawn a golden burst (or a socket emit) on every single
  // rendered pointermove sample.
  handleGhostScreenTap(pointer) {
    // 개인전 has no ghost tile-revival mechanic at all -- an eliminated
    // solo player just spectates the rest of their room, so touching the
    // screen is inert rather than the team-mode revive gesture.
    if (!this.eliminated || this.roomFinished || this.gameMode === 'SOLO') {
      return;
    }

    const now = this.time.now;
    if (now - this.lastGhostTapEffectAt < GHOST_TAP_EFFECT_INTERVAL_MS) {
      return;
    }
    this.lastGhostTapEffectAt = now;

    // Same reasoning as the old per-tile click's own flash: instant
    // feedback on every touch regardless of whether the server's cooldown
    // will actually accept it, rather than waiting on a round-trip to know
    // whether to react at all.
    playClick();
    vibrateTap();
    this.spawnImpactRing(pointer.worldX, pointer.worldY, { color: 0xffd700, endScale: 3, duration: 300 });
    this.ghostTapEmitter.explode(8, pointer.worldX, pointer.worldY);

    this.socket.emit('reviveTile', {});
  }

  showBanner(message, color) {
    this.bannerText.setText(message);
    this.bannerText.setColor(color);
    this.bannerText.setScale(1);

    const bounds = this.bannerText.getBounds();
    // Same rounded-Graphics treatment as every other panel in the app now
    // — redraws outright to the new size rather than resizing a persistent
    // shape, so there's no display-origin caching to fight with the way a
    // Rectangle would have needed.
    drawRoundedRect(this.bannerBackdrop, WORLD_WIDTH / 2, BANNER_Y, bounds.width + 40, bounds.height + BANNER_BACKDROP_HEIGHT_PADDING, {
      fillColor: 0x000000, fillAlpha: 0.45, radius: 10,
    });
    this.bannerBackdrop.setVisible(true).setAlpha(1);

    this.bannerText.setScale(0.6);
    this.bannerText.setAlpha(1);

    if (this.bannerTimer) {
      this.bannerTimer.remove();
    }
    if (this.bannerTween) {
      this.bannerTween.stop();
    }

    this.bannerTween = this.tweens.add({
      targets: this.bannerText,
      scale: 1,
      duration: 260,
      ease: 'Back.easeOut',
    });

    this.bannerTimer = this.time.delayedCall(4000, () => {
      this.tweens.add({ targets: [this.bannerText, this.bannerBackdrop], alpha: 0, duration: 500 });
    });
  }

  updatePlayerCount() {
    // A spectator isn't in `players` at all, so there's no "self" to add
    // on top of otherPlayers here.
    const count = (this.isSpectator ? 0 : 1) + Object.keys(this.otherPlayers).length;
    this.playerCountText.setText(`참가 ${count}명`);
    fitAnchoredRoundedPanel(this.playerCountPanel, WORLD_WIDTH - 6, 8, 1, 0, 24, this.playerCountText, 20);
  }

  // Eases every *other* player's avatar toward its latest server-reported
  // position, once per rendered frame. Runs unconditionally (before update()'s
  // own early-returns) so it keeps working for a spectator — who has no
  // this.player and would otherwise hit the early return below and freeze
  // everyone they're watching — and while this client is eliminated/in the
  // countdown. Frame-rate independent: the smoothing factor is derived from
  // the real elapsed delta, so it glides the same on a 30fps phone as on a
  // 144Hz monitor. See OTHER_PLAYER_LERP_TAU.
  interpolateOtherPlayers(delta) {
    const dt = delta || 16;
    const t = 1 - Math.exp(-dt / OTHER_PLAYER_LERP_TAU);
    Object.values(this.otherPlayers).forEach((avatar) => {
      if (avatar.targetX === undefined) {
        return;
      }
      const dx = avatar.targetX - avatar.x;
      const dy = avatar.targetY - avatar.y;
      // Snap once effectively arrived, so it settles exactly on target
      // instead of chasing it with ever-tinier sub-pixel steps forever.
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
        avatar.x = avatar.targetX;
        avatar.y = avatar.targetY;
        return;
      }
      avatar.x += dx * t;
      avatar.y += dy * t;
    });
  }

  update(time, delta) {
    this.interpolateOtherPlayers(delta);
    this.updateTimerText();
    this.updateLiveScoreText();
    this.checkPlayerDanger();

    if (!this.player || !this.localTileMap || this.eliminated || this.countdownActive) {
      return;
    }

    const speed = 3;
    let dx = 0;
    let dy = 0;

    if (this.cursors.left.isDown) {
      dx = -speed;
    } else if (this.cursors.right.isDown) {
      dx = speed;
    }

    if (this.cursors.up.isDown) {
      dy = -speed;
    } else if (this.cursors.down.isDown) {
      dy = speed;
    }

    if (dx === 0 && dy === 0 && (this.joystickVector.x !== 0 || this.joystickVector.y !== 0)) {
      dx = this.joystickVector.x * speed * JOYSTICK_SENSITIVITY;
      dy = this.joystickVector.y * speed * JOYSTICK_SENSITIVITY;
    }

    if (dx === 0 && dy === 0) {
      return;
    }

    if (dx !== 0) {
      this.player.sprite.setFlipX(dx < 0);
    }

    const startX = this.player.x;
    const startY = this.player.y;

    const nextX = Phaser.Math.Clamp(startX + dx, HEX_WIDTH / 2, WORLD_WIDTH - HEX_WIDTH / 2);
    if (!this.isHole(nextX, startY)) {
      this.player.x = nextX;
    }

    const nextY = Phaser.Math.Clamp(startY + dy, HEX_HEIGHT / 2, WORLD_HEIGHT - HEX_HEIGHT / 2);
    if (!this.isHole(this.player.x, nextY)) {
      this.player.y = nextY;
    }

    if (this.player.x !== startX || this.player.y !== startY) {
      this.emitPlayerMovement();

      const now = this.time.now;
      if (now - this.lastFootstepAt > 120) {
        this.lastFootstepAt = now;
        this.footstepEmitter.explode(2, this.player.x, this.player.y + 14);
      }
    }
  }

  // Leading edge fires immediately; if further moves arrive inside the
  // window they're coalesced and a single trailing emit sends whatever the
  // latest position ended up being -- mirrors Room.js's own
  // broadcastPlayerMoved() exactly, just for the client's outbound emit
  // instead of the server's outbound broadcast. Collision/tile-collapse
  // logic server-side is unaffected: this.player.x/y (read fresh by the
  // trailing timer) is always the current position by the time it fires,
  // and MOVEMENT_EMIT_MIN_INTERVAL_MS's 50ms window is well under the time
  // it takes to cross a single tile at this game's movement speed, so no
  // row/col transition can ever be skipped between throttled emits.
  emitPlayerMovement() {
    const now = this.time.now;
    if (now - this.movementEmitLast >= MOVEMENT_EMIT_MIN_INTERVAL_MS) {
      this.movementEmitLast = now;
      this.socket.emit('playerMovement', { x: this.player.x, y: this.player.y });
      return;
    }

    if (!this.movementEmitTimer) {
      this.movementEmitTimer = this.time.delayedCall(
        MOVEMENT_EMIT_MIN_INTERVAL_MS - (now - this.movementEmitLast),
        () => {
          this.movementEmitTimer = null;
          if (this.eliminated || !this.player) {
            return;
          }
          this.movementEmitLast = this.time.now;
          this.socket.emit('playerMovement', { x: this.player.x, y: this.player.y });
        },
      );
    }
  }

  // 개인전 has no shared score to broadcast on every tick -- the server
  // only credits a player's real score at their own elimination, revival,
  // or the round's end (Room.js addSurvivalScore). Approximating it
  // locally as whole seconds since liveScoreSince (reset to Date.now(),
  // with liveScoreBaseline set to the authoritative score at that moment,
  // on every revival — see handleOwnRevival) keeps the "내 점수" HUD live
  // while still alive; using raw roundStartTime here instead would make
  // this converge to the exact same number for every currently-alive
  // player the instant any revival happened anywhere in the room, since
  // it's the same shared timestamp for everyone — every reviving player's
  // "elapsed since round start" HUD score would identically match every
  // other alive player's, all appearing tied for 1st. Once eliminated,
  // the authoritative playerScore from the 'playerEliminated' event above
  // takes over and this stops touching it.
  updateLiveScoreText() {
    if (this.gameMode !== 'SOLO' || this.eliminated || !this.liveScoreSince) {
      return;
    }
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - this.liveScoreSince) / 1000));
    if (elapsedSeconds === this.lastLiveScoreSecond) {
      return;
    }
    this.lastLiveScoreSecond = elapsedSeconds;
    this.updateScoreText(this.liveScoreBaseline + elapsedSeconds * SURVIVAL_SCORE_PER_SECOND);
  }

  checkPlayerDanger() {
    if (!this.player || this.eliminated || !this.currentSafeBounds) {
      this.dangerVignette.setVisible(false);
      this.wasInDanger = false;
      return;
    }

    const { row, col } = pixelToHex(this.player.x, this.player.y);
    const b = this.currentSafeBounds;
    const inDanger = row < b.rowStart || row > b.rowEnd || col < b.colStart || col > b.colEnd;
    // Edge-triggered rather than every frame while in danger — update()
    // runs 60x/sec, so a continuous vibrate call here would just look like
    // one long buzz instead of a distinct "you just left the safe zone" cue.
    if (inDanger && !this.wasInDanger) {
      vibrateWarning();
    }
    this.wasInDanger = inDanger;
    this.dangerVignette.setVisible(inDanger);
  }

  updateTimerText() {
    if (!this.roundStartTime) {
      return;
    }
    // Clamped at 0 for the first START_COUNTDOWN_MS -- the countdown freeze
    // used to count against this same timer (a 120s round only ever showed
    // ~110s of real, playable time, ticking down underneath the "10, 9,
    // 8..." countdown overlay at the same time, which read as two
    // conflicting countdowns running at once). This one now stays pinned at
    // the full duration through the whole countdown overlay and only starts
    // actually ticking down once it ends -- mirrors Room.js's own
    // roundEndTime exactly (no separate field needed; both sides already
    // have roundStartTime/roundDuration/START_COUNTDOWN_MS).
    const elapsed = Math.max(0, Date.now() - this.roundStartTime - START_COUNTDOWN_MS);
    const remaining = Math.max(0, Math.ceil((this.roundDuration - elapsed) / 1000));

    // The mm:ss readout only actually changes once per second, but update()
    // calls this ~60x/sec — fitAnchoredRoundedPanel()'s getBounds() call is
    // comparatively expensive text-measurement work, not worth redoing every
    // single frame for a string (and panel size) that's identical to the
    // last frame's.
    if (remaining !== this.lastRemainingSeconds) {
      this.lastRemainingSeconds = remaining;
      const mm = Math.floor(remaining / 60);
      const ss = String(remaining % 60).padStart(2, '0');
      this.timerText.setText(`${mm}:${ss}`);
      this.timerText.setColor(remaining <= 10 ? '#ff5555' : '#ffffff');
      fitAnchoredRoundedPanel(this.timerPanel, WORLD_WIDTH / 2, 8, 0.5, 0, 30, this.timerText, 30);
    }

    this.timeUrgencyVignette.setVisible(remaining <= 10 && remaining > 0);

    if (remaining <= 10 && remaining !== this.lastTimerSecond) {
      this.lastTimerSecond = remaining;
      if (remaining > 0) {
        playCountdownTick(true);
      }
      this.tweens.killTweensOf(this.timerText);
      this.timerText.setScale(1);
      this.tweens.add({
        targets: this.timerText,
        scale: 1.35,
        duration: 120,
        yoyo: true,
        ease: 'Quad.easeOut',
      });
    } else if (remaining > 10) {
      this.lastTimerSecond = null;
    }
  }

  isHole(x, y) {
    const { row, col } = pixelToHex(x, y);
    return this.localTileMap[row][col] === TILE_STATE.GONE;
  }

  renderMap(tileMap) {
    Object.values(this.tileSprites).forEach((tile) => {
      this.stopTileTween(tile);
      tile.destroy();
    });
    this.tileSprites = {};
    this.localTileMap = tileMap;

    for (let row = 0; row < MAP_ROWS; row++) {
      for (let col = 0; col < MAP_COLS; col++) {
        const { x, y } = hexToPixel(row, col);
        const state = tileMap[row][col];

        const tile = this.add.image(x, y, this.textureForState(state, row, col));
        tile.baseX = x;
        tile.baseY = y;
        tile.row = row;
        tile.col = col;
        tile.setDepth(-1);
        tile.setVisible(state !== TILE_STATE.GONE);
        this.tileSprites[`${row}_${col}`] = tile;

        if (state === TILE_STATE.WARNING) {
          this.startWarningPulse(tile);
        }
      }
    }
  }

  textureForState(state, row, col) {
    if (state === TILE_STATE.WARNING) {
      return 'tile_warning';
    }
    return (row + col) % 2 === 0 ? 'tile_solid' : 'tile_solid_b';
  }

  tileTintForTexture(key) {
    if (key === 'tile_warning') {
      return 0xff7a52;
    }
    return 0xd9a95f;
  }

  stopTileTween(tile) {
    if (tile.activeTween) {
      tile.activeTween.stop();
      tile.activeTween = null;
    }
    if (tile.graceAlphaTween) {
      tile.graceAlphaTween.stop();
      tile.graceAlphaTween = null;
    }
    if (tile.graceTintTween) {
      tile.graceTintTween.stop();
      tile.graceTintTween = null;
      tile.clearTint();
      tile.setAlpha(1);
    }
  }

  // Both Room.reviveTile (a ghost's manual tap) and autoRegenerateTiles()
  // set the same regenGraceUntil window (REGEN_GRACE_MS) on a tile the
  // instant it comes back — protected from re-collapsing for that whole
  // window, but nothing on screen showed it, so a tile that got walked on
  // right away could just vanish again with no visible reason. Fades the
  // tile in from fully transparent while tinting it a saturated blue that
  // settles back to the tile's own natural colors (tint 0xffffff is the
  // "no tint" identity) — reads as the tile materializing out of a
  // protective glow rather than an already-solid tile abruptly changing
  // hue. Two separate tweens, deliberately different lengths: alpha fades
  // in quickly (300ms, roughly matching the existing scale pop-in below)
  // so the tile doesn't sit oddly translucent for long, while the tint
  // itself eases from blue to normal *linearly* across the entire
  // REGEN_GRACE_MS — an easeOut here would resolve most of the color
  // shift in the tween's first ~15%, leaving the tile reading as
  // "already back to normal" for nearly the whole actual grace window,
  // defeating the original point of being able to tell it's still
  // protected. Finishing the color shift is what doubles as the visible
  // countdown to when the tile becomes vulnerable again.
  playReviveGraceGlow(tile) {
    const fromColor = Phaser.Display.Color.ValueToColor(0x3aa0ff);
    const toColor = Phaser.Display.Color.ValueToColor(0xffffff);
    tile.setTint(0x3aa0ff);
    tile.setAlpha(0);

    tile.graceAlphaTween = this.tweens.add({
      targets: tile,
      alpha: 1,
      duration: 300,
      ease: 'Sine.easeOut',
      onComplete: () => {
        tile.graceAlphaTween = null;
      },
    });

    tile.graceTintTween = this.tweens.addCounter({
      from: 0,
      to: 100,
      duration: REGEN_GRACE_MS,
      ease: 'Linear',
      onUpdate: (tween) => {
        const step = Phaser.Display.Color.Interpolate.ColorWithColor(fromColor, toColor, 100, tween.getValue());
        tile.setTint(Phaser.Display.Color.GetColor(step.r, step.g, step.b));
      },
      onComplete: () => {
        tile.clearTint();
        tile.graceTintTween = null;
      },
    });
  }

  startWarningPulse(tile) {
    tile.setScale(1);
    tile.setAlpha(1);
    tile.activeTween = this.tweens.add({
      targets: tile,
      scale: 0.85,
      alpha: 0.7,
      duration: 260,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  playCollapseAnimation(tile) {
    this.debrisEmitter.setTint(this.tileTintForTexture(tile.texture.key));
    this.debrisEmitter.explode(7, tile.baseX, tile.baseY);

    tile.setPosition(tile.baseX, tile.baseY);
    tile.setScale(1);
    tile.setAlpha(1);
    tile.setAngle(0);

    tile.activeTween = this.tweens.add({
      targets: tile,
      scale: 0,
      alpha: 0,
      angle: Phaser.Math.Between(-100, 100),
      y: tile.baseY + 8,
      duration: 260,
      ease: 'Back.easeIn',
      onComplete: () => tile.setVisible(false),
    });
  }

  playReviveAnimation(tile) {
    tile.setTexture(this.textureForState(TILE_STATE.SOLID, tile.row, tile.col));
    tile.setPosition(tile.baseX, tile.baseY);
    tile.setAngle(0);
    tile.setAlpha(1);
    tile.setScale(0);
    tile.setVisible(true);

    this.sparkEmitter.setTint(0xfff2b0);
    this.sparkEmitter.explode(10, tile.baseX, tile.baseY);

    tile.activeTween = this.tweens.add({
      targets: tile,
      scale: 1,
      duration: 320,
      ease: 'Back.easeOut',
    });

    this.playReviveGraceGlow(tile);
  }

  setTileState(row, col, state) {
    if (this.localTileMap) {
      this.localTileMap[row][col] = state;
    }

    const tile = this.tileSprites[`${row}_${col}`];
    if (!tile) {
      return;
    }

    this.stopTileTween(tile);

    switch (state) {
      case TILE_STATE.GONE:
        this.playCollapseAnimation(tile);
        break;
      case TILE_STATE.WARNING:
        tile.setTexture('tile_warning');
        tile.setPosition(tile.baseX, tile.baseY);
        tile.setVisible(true);
        this.startWarningPulse(tile);
        break;
      default:
        this.playReviveAnimation(tile);
        break;
    }
  }

  addPlayer(playerInfo) {
    this.player = this.createAvatar(playerInfo, true);
  }

  addOtherPlayer(playerInfo) {
    this.otherPlayers[playerInfo.playerId] = this.createAvatar(playerInfo, false);
  }

  createAvatar(playerInfo, isSelf) {
    const container = this.add.container(playerInfo.x, playerInfo.y);
    const children = [];

    const shadow = this.add.ellipse(0, 15, 22, 8, 0x000000, 0.35);
    children.push(shadow);

    // A soft, dark backing plate behind the head -- PIL-verified (no
    // browser in this session) that this meaningfully improves contrast for
    // lighter-colored species (white rabbit/panda, gray elephant) against
    // the board's own warm bronze tiles, and gives every avatar a "sticker"
    // cushion instead of floating bare on the tile. Placed before the
    // self-only spotlight/halo below so those still render on top and stay
    // the dominant "this is you" cue rather than being dimmed by it.
    const iconBacking = this.add.circle(0, 0, 20, 0x000000, 0.22);
    children.push(iconBacking);

    if (isSelf) {
      // A steady, always-at-least-partly-visible spotlight ring so self is
      // easy to spot at a glance, plus the original expanding sonar ping
      // layered on top for extra motion.
      const spotlight = this.add.circle(0, 0, 20, 0x55ffaa, 0.16).setStrokeStyle(3, 0x55ffaa, 1);
      children.push(spotlight);
      this.tweens.add({
        targets: spotlight,
        scale: 1.15,
        duration: 700,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });

      const halo = this.add.circle(0, 0, 16, 0xffffff, 0).setStrokeStyle(2, 0x55ffaa, 0.85);
      children.push(halo);
      this.tweens.add({
        targets: halo,
        scale: 1.35,
        alpha: 0,
        duration: 900,
        repeat: -1,
        ease: 'Sine.easeOut',
      });
    }

    const sprite = this.add.image(0, 0, ensureAnimalTexture(this, playerInfo.animalIndex));
    children.push(sprite);

    let labelColor = '#ffffff';
    if (isSelf) {
      labelColor = '#ffd700';
    } else if (playerInfo.isBot) {
      labelColor = '#9aa3c9';
    }

    const label = this.add.text(0, -26, playerInfo.nickname, {
      fontFamily: FONT_BODY,
      fontSize: '11px',
      color: labelColor,
      stroke: TEXT_STROKE,
      strokeThickness: 2,
    }).setOrigin(0.5);

    // The one remaining flat square-cornered chip in the app — every other
    // text-background chip (LobbyScene's roster cells, every HUD panel)
    // already got the rounded treatment; this nickname tag just predates
    // it. No border (strokeAlpha: 0) to match the original plain-fill
    // Rectangle exactly, just with rounded corners instead of square ones.
    // fillColor uses the shared COLORS.panelFill (warm ember tone) rather
    // than its own hardcoded cool navy -- another leftover from before the
    // board/HUD reskin, same as the frame colors fixed earlier.
    const labelBounds = label.getBounds();
    const labelBg = this.add.graphics();
    drawRoundedRect(labelBg, 0, -26, labelBounds.width + 10, labelBounds.height + 3, {
      radius: 4, fillColor: COLORS.panelFill, fillAlpha: 0.5, strokeAlpha: 0,
    });
    children.push(labelBg, label);

    if (playerInfo.isBot) {
      const botBadge = this.add.text(13, -13, '🤖', { fontSize: '11px' }).setOrigin(0.5);
      children.push(botBadge);
    }

    container.add(children);
    container.playerId = playerInfo.playerId;
    container.sprite = sprite;
    // Interpolation target for other players (see interpolateOtherPlayers).
    // Seeded to the spawn position so the avatar sits still until its first
    // real 'playerMoved' rather than drifting from an undefined target.
    container.targetX = playerInfo.x;
    container.targetY = playerInfo.y;
    container.setDepth(isSelf ? 4 : 3);

    // playerInfo.eliminated is only ever true here for an admin joining an
    // already-in-progress room (adminSpectateRoom, or the stage-3+ spectator
    // hand-off) after some players already died -- a real player's own
    // gameStarting snapshot always arrives at round start, before anyone can
    // be eliminated. The live 'playerEliminated' handler below applies this
    // same alpha/scale dead-look reactively, but a late-joining spectator
    // never saw that event fire, so without this a long-dead player's
    // avatar would otherwise spawn in here looking fully alive.
    const isDead = !!playerInfo.eliminated;
    container.setScale(0.2).setAlpha(0);
    this.tweens.add({
      targets: container,
      scale: isDead ? 0.85 : 1,
      alpha: isDead ? 0.35 : 1,
      delay: Math.random() * 200,
      duration: 400,
      ease: 'Back.easeOut',
    });

    this.tweens.add({
      targets: sprite,
      y: -3,
      duration: 480 + Math.random() * 220,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    return container;
  }
}
