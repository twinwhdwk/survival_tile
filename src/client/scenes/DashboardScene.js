import Phaser from 'phaser';

import { getSocket } from '../net/socket';
import { generateBackgroundTexture, generateParticleTextures } from '../utilities/EffectTextures';
import { createAmbientEmbers } from '../utilities/SceneFx';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../../shared/hexGrid';
import { MAP_COLS, MAP_ROWS, TILE_STATE } from '../../shared/mapConfig';
import { FONT_DISPLAY, FONT_BODY, COLORS, TEXT_STROKE } from '../theme/Theme';

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
    this.cardsByRoomId = {};
    this.selectedRoomId = null;

    generateBackgroundTexture(this, 'bg_gradient', WORLD_WIDTH, WORLD_HEIGHT);
    generateParticleTextures(this);
    this.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'bg_gradient').setDepth(-30);
    createAmbientEmbers(this);

    // Same warm ember-bordered panel language as every other HUD readout
    // (GameScene's timer/score panels, ResultScene's headline).
    this.titlePanel = this.add.rectangle(WORLD_WIDTH / 2, 14, 10, 34, COLORS.panelFill, COLORS.panelFillAlpha)
      .setOrigin(0.5, 0).setStrokeStyle(COLORS.panelBorderWidth, COLORS.panelBorder, COLORS.panelBorderAlpha);

    // A single title with a drop shadow for the "burning" mood, rather than
    // a second overlapping emoji text — the previous additive-blend glow
    // copy scaled independently of the main title (flickerTitleGlow) and
    // drifted out of alignment, reading as a stray duplicate/shadow instead
    // of a soft glow. See LoginScene for the same fix.
    this.titleText = this.add.text(WORLD_WIDTH / 2, 28, `🔥 ${this.stage}라운드 조별 현황`, {
      fontFamily: FONT_DISPLAY,
      fontSize: '22px',
      color: '#ffffff',
      stroke: TEXT_STROKE,
      strokeThickness: 4,
    }).setOrigin(0.5).setShadow(0, 0, '#ff6622', 12, true, true);
    this.titlePanel.setSize(this.titleText.width + 36, 34);

    this.hintText = this.add.text(WORLD_WIDTH / 2, 50, '클릭: 대상 지정 (C/S 스킬)  ·  더블클릭: 게임 화면 보기', {
      fontFamily: FONT_BODY,
      fontSize: '12px',
      color: COLORS.textMuted,
    }).setOrigin(0.5);

    this.emptyText = this.add.text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, '현황을 불러오는 중...', {
      fontFamily: FONT_BODY,
      fontSize: '16px',
      color: COLORS.textMuted,
    }).setOrigin(0.5);

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
  // nothing further to wire up here.
  spectateRoom(roomId) {
    this.socket.emit('adminSpectateRoom', { roomId });
  }

  triggerAdminSkill(eventName) {
    if (!this.selectedRoomId || !this.cardsByRoomId[this.selectedRoomId]) {
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
      if (!card || card.cardW !== layout.cardW || card.cardH !== layout.cardH) {
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
      card.container.setPosition(
        layout.startX + col * (layout.cardW + CARD_GAP),
        layout.startY + row * (layout.cardH + CARD_GAP),
      );

      this.updateCardContent(card, summary, i);
    });

    Object.keys(this.cardsByRoomId).forEach((roomId) => {
      if (!seenIds.has(roomId)) {
        const stale = this.cardsByRoomId[roomId];
        stale.container.destroy();
        if (stale.minimapTextureKey && this.textures.exists(stale.minimapTextureKey)) {
          this.textures.remove(stale.minimapTextureKey);
        }
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
      this.textures.createCanvas(minimapTextureKey, minimapWidth, minimapHeight);
    }
    const minimapInnerW = cardW - 16;
    const minimapInnerH = cardH - 46;
    const minimap = this.add.image(0, 20, minimapTextureKey)
      .setDisplaySize(minimapInnerW, Math.max(minimapInnerH, 10));

    const bg = this.add.rectangle(0, 0, cardW, cardH, COLORS.panelFill, 0.35)
      .setStrokeStyle(1, 0xffd700, 0.25)
      .setInteractive({ useHandCursor: true });

    let lastClickAt = 0;
    bg.on('pointerdown', () => {
      const now = Date.now();
      if (now - lastClickAt < DOUBLE_CLICK_MS) {
        lastClickAt = 0;
        this.spectateRoom(roomId);
        return;
      }
      lastClickAt = now;
      this.selectRoom(roomId);
    });

    // A distinct ring (not just re-coloring bg's own border) so the
    // persistent "this room is targeted" state never fights with the
    // temporary red elimination-flash on bg itself.
    const selectionRing = this.add.rectangle(0, 0, cardW + 8, cardH + 8, 0x000000, 0)
      .setStrokeStyle(3, 0x55ddff, 1).setVisible(false);

    // Header strip: solid backing so text stays readable over the
    // thumbnail, holding the group label + alive count + timer/score.
    const headerBar = this.add.rectangle(0, -cardH / 2 + 20, cardW, 40, COLORS.panelFill, 0.82)
      .setStrokeStyle(COLORS.panelBorderWidth, COLORS.panelBorder, COLORS.panelBorderAlpha);

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

    container.add([minimap, bg, selectionRing, headerBar, label, aliveText, infoText, hpBarBg, hpBarFill]);

    this.tweens.add({
      targets: container,
      scale: 1,
      alpha: 1,
      duration: 220,
      ease: 'Back.easeOut',
    });

    return {
      container, bg, selectionRing, label, aliveText, infoText, hpBarBg, hpBarFill,
      minimap, minimapTextureKey, minimapCanvas: null,
      roomId, cardW, cardH, prevAliveCount: null, lowHpTween: null,
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
      this.tweens.killTweensOf(card.bg);
      card.bg.setStrokeStyle(2, 0xff4444, 0.9);
      this.tweens.add({
        targets: card.bg,
        duration: 500,
        onComplete: () => card.bg.setStrokeStyle(1, 0xffd700, 0.25),
      });
      this.tweens.add({
        targets: card.container,
        x: card.container.x + Phaser.Math.Between(-4, 4),
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
}
