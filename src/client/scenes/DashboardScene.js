import Phaser from 'phaser';

import { getSocket } from '../net/socket';
import { generateBackgroundTexture, generateParticleTextures, generateTileTextures } from '../utilities/EffectTextures';
import { createAmbientEmbers } from '../utilities/SceneFx';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../../shared/hexGrid';
import { MAP_COLS, MAP_ROWS, TILE_STATE } from '../../shared/mapConfig';
import { FONT_DISPLAY, FONT_BODY, COLORS, TEXT_STROKE } from '../theme/Theme';
import { fitTitlePanel, drawRoundedRect } from '../utilities/RoundedPanel';
import { playClick, playBossHit, playBossDefeat } from '../utilities/SoundFx';
import { vibrateTap, vibrateBossHit } from '../utilities/Haptics';
import { applyButtonFx } from '../utilities/ButtonFx';

// Purely a visual/admin-facing demo (see buildBossPreview()) — a mock-up of
// a possible future "everyone attacks one shared boss" mode, unrelated to
// the actual tournament's bracket/team-merge logic in server.js. The "4"
// here is just this preview's own fixed layout (4 corners to put a box in),
// not a read of any real team-count limit — a separate, concurrent change
// elsewhere in the codebase may introduce a real team-count cap, and this
// preview intentionally doesn't reference or depend on it either way.
const PREVIEW_TEAM_COUNT = 4;
const PREVIEW_MAX_HP = 100;
const PREVIEW_DAMAGE_MIN = 10;
const PREVIEW_DAMAGE_MAX = 22;

const CARD_GAP = 14;
const GRID_PADDING = 20;
const HEADER_HEIGHT = 70;
const FOOTER_MARGIN = 14;

// A short window between two pointerdowns on the same card to count as a
// double-click/tap — Phaser interactive objects don't expose native
// dblclick, so this is tracked per-card instead.
const DOUBLE_CLICK_MS = 350;

// Colors for the live per-room tile thumbnail. Deliberately distinct from
// the board's own beveled-hex palette (EffectTextures.js) rather than
// reusing it exactly — at thumbnail size the bevel/gradient detail would
// be lost anyway, so flat, high-contrast fills read better small.
const MINIMAP_COLORS = {
  [TILE_STATE.SOLID]: '#4b5aa0',
  [TILE_STATE.WARNING]: '#ff6b4a',
  [TILE_STATE.GONE]: '#05060c',
};

// Admin-only multi-room overview for stage 1/2 (see server.js's
// 'dashboardStarting' branch in startStage()) — once the bracket has
// several simultaneous rooms, watching one full board in detail is less
// useful than seeing every group's status at a glance. Stage 1 lays out
// up to 8 groups as a 4x2 grid; stage 2's narrower field of ~4 groups lays
// out as 2x2 — both sized to actually fill the screen rather than sitting
// as a small fixed-size cluster in the middle of empty space.
export default class DashboardScene extends Phaser.Scene {

  constructor() {
    super({
      key: 'DashboardScene',
    });
  }

  create(data) {
    this.socket = getSocket();
    this.stage = data.stage;
    // Since 502a092/this change, a real player cut from the bracket also
    // reaches this scene (see server.js's seatSpectator()) with the exact
    // same payload shape an admin gets, minus isAdmin -- every admin-only
    // control below (서버 초기화, C/S balance keys, double-click into an
    // arbitrary room) must gate on this, not just "did I get here at all."
    this.isAdmin = !!data.isAdmin;
    this.cardsByRoomId = {};
    this.selectedRoomId = null;

    generateBackgroundTexture(this, 'bg_gradient', WORLD_WIDTH, WORLD_HEIGHT);
    generateParticleTextures(this);
    // Needed only for the boss preview overlay's "attack tiles" (tile_solid),
    // which reuses the exact same tile art as the real game board rather than
    // a bespoke sprite — generateTileTextures() is internally guarded against
    // regenerating a key that already exists, so this is a no-op if some
    // other scene already created it this session.
    generateTileTextures(this);
    this.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'bg_gradient').setDepth(-30);
    createAmbientEmbers(this);

    // Same warm ember-bordered panel language as every other HUD readout
    // (GameScene's timer/score panels, ResultScene's headline).
    this.titlePanel = this.add.graphics();

