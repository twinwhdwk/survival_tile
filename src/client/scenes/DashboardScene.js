import Phaser from 'phaser';

import { getSocket } from '../net/socket';
import { generateBackgroundTexture, generateParticleTextures } from '../utilities/EffectTextures';
import { createAmbientEmbers } from '../utilities/SceneFx';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../../shared/hexGrid';
import { MAP_COLS, MAP_ROWS, TILE_STATE } from '../../shared/mapConfig';
import {
  FONT_DISPLAY, FONT_BODY, COLORS, TEXT_STROKE, BUTTON,
} from '../theme/Theme';
import { fitTitlePanel, drawRoundedRect } from '../utilities/RoundedPanel';
import { playClick } from '../utilities/SoundFx';
import { vibrateTap } from '../utilities/Haptics';
import { applyButtonFx } from '../utilities/ButtonFx';

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
    // control below (서버 초기화, double-click into an arbitrary room) must
    // gate on this, not just "did I get here at all."
    this.isAdmin = !!data.isAdmin;
    this.cardsByRoomId = {};

    generateBackgroundTexture(this, 'bg_gradient', WORLD_WIDTH, WORLD_HEIGHT);
    generateParticleTextures(this);
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
    // server.js's resetServer handler) — kept small and muted in a corner
    // rather than LobbyScene's louder, plainly-visible version, since *this*
    // screen is the one that may be projected on a TV for the whole event
    // to see.
    const resetButtonHtml = `
      <button id="dashboard-reset-server-button" type="button"
        style="width:70px;height:20px;font-size:10px;padding:0;border-radius:5px;border:1px solid ${BUTTON.dangerBorder};background:#1c0d0dcc;color:${BUTTON.dangerText};cursor:pointer;font-family:${FONT_BODY};">
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

    this.events.once('shutdown', () => {
      this.cleanup();
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
        const { container, borderFlashTimer, minimapTextureKey } = stale;
        // The elimination-flash's pending redraw targets card.cardBorder,
        // which container.destroy() below is about to tear down along with
        // everything else in the card.
        if (borderFlashTimer) {
          borderFlashTimer.remove();
        }
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

    // bg stays a plain Rectangle purely for its native hit-testing
    // (double-click to spectate) — Graphics has no built-in hit area the
    // way Rectangle does, and this card's interaction is the one thing not
    // worth any risk to. Its own border is left off; the rounded outline
    // below is a separate, purely decorative layer drawn at the same
    // bounds, so the square-cornered box the interactive rectangle
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
    });

    const cardBorder = this.add.graphics();
    drawRoundedRect(cardBorder, 0, 0, cardW, cardH, { fillAlpha: 0, strokeWidth: 1, strokeColor: 0xffd700, strokeAlpha: 0.25, radius: 8 });

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

    container.add([minimap, bg, cardBorder, headerBar, label, aliveText, infoText]);

    this.tweens.add({
      targets: container,
      scale: 1,
      alpha: 1,
      duration: 220,
      ease: 'Back.easeOut',
    });

    return {
      container, bg, cardBorder, label, aliveText, infoText,
      minimap, minimapTextureKey, minimapCanvas: null,
      roomId, cardW, cardH, prevAliveCount: null, borderFlashTimer: null,
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
    // This dashboard only ever covers stage 1/2 (see broadcastDashboard() in
    // server.js, currentStage <= 2) — both are SURVIVAL now that the boss
    // mechanic has been removed, so there's no other mode to label here.
    card.label.setText(`${i + 1}조 🏃 생존`);

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
  }

}
