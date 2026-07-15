import Phaser from 'phaser';

import { getSocket } from '../net/socket';
import { ensureAnimalTexture } from '../utilities/AnimalTextures';
import { generateTileTextures, generateBackgroundTexture } from '../utilities/EffectTextures';
import {
  playClick,
  playWarning,
  playCollapse,
  playRevive,
  playEliminate,
  playOtherEliminate,
  playBossHit,
  playBossDefeat,
  playBossSkill,
  playBoundaryAlarm,
  playCountdownTick,
  playCountdownGo,
  playVictory,
} from '../utilities/SoundFx';
import { vibrateWarning, vibrateEliminate, vibrateBossHit, vibrateBossSkill, vibrateVictory, vibrateTap } from '../utilities/Haptics';
import { MAP_COLS, MAP_ROWS, TILE_STATE } from '../../shared/mapConfig';
import { hexToPixel, pixelToHex, WORLD_WIDTH, WORLD_HEIGHT, HEX_WIDTH, HEX_HEIGHT } from '../../shared/hexGrid';
import { FONT_DISPLAY, FONT_BODY, COLORS, TEXT_STROKE } from '../theme/Theme';
import { START_COUNTDOWN_MS } from '../../shared/roundConfig';
import { fitAnchoredRoundedPanel, drawRoundedRect } from '../utilities/RoundedPanel';
import { applyButtonFx } from '../utilities/ButtonFx';

// Flat-top hexagon outline, in local coordinates centered on (0,0) — reused
// for both a tile's click/hover hit area and the ghost-revive highlight, so
// interaction only triggers inside the actual hexagon rather than its
// rectangular bounding box.
function hexPoints(radius) {
  const points = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    points.push(radius * Math.cos(angle), radius * Math.sin(angle));
  }
  return points;
}

const JOYSTICK_X = 70;
const JOYSTICK_Y = WORLD_HEIGHT - 70;
const JOYSTICK_RADIUS = 42;
const JOYSTICK_DEADZONE = 8;

const BOSS_BAR_WIDTH = 220;

// Time constant (ms) for the exponential smoothing that eases each *other*
// player's avatar toward its latest server-reported position. Roughly: the
// avatar closes ~63% of the remaining gap every this-many-ms, so it fully
// catches up within ~3x this. Tuned to feel like the old 180ms glide while
// staying continuous — a bot that only steps once per server tick
// (BOT_MOVE_INTERVAL_MS in server.js) keeps gliding smoothly between steps
// instead of the previous restart-a-fresh-tween-every-message hitch (which
// finished its 180ms tween then sat still until the next step re-triggered it).
const OTHER_PLAYER_LERP_TAU = 70;