    // A single title with a drop shadow for the "burning" mood, rather than
    // a second overlapping emoji text — the previous additive-blend glow
    // copy scaled independently of the main title and drifted out of
    // alignment, reading as a stray duplicate/shadow instead of a soft
    // glow. See LoginScene for the same fix.
    this.titleText = this.add.text(WORLD_WIDTH / 2, 28, `🔥 ${this.stage}라운드 조별 현황`, {
      fontFamily: FONT_DISPLAY,
      fontSize: '22px',
      color: '#ffffff',
      stroke: TEXT_STROKE,
      strokeThickness: 4,
    }).setOrigin(0.5).setShadow(0, 0, '#ff6622', 12, true, true);
    // Rounded rather than a flat square-cornered box (see LoginScene's same
    // fix). getBounds() (what GameScene's own HUD panels already use)
    // reflects the emoji glyphs' real drawn extent, unlike plain .width,
    // which undercounted them enough that the stroked text visibly poked
    // out past the panel border on both sides.
    fitTitlePanel(this.titlePanel, WORLD_WIDTH / 2, 31, 34, this.titleText, 28);

    // No mention of C/S here (or anywhere on this screen) — this dashboard
    // gets projected on a TV for everyone to see, and the whole point of
    // the admin skills is that nobody watching can tell they exist, let
    // alone that clicking a card arms one. Only the harmless spectate hint
    // stays.
    // Only true for the admin -- a non-admin spectator can't actually
    // double-click into a specific room (see spectateRoom()'s own guard
    // below), so showing this hint to them would just be a promise the UI
    // doesn't keep. A player who was just cut from the bracket (seated
    // here straight from GameScene, with no dedicated "탈락했습니다"
    // screen in between -- see GameScene's dashboardStarting handler) gets
    // a plain spectate-status line instead, so this screen doesn't read as
    // unexplained.
    this.hintText = this.add.text(
      WORLD_WIDTH / 2,
      50,
      this.isAdmin ? '더블클릭: 게임 화면 보기' : '탈락 - 다른 조의 경기를 지켜보는 중',
      {
        fontFamily: FONT_BODY,
        fontSize: '12px',
        color: COLORS.textMuted,
      },
    ).setOrigin(0.5);