// Default ghostHintText copy, shown while a ghost's cooldown is the normal
// GHOST_REVIVE_COOLDOWN_MS rate. Swapped out for the "라스트 스탠드" copy while
// that's active (see the lastStandActivated handler) and restored here once
// the server signals it's deactivated again.
const GHOST_HINT_DEFAULT_TEXT = '유령 모드 - 무너진 칸을 클릭해 복구하세요 (게이지를 채우면 부활!)';

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

    this.socket = getSocket();
    this.player = null;
    this.otherPlayers = {};
    this.tileSprites = {};
    this.localTileMap = null;
    this.cursors = this.input.keyboard.createCursorKeys();

    this.roomId = null;
    this.roundStartTime = null;
    this.roundDuration = null;
    this.eliminated = false;
    this.roomFinished = false;
    this.isSpectator = false;
    this.fromDashboard = false;
    this.mode = 'SURVIVAL';
    this.boss = null;
    this.score = 0;
    this.bossLowHpTween = null;
    this.lastTimerSecond = null;
    this.lastRemainingSeconds = null;
    this.currentSafeBounds = null;
    this.countdownActive = false;
    this.pendingGhostRevives = new Set();
    this.wasInDanger = false;

    this.createBackground();
    this.createEffects();
    this.createHud();
    this.createJoystick();
    this.bindSocketEvents();
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

    // A heavier, wider burst than hitEmitter — used only for the boss's
    // AoE tile-shatter skill (bossShatterSkill), which should read as a
    // bigger, more menacing moment than an ordinary hit landing, not just
    // the same spark burst scaled up.
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

    this.confettiEmitter = this.add.particles('particle_spark').setDepth(31).createEmitter({
      speed: { min: 120, max: 320 },
      angle: { min: 0, max: 360 },
      gravityY: 250,
      lifespan: { min: 600, max: 1000 },
      scale: { start: 1.1, end: 0.2 },
      alpha: { start: 1, end: 0 },
      tint: [0xff5555, 0xffd700, 0x55ff88, 0x55aaff, 0xff88ff],
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

  applySnapshot({ roomId, players, tileMap, roundStartTime, roundDuration, mode, boss, score, isSpectator, fromDashboard }) {
    this.roomId = roomId;
    this.isSpectator = !!isSpectator;
    this.fromDashboard = !!fromDashboard;
    this.renderMap(tileMap);

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
      this.spectatorBadge.setVisible(true);
      this.spectatorBadgePanel.setVisible(true);
      fitAnchoredRoundedPanel(this.spectatorBadgePanel, WORLD_WIDTH / 2, 40, 0.5, 0, 24, this.spectatorBadge, 24);
      this.backToDashboardNode.setVisible(this.fromDashboard);

      if (!this.spectatorBadgePulse) {
        this.spectatorBadgePulse = this.tweens.add({
          targets: this.spectatorBadge,
          alpha: 0.6,
          duration: 900,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    }

    this.roundStartTime = roundStartTime;
    this.roundDuration = roundDuration;
    this.mode = mode || 'SURVIVAL';

    if (this.mode === 'BOSS' && boss) {
      this.initBossHud(boss);
    } else {
      // SURVIVAL rounds now score teammates by survival time too (see
      // Room.js addSurvivalScore), so the readout needs to be visible from
      // the start here as well, not just once a boss fight begins.
      this.scorePanel.setVisible(true);
      this.scoreText.setVisible(true);
    }
    this.updateScoreText(score || 0);

    this.cameras.main.fadeIn(400, 9, 11, 24);
    this.showStartCountdown(() => {
      if (this.mode === 'BOSS') {
        this.showBanner('보스전 시작!\n협력해서 보스를 물리치세요!', '#ff8888');
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

    this.timerText = this.add.text(WORLD_WIDTH / 2, 14, '', {
      fontFamily: FONT_BODY,
      fontSize: '20px',
      color: COLORS.textPrimary,
      stroke: TEXT_STROKE,
      strokeThickness: 4,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(30);

    this.playerCountPanel = this.add.graphics().setScrollFactor(0).setDepth(29);

    this.playerCountText = this.add.text(WORLD_WIDTH - 10, 12, '', {
      fontFamily: FONT_BODY,
      fontSize: '14px',
      color: COLORS.textPrimary,
      stroke: TEXT_STROKE,
      strokeThickness: 3,
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(30);

    this.bannerText = this.add.text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 60, '', {
      fontFamily: FONT_DISPLAY,
      fontSize: '26px',
      color: COLORS.textPrimary,
      stroke: TEXT_STROKE,
      strokeThickness: 5,
      align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(30).setAlpha(0);

    // Stacked directly below the timer panel (which ends at y=38), not
    // overlapping it — they used to share the same y=28 start while the
    // timer ran to y=38, so during BOSS mode the two panels' semi-transparent
    // fills and borders visibly bled into each other for that 10px band.
    // Fixed size (never resized to fit text the way the other HUD panels
    // are), so this draws once here rather than needing a redraw call
    // anywhere else.
    this.bossHpPanel = this.add.graphics().setScrollFactor(0).setDepth(29).setVisible(false);
    drawRoundedRect(this.bossHpPanel, WORLD_WIDTH / 2, 38 + 44 / 2, BOSS_BAR_WIDTH + 24, 44, { radius: 6 });

    this.bossHpText = this.add.text(WORLD_WIDTH / 2, 50, '', {
      fontFamily: FONT_BODY,
      fontSize: '13px',
      color: COLORS.textDanger,
      stroke: TEXT_STROKE,
      strokeThickness: 3,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(30);

    this.bossHpBarBg = this.add.rectangle(WORLD_WIDTH / 2 - BOSS_BAR_WIDTH / 2, 70, BOSS_BAR_WIDTH, 12, 0x222222)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(29).setVisible(false);
    this.bossHpBarFill = this.add.rectangle(WORLD_WIDTH / 2 - BOSS_BAR_WIDTH / 2, 70, BOSS_BAR_WIDTH, 8, 0xff4444)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(30).setVisible(false);

    this.scorePanel = this.add.graphics().setScrollFactor(0).setDepth(29).setVisible(false);

    this.scoreText = this.add.text(10, 12, '', {
      fontFamily: FONT_BODY,
      fontSize: '14px',
      color: COLORS.textGold,
      stroke: TEXT_STROKE,
      strokeThickness: 3,
    }).setOrigin(0, 0).setScrollFactor(0).setDepth(30).setVisible(false);

    this.spectatorBadgePanel = this.add.graphics().setScrollFactor(0).setDepth(29).setVisible(false);

    this.spectatorBadge = this.add.text(WORLD_WIDTH / 2, 46, '👁 관전 모드 - 참가자들의 게임을 지켜보는 중', {
      fontFamily: FONT_BODY,
      fontSize: '13px',
      color: COLORS.textGold,
      stroke: TEXT_STROKE,
      strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(30).setVisible(false);

    // Only shown when the admin reached this room by clicking a card on
    // the multi-room dashboard (see applySnapshot's `fromDashboard` flag) —
    // the stage-3+ auto-spectate case has no dashboard to go back to, so
    // that path never sets fromDashboard and this stays hidden for it.
    const backButtonHtml = `
      <button id="back-to-dashboard-button" type="button"
        style="padding:8px 14px;font-size:13px;border-radius:8px;border:none;background:#1c130dcc;color:#ffd9a0;cursor:pointer;font-family:${FONT_BODY};border:1px solid #ffa94d88;">
        ← 현황판으로
      </button>
    `;
    this.backToDashboardNode = this.add.dom(WORLD_WIDTH / 2, 96).createFromHTML(backButtonHtml).setScrollFactor(0).setDepth(30).setVisible(false);
    this.backToDashboardButton = this.backToDashboardNode.getChildByID('back-to-dashboard-button');
    // Every other button in the app (login, lobby, result) gets this same
    // hover-lift/press feedback plus click sound+haptic via one shared
    // helper — this was the one DOM button in the whole game that never
    // called it, so it alone felt inert/unresponsive next to everything else.
    applyButtonFx(this.backToDashboardButton);
    this.backToDashboardButton.addEventListener('click', () => {
      this.socket.once('dashboardStarting', (payload) => {
        this.scene.start('DashboardScene', payload);
      });
      this.socket.emit('adminReturnToDashboard', { roomId: this.roomId });
    });

    this.ghostHintPanel = this.add.graphics().setScrollFactor(0).setDepth(29).setVisible(false);

    this.ghostHintText = this.add.text(WORLD_WIDTH / 2, WORLD_HEIGHT - 100, GHOST_HINT_DEFAULT_TEXT, {
      fontFamily: FONT_BODY,
      fontSize: '13px',
      color: COLORS.textInfo,
      stroke: TEXT_STROKE,
      strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(30).setVisible(false);

    // Fills as this ghost successfully taps collapsed tiles (see the
    // 'reviveGaugeUpdate' handler) — reaching the end respawns them back
    // into the round (Room.respawnGhost), so this doubles as visible
    // progress toward that instead of tapping feeling directionless.
    this.reviveGaugeBarBg = this.add.rectangle(WORLD_WIDTH / 2, WORLD_HEIGHT - 70, 160, 10, 0x222222)
      .setScrollFactor(0).setDepth(29).setVisible(false);
    this.reviveGaugeBarFill = this.add.rectangle(WORLD_WIDTH / 2 - 80, WORLD_HEIGHT - 70, 0, 8, 0x88ccff)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(30).setVisible(false);

    // A whole-screen blue-gray wash so ghost mode reads as "you're now
    // spectating," not just a slightly-faded version of normal play —
    // everything else on screen keeps its own colors, just seen through
    // this tint.
    this.ghostOverlay = this.add.rectangle(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT, 0x1a2a44, 0)
      .setScrollFactor(0)
      .setDepth(17);

    this.bannerBackdrop = this.add.graphics().setScrollFactor(0).setDepth(29).setVisible(false);

    this.reviveHighlight = this.add.polygon(0, 0, hexPoints(HEX_WIDTH / 2 - 2), 0x88ccff, 0.25)
      .setStrokeStyle(2, 0x88ccff, 0.9)
      .setDepth(0)
      .setVisible(false);

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

  initBossHud(boss) {
    this.boss = boss;
    this.bossHpPanel.setVisible(true);
    this.bossHpBarBg.setVisible(true);
    this.bossHpBarFill.setVisible(true);
    this.scorePanel.setVisible(true);
    this.scoreText.setVisible(true);
    this.updateBossHpBar();

    const { x, y } = hexToPixel(boss.row, boss.col);

    this.bossTileMarker = this.add.text(x, y, '☄️', { fontSize: '22px' }).setOrigin(0.5).setDepth(5).setScale(3).setAlpha(0);

    this.bossTrailEmitter = this.add.particles('particle_spark').setDepth(4).createEmitter({
      speed: { min: 10, max: 30 },
      angle: { min: 0, max: 360 },
      lifespan: { min: 400, max: 700 },
      scale: { start: 0.6, end: 0 },
      alpha: { start: 0.6, end: 0 },
      tint: 0xffaa55,
      frequency: 90,
      quantity: 1,
    });
    this.bossTrailEmitter.startFollow(this.bossTileMarker);

    this.cameras.main.shake(300, 0.007);
    this.tweens.add({
      targets: this.bossTileMarker,
      scale: 1,
      alpha: 1,
      duration: 450,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: this.bossTileMarker,
          scale: 1.15,
          duration: 500,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      },
    });
  }

  updateBossHpBar() {
    if (!this.boss) {
      return;
    }
    const ratio = Math.max(0, this.boss.hp / this.boss.maxHp);
    this.bossHpBarFill.setSize(BOSS_BAR_WIDTH * ratio, 8);
    this.bossHpText.setText(`보스 체력 ${this.boss.hp}/${this.boss.maxHp}`);

    if (ratio <= 0.25 && !this.bossLowHpTween) {
      this.bossLowHpTween = this.tweens.add({
        targets: this.bossHpBarFill,
        alpha: 0.4,
        duration: 260,
        yoyo: true,
        repeat: -1,
      });
    } else if (ratio > 0.25 && this.bossLowHpTween) {
      this.bossLowHpTween.stop();
      this.bossLowHpTween = null;
      this.bossHpBarFill.setAlpha(1);
    }
  }

  // A quick expanding-ring shockwave at (x, y) — used by both a boss hit
  // and (bigger/slower) the boss's AoE shatter skill, so a landed attack
  // reads as a real impact instead of just a particle puff with no sense
  // of force radiating outward.
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

  showFloatingDamage(x, y, amount) {
    const text = this.add.text(x, y - 10, `-${amount}`, {
      fontFamily: FONT_BODY,
      fontSize: '16px',
      color: '#ffdd55',
      stroke: TEXT_STROKE,
      strokeThickness: 4,
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
      strokeThickness: 4,
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

  playBossDefeatCelebration(x, y) {
    this.confettiEmitter.explode(40, x, y);
    this.cameras.main.flash(400, 255, 240, 150);
    this.cameras.main.shake(250, 0.006);
  }

  updateScoreText(score) {
    const changed = score !== this.score;
    this.score = score;
    this.scoreText.setText(`팀 점수 ${score}`);
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
    if (!(amount > 0)) {
      return;
    }
    const text = this.add.text(this.scoreText.x + this.scoreText.width + 12, this.scoreText.y + 6, `+${amount}`, {
      fontFamily: FONT_BODY,
      fontSize: '13px',
      color: '#88ff99',
      stroke: TEXT_STROKE,
      strokeThickness: 3,
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

  createJoystick() {
    this.joystickVector = { x: 0, y: 0 };
    this.joystickPointerId = null;

    // A soft, slowly-breathing glow ring behind the base — echoes the
    // ember particles used elsewhere so the joystick doesn't read as a
    // leftover generic-template control.
    this.joystickGlow = this.add.circle(JOYSTICK_X, JOYSTICK_Y, JOYSTICK_RADIUS + 6, 0xffaa44, 0.12)
      .setScrollFactor(0)
      .setDepth(19);
    this.tweens.add({
      targets: this.joystickGlow,
      scale: 1.15,
      alpha: 0.05,
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.joystickBase = this.add.circle(JOYSTICK_X, JOYSTICK_Y, JOYSTICK_RADIUS, 0xffaa44, 0.15)
      .setScrollFactor(0)
      .setDepth(20)
      .setStrokeStyle(2, 0xffcc66, 0.5);

    this.joystickThumb = this.add.circle(JOYSTICK_X, JOYSTICK_Y, 18, 0xffcc66, 0.4)
      .setScrollFactor(0)
      .setDepth(21);

    this.input.on('pointerdown', (pointer) => {
      const dist = Phaser.Math.Distance.Between(pointer.x, pointer.y, JOYSTICK_X, JOYSTICK_Y);
      if (this.joystickPointerId === null && dist <= JOYSTICK_RADIUS * 2) {
        this.joystickPointerId = pointer.id;
        this.updateJoystick(pointer);
        this.tweens.killTweensOf(this.joystickBase);
        this.tweens.add({ targets: this.joystickBase, scale: 1.12, duration: 120, ease: 'Quad.easeOut' });
        this.joystickThumb.setFillStyle(0xffcc66, 0.65);
      }
    });

    this.input.on('pointermove', (pointer) => {
      if (pointer.id === this.joystickPointerId) {
        this.updateJoystick(pointer);
      }
    });

    const releaseJoystick = (pointer) => {
      if (pointer.id === this.joystickPointerId) {
        this.joystickPointerId = null;
        this.joystickVector = { x: 0, y: 0 };
        this.tweens.killTweensOf(this.joystickBase);
        this.tweens.add({ targets: this.joystickBase, scale: 1, duration: 150, ease: 'Quad.easeOut' });
        this.tweens.killTweensOf(this.joystickThumb);
        this.tweens.add({ targets: this.joystickThumb, x: JOYSTICK_X, y: JOYSTICK_Y, duration: 150, ease: 'Back.easeOut' });
        // Back to the same amber as its initial idle color (0xffcc66,
        // 0.4) -- this was still the pre-recolor white, so after the
        // first touch-and-release the thumb would stay white in idle for
        // the rest of the round instead of returning to amber.
        this.joystickThumb.setFillStyle(0xffcc66, 0.4);
      }
    };

    this.input.on('pointerup', releaseJoystick);
    this.input.on('pointerupoutside', releaseJoystick);
  }

  // A spectator has no avatar to steer, so the joystick would just sit
  // there doing nothing — hide it rather than leave a dead control on
  // screen.
  hideJoystick() {
    this.joystickGlow.setVisible(false);
    this.joystickBase.setVisible(false);
    this.joystickThumb.setVisible(false);
  }

  updateJoystick(pointer) {
    const dx = pointer.x - JOYSTICK_X;
    const dy = pointer.y - JOYSTICK_Y;
    const dist = Math.min(JOYSTICK_RADIUS, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);

    this.joystickThumb.setPosition(
      JOYSTICK_X + Math.cos(angle) * dist,
      JOYSTICK_Y + Math.sin(angle) * dist
    );

    if (dist < JOYSTICK_DEADZONE) {
      this.joystickVector = { x: 0, y: 0 };
      return;
    }

    const norm = dist / JOYSTICK_RADIUS;
    this.joystickVector = {
      x: Math.cos(angle) * norm,
      y: Math.sin(angle) * norm,
    };
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

      tileRevived: ({ row, col }) => {
        // Auto-regen bursts also fire this same event, so without tracking
        // which tiles *this* ghost actually clicked, a successful click and
        // an unrelated ambient regen elsewhere would look identical — this
        // gives the deliberate action its own distinct payoff.
        const key = `${row}_${col}`;
        if (this.pendingGhostRevives.has(key)) {
          this.pendingGhostRevives.delete(key);
          const { x: reviveX, y: reviveY } = hexToPixel(row, col);
          this.showFloatingLabel(reviveX, reviveY, '복구!', '#88ccff');
          vibrateTap();
        }
        this.setTileState(row, col, TILE_STATE.SOLID);
        playRevive();
      },

      // Personal to this socket (Room.reviveTile emits this via
      // io.to(id), not a room-wide broadcast) — only ever received while
      // this client is actually a ghost.
      reviveGaugeUpdate: ({ gauge, max }) => {
        this.updateReviveGauge(gauge, max);
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
        if (this.eliminated) {
          this.ghostHintText.setText('지금 미친듯이 클릭하세요! 복구 속도 UP · 게이지를 채우면 부활!');
          fitAnchoredRoundedPanel(this.ghostHintPanel, WORLD_WIDTH / 2, WORLD_HEIGHT - 106, 0.5, 0, 24, this.ghostHintText, 24);
        }
      },

      playerRevived: ({ playerId, x, y }) => {
        if (playerId === this.socket.id) {
          this.handleOwnRevival(x, y);
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

      bossDamaged: ({ hp, maxHp, row, col, defeated, score }) => {
        if (!this.boss) {
          return;
        }
        const damage = Math.max(0, this.boss.hp - hp);
        this.boss.hp = hp;
        this.boss.maxHp = maxHp;
        this.updateBossHpBar();
        this.updateScoreText(score);

        const { x: worldX, y: worldY } = hexToPixel(row, col);

        if (damage > 0) {
          // Bigger hits (an admin's hidden critical, or just a bigger
          // BOSS_METEOR_DAMAGE down the line) now visibly hit harder
          // instead of always producing the exact same-sized burst
          // regardless of how much damage actually landed.
          const isBigHit = damage >= 4;
          const particleCount = Math.min(36, 10 + damage * 3);
          const shakeIntensity = Math.min(0.02, 0.0035 + damage * 0.0015);

          this.showFloatingDamage(worldX, worldY, damage);
          this.hitEmitter.explode(particleCount, worldX, worldY);
          this.spawnImpactRing(worldX, worldY, {
            color: isBigHit ? 0xffcc33 : 0xff5555,
            endScale: isBigHit ? 6 : 3.5,
            duration: isBigHit ? 450 : 300,
          });
          this.cameras.main.shake(isBigHit ? 180 : 90, shakeIntensity);
          if (this.bossTileMarker) {
            this.bossTileMarker.setTint(0xffffff);
            this.time.delayedCall(90, () => this.bossTileMarker && this.bossTileMarker.clearTint());
          }
          playBossHit();
          vibrateBossHit();
        }

        if (defeated) {
          if (this.bossTileMarker) {
            this.bossTileMarker.setVisible(false);
          }
          if (this.bossTrailEmitter) {
            this.bossTrailEmitter.stop();
          }
          this.playBossDefeatCelebration(worldX, worldY);
          this.showBanner('보스를 물리쳤습니다! 🎉', '#55ff88');
          playBossDefeat();
          vibrateVictory();
        } else {
          this.boss.row = row;
          this.boss.col = col;
          if (this.bossTileMarker) {
            this.bossTileMarker.setPosition(worldX, worldY);
          }
        }
      },

      // The boss "slams the ground" and cracks several tiles at once (see
      // Room.js's triggerBossShatterSkill()) — a heavier, longer shake, a
      // dark flash, a wide shockwave ring + debris burst radiating from
      // the boss's current tile, a brief camera zoom punch, and a banner
      // naming the moment, so it reads as a genuine set-piece rather than
      // a slightly-longer version of an ordinary hit.
      bossShatterSkill: () => {
        const origin = this.boss ? hexToPixel(this.boss.row, this.boss.col) : { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };

        this.cameras.main.shake(450, 0.014);
        this.cameras.main.flash(220, 120, 10, 10);
        this.cameras.main.zoomTo(1.06, 140, 'Sine.easeOut', false, (camera, progress) => {
          if (progress === 1) {
            this.cameras.main.zoomTo(1, 260, 'Sine.easeIn');
          }
        });

        this.spawnImpactRing(origin.x, origin.y, {
          color: 0xff6633, startRadius: 16, endScale: 9, duration: 550, strokeWidth: 6,
        });
        this.time.delayedCall(90, () => {
          this.spawnImpactRing(origin.x, origin.y, {
            color: 0xffaa33, startRadius: 10, endScale: 6, duration: 450, strokeWidth: 4,
          });
        });
        this.shatterEmitter.explode(30, origin.x, origin.y);

        this.showBanner('⚠️ 보스의 대지 붕괴!', '#ff6633');
        playBossSkill();
        vibrateBossSkill();
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
          // for a bot stepping every BOT_MOVE_INTERVAL_MS tick that was a
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

      playerEliminated: ({ playerId, score }) => {
        // SURVIVAL rounds score teammates by how long each of them lasted
        // (see Room.js addSurvivalScore), so every elimination in the room —
        // not just the local player's own — can bump the shared team score;
        // BOSS mode eliminations don't change score, so the delta is 0 there
        // and the popup is skipped.
        if (Number.isFinite(score) && score !== this.score) {
          const delta = score - this.score;
          this.updateScoreText(score);
          this.showScoreGainPopup(delta);
        }

        if (playerId === this.socket.id) {
          this.handleOwnElimination();
          return;
        }
        const avatar = this.otherPlayers[playerId];
        if (avatar) {
          this.eliminationEmitter.explode(14, avatar.x, avatar.y);
          this.showFloatingLabel(avatar.x, avatar.y, '탈락!', '#ff8888');
          this.tweens.add({ targets: avatar, alpha: 0.35, scale: 0.85, duration: 300 });
          playOtherEliminate();
        }
      },

      roomResult: ({ survivorIds, rankings }) => {
        if (this.roomFinished) {
          return;
        }
        this.roomFinished = true;

        if (this.isSpectator) {
          // Never a player, so never "eliminated" — either the tournament
          // just ended (rankings present, same bundling as the player
          // path below) or this room's round wrapped and the bracket is
          // about to advance to the next stage. In the latter case there's
          // nothing to transition to yet; just wait here for the
          // 'gameStarting'/'tournamentEnded' handlers below to fire next.
          if (rankings) {
            this.scene.start('ResultScene', { status: 'waiting', rankings });
          } else {
            this.showBanner('라운드 종료! 다음 라운드를 준비하는 중...', '#ffd700');
          }
          return;
        }

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
      },

      // Only meaningful for a spectator: a real player is always already
      // off this scene (ResultScene or LobbyScene, each with their own
      // 'gameStarting' listener) by the time the next stage's rooms exist,
      // since their own roomResult above just sent them there. A
      // spectator instead stays parked in GameScene between rounds, so
      // this is how they follow the bracket into round 2 (BOSS mode) and
      // beyond.
      gameStarting: (payload) => {
        if (this.isSpectator) {
          this.scene.start('GameScene', payload);
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
      dashboardStarting: (payload) => {
        this.scene.start('DashboardScene', payload);
      },

    };

    Object.entries(this.handlers).forEach(([event, handler]) => {
      this.socket.on(event, handler);
    });

    // Admin-only "balance lever", same C/S keys as DashboardScene — this
    // covers watching a single BOSS room in full (stage 3+, or any
    // spectated room) where there's no multi-room grid to click a target
    // on; the room being spectated *is* the implicit target. No-ops for a
    // regular player or outside BOSS mode, checked at trigger time so this
    // can just be registered unconditionally here.
    this.handleKeyC = () => this.triggerAdminSkill('adminCritical');
    this.handleKeyS = () => this.triggerAdminSkill('adminShatterTiles');
    this.input.keyboard.on('keydown-C', this.handleKeyC);
    this.input.keyboard.on('keydown-S', this.handleKeyS);

    this.events.once('shutdown', () => {
      Object.entries(this.handlers).forEach(([event, handler]) => {
        this.socket.off(event, handler);
      });
      this.input.keyboard.off('keydown-C', this.handleKeyC);
      this.input.keyboard.off('keydown-S', this.handleKeyS);
    });
  }

  triggerAdminSkill(eventName) {
    if (!this.isSpectator || this.mode !== 'BOSS' || !this.roomId) {
      return;
    }
    this.socket.emit(eventName, { roomId: this.roomId });
  }

  handleOwnElimination() {
    if (this.eliminated) {
      return;
    }
    this.eliminated = true;

    if (this.player) {
      this.eliminationEmitter.explode(18, this.player.x, this.player.y);
      this.showFloatingLabel(this.player.x, this.player.y, '탈락!', '#ff5555');
      this.tweens.add({ targets: this.player, alpha: 0.35, scale: 0.85, duration: 300 });
      this.startGhostAura(this.player.x, this.player.y);
    }

    this.cameras.main.flash(300, 255, 80, 80);
    playEliminate();
    vibrateEliminate();

    // Same reasoning as the spectator case: a ghost has no avatar left to
    // steer (movement is already a no-op once eliminated — see update()),
    // so leaving the joystick on screen is a dead control that still looks
    // interactive. Ghost mode's actual input is tapping collapsed tiles.
    this.hideJoystick();

    this.ghostHintText.setAlpha(0).setVisible(true);
    this.ghostHintPanel.setVisible(true);
    fitAnchoredRoundedPanel(this.ghostHintPanel, WORLD_WIDTH / 2, WORLD_HEIGHT - 106, 0.5, 0, 24, this.ghostHintText, 24);
    this.tweens.add({ targets: [this.ghostHintText, this.ghostHintPanel], alpha: 1, duration: 400 });

    this.reviveGaugeBarBg.setVisible(true);
    this.reviveGaugeBarFill.setVisible(true).setSize(0, 8);

    this.tweens.add({ targets: this.ghostOverlay, alpha: 0.3, duration: 600 });
  }

  // Server sends the running total on every successful tap (Room.reviveTile
  // -> 'reviveGaugeUpdate'), so this just renders whatever it says rather
  // than tracking taps independently — a dropped/out-of-order event can
  // never leave the bar showing a stale value for long.
  updateReviveGauge(gauge, max) {
    const ratio = max > 0 ? Phaser.Math.Clamp(gauge / max, 0, 1) : 0;
    this.reviveGaugeBarFill.setSize(160 * ratio, 8);
  }

  // Inverse of hideJoystick() — needed once a ghost fills their revival
  // gauge and comes back into the round mid-game, which (unlike a
  // spectator, the only other case that hides the joystick) genuinely
  // needs it back.
  showJoystick() {
    this.joystickGlow.setVisible(true);
    this.joystickBase.setVisible(true);
    this.joystickThumb.setVisible(true);
  }

  // Server-authoritative respawn (Room.respawnGhost) landed on this exact
  // client — reverses everything handleOwnElimination did, rather than
  // re-running the create()/applySnapshot() setup from scratch.
  handleOwnRevival(x, y) {
    this.eliminated = false;

    if (this.player) {
      this.player.setPosition(x, y);
      this.tweens.add({ targets: this.player, alpha: 1, scale: 1, duration: 300, ease: 'Back.easeOut' });
      this.showFloatingLabel(x, y, '부활!', '#88ff99');
    }

    if (this.ghostAuraEmitter) {
      this.ghostAuraEmitter.stop();
      this.ghostAuraEmitter = null;
    }

    this.tweens.add({ targets: [this.ghostHintText, this.ghostHintPanel, this.reviveGaugeBarBg, this.reviveGaugeBarFill], alpha: 0, duration: 300, onComplete: () => {
      this.ghostHintText.setVisible(false);
      this.ghostHintPanel.setVisible(false);
      this.reviveGaugeBarBg.setVisible(false);
      this.reviveGaugeBarFill.setVisible(false);
      // Tweened alpha to 0 for the fade-out above; restore full alpha now
      // so these are ready to fade back in cleanly next time this player
      // is eliminated again.
      this.ghostHintText.setAlpha(1);
      this.ghostHintPanel.setAlpha(1);
    } });
    this.tweens.add({ targets: this.ghostOverlay, alpha: 0, duration: 400 });

    this.showJoystick();
    this.cameras.main.flash(300, 120, 255, 150);
    playVictory();
    vibrateVictory();
    this.updatePlayerCount();
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

  handleTileClick(row, col) {
    if (!this.eliminated || this.roomFinished) {
      return;
    }
    if (!this.localTileMap || this.localTileMap[row][col] !== TILE_STATE.GONE) {
      return;
    }

    // Every other interactive click in the app (DOM buttons, dashboard
    // cards) gets instant feedback the moment it's tapped -- this one
    // otherwise only got a sound/vibration later, on the server's
    // 'tileRevived' reply. Most taps don't actually fill the gauge, so a
    // ghost tapping under real venue-wifi latency previously got zero
    // confirmation at all that the tap even registered.
    playClick();
    vibrateTap();

    const key = `${row}_${col}`;
    this.pendingGhostRevives.add(key);
    this.time.delayedCall(1500, () => this.pendingGhostRevives.delete(key));

    this.socket.emit('reviveTile', { row, col });
  }

  handleTileHover(row, col, isOver) {
    if (!isOver || !this.eliminated || this.roomFinished) {
      this.reviveHighlight.setVisible(false);
      return;
    }
    if (!this.localTileMap || this.localTileMap[row][col] !== TILE_STATE.GONE) {
      this.reviveHighlight.setVisible(false);
      return;
    }
    const { x: hoverX, y: hoverY } = hexToPixel(row, col);
    this.reviveHighlight.setPosition(hoverX, hoverY).setVisible(true);
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
    drawRoundedRect(this.bannerBackdrop, WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 60, bounds.width + 40, bounds.height + 24, {
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
      dx = this.joystickVector.x * speed;
      dy = this.joystickVector.y * speed;
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
      this.socket.emit('playerMovement', { x: this.player.x, y: this.player.y });

      const now = this.time.now;
      if (now - this.lastFootstepAt > 120) {
        this.lastFootstepAt = now;
        this.footstepEmitter.explode(2, this.player.x, this.player.y + 14);
      }
    }
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
    const elapsed = Date.now() - this.roundStartTime;
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

    // A hex tile's texture image is a rectangular canvas (HEX_WIDTH x
    // HEX_HEIGHT) with transparent corners, so the default rectangular
    // hit area from a bare setInteractive() would let clicks in those
    // transparent corners register on the wrong tile — an explicit hex
    // polygon hit area (same shape drawn into the texture) fixes that.
    const hitArea = new Phaser.Geom.Polygon(hexPoints(HEX_WIDTH / 2 - 1));

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
        tile.setInteractive(hitArea, Phaser.Geom.Polygon.Contains);
        tile.on('pointerdown', () => this.handleTileClick(row, col));
        tile.on('pointerover', () => this.handleTileHover(row, col, true));
        tile.on('pointerout', () => this.handleTileHover(row, col, false));
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
      return 0xff6b5b;
    }
    return 0x767fb8;
  }

  stopTileTween(tile) {
    if (tile.activeTween) {
      tile.activeTween.stop();
      tile.activeTween = null;
    }
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
      strokeThickness: 3,
    }).setOrigin(0.5);

    const labelBounds = label.getBounds();
    const labelBg = this.add.rectangle(0, -26, labelBounds.width + 10, labelBounds.height + 3, 0x0b0e1c, 0.5)
      .setOrigin(0.5);
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

    container.setScale(0.2).setAlpha(0);
    this.tweens.add({
      targets: container,
      scale: 1,
      alpha: 1,
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