    this.emptyText = this.add.text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, '현황을 불러오는 중...', {
      fontFamily: FONT_BODY,
      fontSize: '16px',
      color: COLORS.textMuted,
    }).setOrigin(0.5);

    // Emergency "start over" if a tournament gets stuck mid-event (see
    // server.js's resetServer handler) — kept small and muted in a corner,
    // matching this screen's existing "nobody watching can tell an
    // admin capability is even here" design (same reasoning as the C/S
    // skills' deliberately unlabeled keys) rather than LobbyScene's louder,
    // plainly-visible version, since *this* screen is the one that may be
    // projected on a TV for the whole event to see.
    const resetButtonHtml = `
      <button id="dashboard-reset-server-button" type="button"
        style="width:70px;height:20px;font-size:10px;padding:0;border-radius:5px;border:1px solid #7f1d1d;background:#1c0d0dcc;color:#d99;cursor:pointer;font-family:${FONT_BODY};">
        서버 초기화
      </button>
    `;
    // Top-left corner, clear of both the centered title/hint text above and
    // the card grid below (which starts at HEADER_HEIGHT=70) -- the bottom
    // corners were considered too, but FOOTER_MARGIN (14px) leaves no real
    // clearance there once the grid actually fills the screen.
    this.resetServerNode = this.add.dom(40, 15).createFromHTML(resetButtonHtml).setVisible(this.isAdmin);
    this.resetServerButton = this.resetServerNode.getChildByID('dashboard-reset-server-button');
    applyButtonFx(this.resetServerButton);
    this.resetServerButton.addEventListener('click', () => {
      if (!this.isAdmin) {
        return;
      }
      if (!window.confirm('서버를 초기화하면 진행 중인 모든 게임이 즉시 종료되고 모든 참가자가 로그인 화면으로 돌아갑니다. 계속할까요?')) {
        return;
      }
      this.socket.emit('resetServer');
    });

    // Mirrors resetServerButton's corner-tucked, muted styling, just on the
    // opposite corner — this toggles a self-contained overlay (see
    // buildBossPreview()) built lazily on first click, purely a visual demo
    // with no server round-trip at all, unlike every other button here.
    const previewButtonHtml = `
      <button id="dashboard-boss-preview-button" type="button"
        style="width:76px;height:20px;font-size:10px;padding:0;border-radius:5px;border:1px solid #7a5a2a;background:#1c150dcc;color:#e0b060;cursor:pointer;font-family:${FONT_BODY};">
        보스 프리뷰
      </button>
    `;
    this.previewButtonNode = this.add.dom(WORLD_WIDTH - 42, 15).createFromHTML(previewButtonHtml).setVisible(this.isAdmin);
    this.previewButton = this.previewButtonNode.getChildByID('dashboard-boss-preview-button');
    applyButtonFx(this.previewButton);
    this.bossPreview = null;
    this.bossPreviewVisible = false;
    this.previewButton.addEventListener('click', () => {
      if (!this.isAdmin) {
        return;
      }
      this.toggleBossPreview();
    });

    this.handleDashboardUpdate = (payload) => this.renderDashboard(payload);
    this.handleDashboardStarting = (payload) => this.scene.restart(payload);
    this.handleGameStarting = (payload) => {
      this.cleanup();
      this.scene.start('GameScene', payload);
    };
    this.handleTournamentEnded = ({ rankings }) => {
      this.cleanup();
      this.scene.start('ResultScene', { status: 'waiting', rankings });
    };

    this.socket.on('dashboardUpdate', this.handleDashboardUpdate);
    this.socket.on('dashboardStarting', this.handleDashboardStarting);
    this.socket.on('gameStarting', this.handleGameStarting);
    this.socket.on('tournamentEnded', this.handleTournamentEnded);

    // Click a card to target it, then C/S apply to whichever room is
    // selected — see server.js's 'adminCritical'/'adminShatterTiles'
    // handlers. Deliberately no on-screen label for what these keys do:
    // this admin screen may be projected on a TV, and the whole point is
    // that nobody watching can tell an intervention happened. A second,
    // quick click on the same card instead jumps into that room's full
    // game view (see spectateRoom()) — see the hintText above.
    this.handleKeyC = () => this.triggerAdminSkill('adminCritical');
    this.handleKeyS = () => this.triggerAdminSkill('adminShatterTiles');
    this.input.keyboard.on('keydown-C', this.handleKeyC);
    this.input.keyboard.on('keydown-S', this.handleKeyS);

    this.events.once('shutdown', () => {
      this.input.keyboard.off('keydown-C', this.handleKeyC);
      this.input.keyboard.off('keydown-S', this.handleKeyS);
      this.cleanup();
    });
  }

  selectRoom(roomId) {
    this.selectedRoomId = this.selectedRoomId === roomId ? null : roomId;
    Object.values(this.cardsByRoomId).forEach((card) => {
      card.selectionRing.setVisible(card.roomId === this.selectedRoomId);
    });
  }

  // Jumps the admin straight into a specific room's full GameScene as a
  // spectator — server.js's 'adminSpectateRoom' handler seats this socket
  // in that room's channel and replies with a normal 'gameStarting' event,
  // which this scene already listens for (handleGameStarting), so there's
  // nothing further to wire up here. Admin-only, deliberately not extended
  // to a non-admin spectator: everyone free-picking their own room to watch
  // in full real-time detail would multiply this stage's broadcast fan-out
  // by however many people made that choice, instead of the flat, bounded
  // cost of the summary-only dashboard every spectator already gets.
  // server.js's own handler independently re-checks adminSockets too — this
  // is just so the click doesn't even try for a non-admin.
  spectateRoom(roomId) {
    if (!this.isAdmin) {
      return;
    }
    this.socket.emit('adminSpectateRoom', { roomId });
  }

  triggerAdminSkill(eventName) {
    if (!this.isAdmin || !this.selectedRoomId || !this.cardsByRoomId[this.selectedRoomId]) {
      return;
    }
    this.socket.emit(eventName, { roomId: this.selectedRoomId });

    // A brief pulse on the selection ring is the only feedback — visible
    // only to the admin, and reads as nothing more than routine UI polish
    // to anyone glancing at the screen.
    const ring = this.cardsByRoomId[this.selectedRoomId].selectionRing;
    this.tweens.killTweensOf(ring);
    ring.setAlpha(1);
    this.tweens.add({ targets: ring, alpha: 0.5, duration: 200, yoyo: true });
  }

  cleanup() {
    this.socket.off('dashboardUpdate', this.handleDashboardUpdate);
    this.socket.off('dashboardStarting', this.handleDashboardStarting);
    this.socket.off('gameStarting', this.handleGameStarting);
    this.socket.off('tournamentEnded', this.handleTournamentEnded);
  }

  // Stage 1 expects up to ~8 simultaneous groups arranged 4 wide x 2 tall;
  // stage 2's narrower field of ~4 groups arranged 2x2 — in both cases the
  // card size is derived from the actual room count and the real screen
  // area (not a fixed constant), so the grid always reads as "full" rather
  // than a small cluster floating in unused space.
  computeLayout(n) {
    const cols = this.stage <= 1 ? Math.min(4, Math.max(n, 1)) : Math.min(2, Math.max(n, 1));
    const rows = Math.max(1, Math.ceil(n / cols));
    const availW = WORLD_WIDTH - GRID_PADDING * 2;
    const availH = WORLD_HEIGHT - HEADER_HEIGHT - FOOTER_MARGIN;
    const cardW = (availW - (cols - 1) * CARD_GAP) / cols;
    const cardH = (availH - (rows - 1) * CARD_GAP) / rows;
    const totalWidth = cols * cardW + (cols - 1) * CARD_GAP;
    const startX = (WORLD_WIDTH - totalWidth) / 2 + cardW / 2;
    const startY = HEADER_HEIGHT + cardH / 2;
    return { cols, rows, cardW, cardH, startX, startY };
  }

  renderDashboard({ stage, rooms }) {
    this.stage = stage;
    this.emptyText.setVisible(rooms.length === 0);
    if (rooms.length === 0) {
      return;
    }

    const layout = this.computeLayout(rooms.length);

    const seenIds = new Set();
    rooms.forEach((summary, i) => {
      seenIds.add(summary.roomId);
      let card = this.cardsByRoomId[summary.roomId];
      const isNew = !card || card.cardW !== layout.cardW || card.cardH !== layout.cardH;
      if (isNew) {
        if (card) {
          card.container.destroy();
          if (card.minimapTextureKey && this.textures.exists(card.minimapTextureKey)) {
            this.textures.remove(card.minimapTextureKey);
          }
        }
        card = this.createCard(summary.roomId, layout.cardW, layout.cardH);
        this.cardsByRoomId[summary.roomId] = card;
      }

      const col = i % layout.cols;
      const row = Math.floor(i / layout.cols);
      const cellX = layout.startX + col * (layout.cardW + CARD_GAP);
      const cellY = layout.startY + row * (layout.cardH + CARD_GAP);
      // Recorded so the elimination-flash shake (updateCardContent) always
      // has a stable reference to snap back to, rather than reading
      // card.container.x at shake-time — which drifted if two deaths in
      // the same room landed close enough together for their shake tweens
      // to overlap (each one's "current x" was already mid-shake from the
      // last one).
      card.homeX = cellX;

      if (isNew) {
        // Snap straight into its slot -- the entrance scale/alpha tween in
        // createCard() already handles the "arriving" motion, so sliding it
        // in from the container's (0,0) origin too would just look like an
        // unintended extra slide underneath the pop-in.
        card.container.setPosition(cellX, cellY);
      } else if (card.container.x !== cellX || card.container.y !== cellY) {
        // dashboardUpdate ticks about once a second; most of those a card's
        // slot hasn't actually changed, so this only actually fires on the
        // rare tick where another room finishing shifted everyone after it
        // — gliding instead of snapping matches the reposition treatment
        // already used for LobbyScene's roster cells.
        this.tweens.add({ targets: card.container, x: cellX, y: cellY, duration: 250, ease: 'Quad.easeOut' });
      }

      this.updateCardContent(card, summary, i);
    });

    Object.keys(this.cardsByRoomId).forEach((roomId) => {
      if (!seenIds.has(roomId)) {
        // A quick fade/shrink out rather than an instant pop, matching the
        // card's own entrance animation (same fix applied to LobbyScene's
        // roster cells, which had the identical instant-destroy asymmetry).
        const stale = this.cardsByRoomId[roomId];
        const { container, hpBarFill, lowHpTween, borderFlashTimer, minimapTextureKey } = stale;
        // The boss low-HP pulse (repeat: -1) doesn't stop on its own just
        // because the card is going away -- left running, it'd keep
        // ticking against an orphaned game object until this whole scene
        // next restarts/shuts down instead of ending the moment its card
        // does.
        if (lowHpTween) {
          lowHpTween.stop();
        }
        // Same idea for the elimination-flash's pending redraw -- it
        // targets card.cardBorder, which container.destroy() below is
        // about to tear down along with everything else in the card.
        if (borderFlashTimer) {
          borderFlashTimer.remove();
        }
        this.tweens.killTweensOf(hpBarFill);
        this.tweens.add({
          targets: container,
          scale: 0.7,
          alpha: 0,
          duration: 200,
          ease: 'Quad.easeIn',
          onComplete: () => {
            container.destroy();
            if (minimapTextureKey && this.textures.exists(minimapTextureKey)) {
              this.textures.remove(minimapTextureKey);
            }
          },
        });
        delete this.cardsByRoomId[roomId];
        if (this.selectedRoomId === roomId) {
          this.selectedRoomId = null;
        }
      }
    });
  }

  createCard(roomId, cardW, cardH) {
    const container = this.add.container(0, 0).setScale(0.7).setAlpha(0);

    // The live tile-status thumbnail fills almost the entire card as its
    // own background layer; the header strip below sits on top of it with
    // its own solid backing so the room label/stats stay legible over
    // whatever the board looks like at that instant.
    const minimapTextureKey = `dashboard_minimap_${roomId}`;
    const minimapWidth = MAP_COLS * 4;
    const minimapHeight = MAP_ROWS * 4;
    if (!this.textures.exists(minimapTextureKey)) {
      const canvasTexture = this.textures.createCanvas(minimapTextureKey, minimapWidth, minimapHeight);
      // Default linear filtering blurred every tile-color square into its
      // neighbors once this tiny (MAP_COLS*4 x MAP_ROWS*4 px) canvas was
      // scaled up ~5x to fill the card — nearest-neighbor keeps the flat
      // per-tile fills crisp instead of reading as a smudge.
      canvasTexture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    const minimapInnerW = cardW - 16;
    const minimapInnerH = cardH - 46;
    const minimap = this.add.image(0, 20, minimapTextureKey)
      .setDisplaySize(minimapInnerW, Math.max(minimapInnerH, 10));

    // bg stays a plain Rectangle purely for its native hit-testing (click
    // to select, double-click to spectate) — Graphics has no built-in hit
    // area the way Rectangle does, and this card's interaction is the one
    // thing not worth any risk to. Its own border is left off; the rounded
    // outline below is a separate, purely decorative layer drawn at the
    // same bounds, so the square-cornered box the interactive rectangle
    // technically is never actually gets seen.
    const bg = this.add.rectangle(0, 0, cardW, cardH, COLORS.panelFill, 0.35)
      .setInteractive({ useHandCursor: true });

    // Same idea as every DOM button's hover lift (ButtonFx.js) — a subtle
    // brighten so hovering a card reads as "this is clickable" the same
    // way everything else in the app already does, not just a cursor
    // change that's easy to miss.
    bg.on('pointerover', () => bg.setFillStyle(COLORS.panelFill, 0.5));
    bg.on('pointerout', () => bg.setFillStyle(COLORS.panelFill, 0.35));

    let lastClickAt = 0;
    bg.on('pointerdown', () => {
      // Every other clickable thing in the app (buttons via applyButtonFx,
      // in-round tile taps) gets a click sound + tap haptic — these cards
      // were the one interactive surface in the whole game with neither,
      // reading as unresponsive next to everything else even though the
      // click itself worked fine.
      playClick();
      vibrateTap();

      const now = Date.now();
      if (now - lastClickAt < DOUBLE_CLICK_MS) {
        lastClickAt = 0;
        this.spectateRoom(roomId);
        return;
      }
      lastClickAt = now;
      this.selectRoom(roomId);
    });

    const cardBorder = this.add.graphics();
    drawRoundedRect(cardBorder, 0, 0, cardW, cardH, { fillAlpha: 0, strokeWidth: 1, strokeColor: 0xffd700, strokeAlpha: 0.25, radius: 8 });

    // A distinct ring (not just re-coloring bg's own border) so the
    // persistent "this room is targeted" state never fights with the
    // temporary red elimination-flash on bg itself. Same light blue as
    // every other "interactive/highlighted" cue in the app (GameScene's
    // ghost-revive tile highlight, frozen-countdown avatar tint) rather
    // than a one-off brighter cyan that didn't match anything else.
    const selectionRing = this.add.graphics().setVisible(false);
    drawRoundedRect(selectionRing, 0, 0, cardW + 8, cardH + 8, { fillAlpha: 0, strokeWidth: 3, strokeColor: 0x88ccff, strokeAlpha: 1, radius: 10 });

    // Header strip: solid backing so text stays readable over the
    // thumbnail, holding the group label + alive count + timer/score.
    // Rounded on the top two corners only (matching cardBorder's radius:8)
    // -- flush against the card's own rounded top edge, a plain square-
    // cornered Rectangle here poked its sharp top corners out past the
    // smooth curve of the border drawn right behind it.
    const headerBar = this.add.graphics();
    drawRoundedRect(headerBar, 0, -cardH / 2 + 20, cardW, 40, {
      radius: { tl: 8, tr: 8, bl: 0, br: 0 },
      fillAlpha: 0.82,
    });

    const label = this.add.text(-cardW / 2 + 10, -cardH / 2 + 12, '', {
      fontFamily: FONT_BODY,
      fontSize: '15px',
      color: COLORS.textGold,
      stroke: TEXT_STROKE,
      strokeThickness: 3,
    }).setOrigin(0, 0.5);
    const aliveText = this.add.text(cardW / 2 - 10, -cardH / 2 + 12, '', {
      fontFamily: FONT_BODY,
      fontSize: '13px',
      color: '#ffffff',
    }).setOrigin(1, 0.5);
    const infoText = this.add.text(-cardW / 2 + 10, -cardH / 2 + 28, '', {
      fontFamily: FONT_BODY,
      fontSize: '12px',
      color: COLORS.textMuted,
      align: 'left',
    }).setOrigin(0, 0.5);

    const hpBarBg = this.add.rectangle(0, cardH / 2 - 12, cardW - 24, 8, 0x222222).setVisible(false);
    const hpBarFill = this.add.rectangle(-(cardW - 24) / 2, cardH / 2 - 12, cardW - 24, 6, 0xff4444)
      .setOrigin(0, 0.5).setVisible(false);

    container.add([minimap, bg, cardBorder, selectionRing, headerBar, label, aliveText, infoText, hpBarBg, hpBarFill]);

    this.tweens.add({
      targets: container,
      scale: 1,
      alpha: 1,
      duration: 220,
      ease: 'Back.easeOut',
    });

    return {
      container, bg, cardBorder, selectionRing, label, aliveText, infoText, hpBarBg, hpBarFill,
      minimap, minimapTextureKey, minimapCanvas: null,
      roomId, cardW, cardH, prevAliveCount: null, lowHpTween: null, borderFlashTimer: null,
    };
  }

  // Redraws this room's tile-status thumbnail from its current tileMap —
  // one flat-color fillRect per cell (see MINIMAP_COLORS), which at 4px per
  // cell is cheap even redrawn every ~1s tick across 8 simultaneous rooms.
  drawMinimap(card, tileMap) {
    if (!tileMap) {
      return;
    }
    if (!card.minimapCanvas) {
      const canvasTexture = this.textures.get(card.minimapTextureKey);
      card.minimapCanvas = canvasTexture.getContext();
      card.minimapCanvasTexture = canvasTexture;
    }
    const ctx = card.minimapCanvas;
    for (let row = 0; row < tileMap.length; row++) {
      const rowData = tileMap[row];
      for (let col = 0; col < rowData.length; col++) {
        ctx.fillStyle = MINIMAP_COLORS[rowData[col]] || MINIMAP_COLORS[TILE_STATE.GONE];
        ctx.fillRect(col * 4, row * 4, 4, 4);
      }
    }
    card.minimapCanvasTexture.refresh();
  }

  updateCardContent(card, summary, i) {
    const modeLabel = summary.mode === 'BOSS' ? '⚔️ 보스전' : '🏃 생존';
    card.label.setText(`${i + 1}조 ${modeLabel}`);

    this.drawMinimap(card, summary.tileMap);

    // Someone in this group just went down since the last tick — a quick
    // red flash on the card border makes that jump out at a glance instead
    // of relying on the admin to notice the number itself changed.
    if (card.prevAliveCount !== null && summary.aliveCount < card.prevAliveCount) {
      // Redraws the same rounded border (see createCard) in red, then back
      // to its normal gold after a beat — Graphics has no settable stroke
      // property to tween the way Rectangle's setStrokeStyle() had, so
      // this clears+redraws on a plain delayed call instead of a tween.
      if (card.borderFlashTimer) {
        card.borderFlashTimer.remove();
      }
      drawRoundedRect(card.cardBorder, 0, 0, card.cardW, card.cardH, { fillAlpha: 0, strokeWidth: 2, strokeColor: 0xff4444, strokeAlpha: 0.9, radius: 8 });
      card.borderFlashTimer = this.time.delayedCall(500, () => {
        drawRoundedRect(card.cardBorder, 0, 0, card.cardW, card.cardH, { fillAlpha: 0, strokeWidth: 1, strokeColor: 0xffd700, strokeAlpha: 0.25, radius: 8 });
        card.borderFlashTimer = null;
      });
      // Two deaths in the same room close enough together (a real
      // occurrence during a boundary-shrink pile-up, not just a
      // theoretical case) used to layer a second shake on top of the
      // first mid-flight — each one reading card.container.x as its
      // "center" meant the second shake's range was already offset by
      // however far the first had drifted, compounding indefinitely.
      // Killing any shake in progress and snapping back to the recorded
      // home position first makes every shake start from the same known
      // center regardless of what was still animating.
      this.tweens.killTweensOf(card.container);
      card.container.x = card.homeX;
      this.tweens.add({
        targets: card.container,
        x: card.homeX + Phaser.Math.Between(-4, 4),
        duration: 60,
        yoyo: true,
        repeat: 3,
      });
    }
    card.prevAliveCount = summary.aliveCount;

    const aliveRatio = summary.totalCount > 0 ? summary.aliveCount / summary.totalCount : 0;
    const aliveColor = aliveRatio >= 0.7 ? '#88ff99' : (aliveRatio >= 0.4 ? '#ffd700' : '#ff6666');
    card.aliveText.setColor(aliveColor).setText(`생존 ${summary.aliveCount}/${summary.totalCount}`);

    const totalSeconds = Math.ceil(summary.remainingMs / 1000);
    const mm = Math.floor(totalSeconds / 60);
    const ss = totalSeconds % 60;
    const timerStr = `${mm}:${ss.toString().padStart(2, '0')}`;
    card.infoText.setText(`점수 ${summary.score} · 남은시간 ${timerStr}`);

    if (summary.boss) {
      card.hpBarBg.setVisible(true);
      card.hpBarFill.setVisible(true);
      const ratio = summary.boss.maxHp > 0 ? Math.max(0, summary.boss.hp / summary.boss.maxHp) : 0;
      card.hpBarFill.setSize((card.cardW - 24) * ratio, 6);

      // Same "low HP pulses" cue as GameScene's boss HUD bar.
      if (ratio <= 0.25 && !card.lowHpTween) {
        card.lowHpTween = this.tweens.add({
          targets: card.hpBarFill,
          alpha: 0.4,
          duration: 300,
          yoyo: true,
          repeat: -1,
        });
      } else if (ratio > 0.25 && card.lowHpTween) {
        card.lowHpTween.stop();
        card.lowHpTween = null;
        card.hpBarFill.setAlpha(1);
      }
    } else {
      card.hpBarBg.setVisible(false);
      card.hpBarFill.setVisible(false);
    }
  }

  toggleBossPreview() {
    if (!this.bossPreview) {
      this.buildBossPreview();
    }
    this.bossPreviewVisible = !this.bossPreviewVisible;
    this.bossPreview.container.setVisible(this.bossPreviewVisible);
    this.previewButton.textContent = this.bossPreviewVisible ? '닫기' : '보스 프리뷰';
  }

  // Built once, lazily, on first toggle rather than in create() -- most
  // sessions running this dashboard for a real event will never open this,
  // so there's no reason to pay for it (four extra Graphics/Text objects
  // plus their DOM-adjacent tile sprites) up front.
  //
  // Everything here lives in its own container at a depth (200+) well above
  // the real room-card grid, with an opaque interactive backdrop underneath
  // it -- Phaser's default topOnly input routing means that backdrop alone
  // is enough to swallow clicks before they reach a room card sitting right
  // behind it, so the admin can't accidentally arm C/S skills on a real
  // room while this overlay is open.
  buildBossPreview() {
    const centerX = WORLD_WIDTH / 2;
    const centerY = WORLD_HEIGHT / 2 + 22;

    const container = this.add.container(0, 0).setDepth(200).setVisible(false);
    const parts = [];

    const backdrop = this.add.rectangle(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT, 0x000000, 0.72)
      .setInteractive();
    // No-op handler -- its only job is to exist as the topmost interactive
    // object under the pointer so a click anywhere on the backdrop doesn't
    // fall through to a room card underneath.
    backdrop.on('pointerdown', () => {});
    parts.push(backdrop);

    const monster = this.add.text(centerX, centerY - 46, '👹', { fontSize: '46px' }).setOrigin(0.5);
    const monsterNameTag = this.add.graphics();
    const monsterName = this.add.text(centerX, centerY - 14, '불량', {
      fontFamily: FONT_DISPLAY,
      fontSize: '18px',
      color: '#ff5555',
      stroke: TEXT_STROKE,
      strokeThickness: 4,
    }).setOrigin(0.5);
    fitTitlePanel(monsterNameTag, centerX, centerY - 14, 22, monsterName, 16);
    parts.push(monster, monsterNameTag, monsterName);

    const hpBarBg = this.add.rectangle(centerX, centerY + 12, 150, 10, 0x222222);
    const hpBarFill = this.add.rectangle(centerX - 75, centerY + 12, 150, 8, 0xff4444).setOrigin(0, 0.5);
    const hpText = this.add.text(centerX, centerY + 26, '', {
      fontFamily: FONT_BODY,
      fontSize: '11px',
      color: COLORS.textMuted,
    }).setOrigin(0.5);
    parts.push(hpBarBg, hpBarFill, hpText);

    const hint = this.add.text(centerX, WORLD_HEIGHT - 12, '타일을 클릭하면 불량에게 공격 시뮬레이션이 발동합니다 (실제 게임과는 무관)', {
      fontFamily: FONT_BODY,
      fontSize: '10px',
      color: COLORS.textMuted,
    }).setOrigin(0.5);
    parts.push(hint);

    // Fixed 4-corner layout -- see PREVIEW_TEAM_COUNT's own comment for why
    // this "4" is independent of any real team-count logic elsewhere.
    const teamDefs = [
      { label: '1팀', x: 68, y: 52 },
      { label: '2팀', x: WORLD_WIDTH - 68, y: 52 },
      { label: '3팀', x: 68, y: WORLD_HEIGHT - 40 },
      { label: '4팀', x: WORLD_WIDTH - 68, y: WORLD_HEIGHT - 40 },
    ].slice(0, PREVIEW_TEAM_COUNT);

    const teams = teamDefs.map((def) => {
      const box = this.add.graphics();
      drawRoundedRect(box, def.x, def.y, 76, 40, { radius: 6 });
      const label = this.add.text(def.x, def.y - 8, def.label, {
        fontFamily: FONT_BODY,
        fontSize: '13px',
        color: COLORS.textGold,
        stroke: TEXT_STROKE,
        strokeThickness: 3,
      }).setOrigin(0.5);
      const countText = this.add.text(def.x, def.y + 9, '공격 0회', {
        fontFamily: FONT_BODY,
        fontSize: '10px',
        color: COLORS.textMuted,
      }).setOrigin(0.5);
      parts.push(box, label, countText);

      // Attack tile sits a little over halfway from the team's box toward
      // the monster, so the projectile's travel distance still reads as
      // "coming from that team" rather than starting right on top of 불량.
      const tileX = def.x + (centerX - def.x) * 0.55;
      const tileY = def.y + (centerY - def.y) * 0.55;
      const tile = this.add.image(tileX, tileY, 'tile_solid').setScale(0.9).setInteractive({ useHandCursor: true });
      parts.push(tile);

      return { tile, countText, attackCount: 0 };
    });

    container.add(parts);

    const state = {
      container, monster, hpBarFill, hpText, centerX, centerY, hp: PREVIEW_MAX_HP, defeated: false,
    };

    teams.forEach((team) => {
      team.tile.on('pointerdown', () => this.triggerPreviewAttack(state, team));
    });

    this.updatePreviewHpDisplay(state);
    this.bossPreview = state;
  }

  triggerPreviewAttack(state, team) {
    if (state.defeated) {
      return;
    }
    playClick();
    vibrateTap();

    team.attackCount += 1;
    team.countText.setText(`공격 ${team.attackCount}회`);

    const projectile = this.add.image(team.tile.x, team.tile.y, 'particle_spark')
      .setScale(1.6)
      .setTint(0xffaa33);
    state.container.add(projectile);

    this.tweens.add({
      targets: projectile,
      x: state.centerX,
      y: state.centerY - 46,
      duration: 260,
      ease: 'Quad.easeIn',
      onComplete: () => {
        projectile.destroy();
        this.resolvePreviewHit(state);
      },
    });
  }

  resolvePreviewHit(state) {
    const damage = Phaser.Math.Between(PREVIEW_DAMAGE_MIN, PREVIEW_DAMAGE_MAX);
    state.hp = Math.max(0, state.hp - damage);

    playBossHit();
    vibrateBossHit();

    this.tweens.killTweensOf(state.monster);
    state.monster.setScale(1);
    this.tweens.add({ targets: state.monster, scale: 1.15, duration: 80, yoyo: true });

    const dmgText = this.add.text(state.centerX, state.centerY - 60, `-${damage}`, {
      fontFamily: FONT_BODY,
      fontSize: '15px',
      color: '#ffdd55',
      stroke: TEXT_STROKE,
      strokeThickness: 4,
    }).setOrigin(0.5);
    state.container.add(dmgText);
    this.tweens.add({
      targets: dmgText,
      y: state.centerY - 90,
      alpha: 0,
      duration: 600,
      ease: 'Cubic.easeOut',
      onComplete: () => dmgText.destroy(),
    });

    this.updatePreviewHpDisplay(state);

    if (state.hp <= 0 && !state.defeated) {
      state.defeated = true;
      playBossDefeat();
      // A loopable demo, not a one-shot -- rather than leaving the overlay
      // stuck on a dead boss, it quietly resets to full HP after a beat so
      // the admin can keep clicking tiles for as long as they're showing it.
      this.time.delayedCall(1200, () => {
        state.hp = PREVIEW_MAX_HP;
        state.defeated = false;
        this.updatePreviewHpDisplay(state);
      });
    }
  }

  updatePreviewHpDisplay(state) {
    const ratio = Math.max(0, state.hp / PREVIEW_MAX_HP);
    state.hpBarFill.setSize(150 * ratio, 8);
    state.hpText.setText(state.defeated ? '불량 처치! 잠시 후 초기화됩니다' : `HP ${state.hp}/${PREVIEW_MAX_HP}`);
  }
}
