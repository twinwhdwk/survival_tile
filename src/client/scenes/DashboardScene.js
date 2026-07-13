import Phaser from 'phaser';

import { getSocket } from '../net/socket';
import { generateBackgroundTexture, generateParticleTextures } from '../utilities/EffectTextures';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../../shared/hexGrid';

const CARD_W = 200;
const CARD_H = 130;
const CARD_GAP = 16;

// Admin-only multi-room overview for stage 1/2 (see server.js's
// 'dashboardStarting' branch in startStage()) — once the bracket has
// several simultaneous rooms, watching one full board in detail is less
// useful than seeing every group's status at a glance. Deliberately a
// simplified summary grid, not N live rendered boards: a full per-tile
// render of up to 8 rooms at once would be both expensive and unreadable
// at that size, and the admin mainly needs "who's still alive / how much
// time is left / who's ahead", not the tile-by-tile detail.
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
    this.createAmbientEmbers();

    // Same dark backing-panel language as every other HUD readout
    // (GameScene's timer/score panels, ResultScene's headline) — without
    // one this title was the only headline in the app just floating
    // directly over the background.
    this.titlePanel = this.add.rectangle(WORLD_WIDTH / 2, 14, 10, 34, 0x0b0e1c, 0.55)
      .setOrigin(0.5, 0).setStrokeStyle(1, 0xffffff, 0.08);

    const titleGlow = this.add.text(WORLD_WIDTH / 2, 28, `🔥 ${this.stage}라운드 조별 현황`, {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '22px',
      color: '#ff6622',
    }).setOrigin(0.5).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.35);
    this.flickerTitleGlow(titleGlow);

    this.titleText = this.add.text(WORLD_WIDTH / 2, 28, `🔥 ${this.stage}라운드 조별 현황`, {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '22px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5);
    this.titlePanel.setSize(this.titleText.width + 36, 34);
    console.log('[DEBUG]', 'panel.x=', this.titlePanel.x, 'panel.width=', this.titlePanel.width, 'panel.originX=', this.titlePanel.originX, 'text.x=', this.titleText.x, 'text.width=', this.titleText.width, 'WORLD_WIDTH=', WORLD_WIDTH);

    this.emptyText = this.add.text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, '현황을 불러오는 중...', {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '16px',
      color: '#aaaaaa',
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
    // that nobody watching can tell an intervention happened.
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

  // Same torch-flicker glow used on every other title in the app.
  flickerTitleGlow(glow) {
    const step = () => {
      this.tweens.add({
        targets: glow,
        alpha: Phaser.Math.FloatBetween(0.25, 0.6),
        scale: Phaser.Math.FloatBetween(1.02, 1.16),
        duration: Phaser.Math.Between(90, 220),
        ease: 'Sine.easeInOut',
        onComplete: step,
      });
    };
    step();
  }

  createAmbientEmbers() {
    this.add.particles('particle_spark').setDepth(-15).createEmitter({
      x: { min: 0, max: WORLD_WIDTH },
      y: WORLD_HEIGHT + 10,
      speedY: { min: -14, max: -6 },
      speedX: { min: -4, max: 4 },
      lifespan: { min: 5000, max: 8000 },
      scale: { start: 0.5, end: 0.1 },
      alpha: { start: 0.22, end: 0 },
      tint: [0xff8844, 0xff5533, 0xffcc55],
      frequency: 350,
      quantity: 1,
    });
  }

  renderDashboard({ stage, rooms }) {
    this.stage = stage;
    this.emptyText.setVisible(rooms.length === 0);

    // Stage 1 expects up to ~8 simultaneous groups, stage 2 up to ~4 (each
    // stage roughly halves the room count via mergeAdjacentLineages) — a
    // narrower grid for stage 2 reads as "fewer, bigger groups remain"
    // rather than just re-using the same dense 4-column layout throughout.
    const cols = stage <= 1 ? 4 : 2;
    const totalWidth = cols * CARD_W + (cols - 1) * CARD_GAP;
    const startX = (WORLD_WIDTH - totalWidth) / 2 + CARD_W / 2;
    const startY = 90;

    const seenIds = new Set();
    rooms.forEach((summary, i) => {
      seenIds.add(summary.roomId);
      let card = this.cardsByRoomId[summary.roomId];
      if (!card) {
        card = this.createCard(summary.roomId);
        this.cardsByRoomId[summary.roomId] = card;
      }

      const col = i % cols;
      const row = Math.floor(i / cols);
      card.container.setPosition(
        startX + col * (CARD_W + CARD_GAP),
        startY + row * (CARD_H + CARD_GAP) + CARD_H / 2,
      );

      this.updateCardContent(card, summary, i);
    });

    Object.keys(this.cardsByRoomId).forEach((roomId) => {
      if (!seenIds.has(roomId)) {
        this.cardsByRoomId[roomId].container.destroy();
        delete this.cardsByRoomId[roomId];
        if (this.selectedRoomId === roomId) {
          this.selectedRoomId = null;
        }
      }
    });
  }

  createCard(roomId) {
    const container = this.add.container(0, 0).setScale(0.7).setAlpha(0);

    const bg = this.add.rectangle(0, 0, CARD_W, CARD_H, 0x0b0e1c, 0.6)
      .setStrokeStyle(1, 0xffd700, 0.25)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.selectRoom(roomId));

    // A distinct ring (not just re-coloring bg's own border) so the
    // persistent "this room is targeted" state never fights with the
    // temporary red elimination-flash on bg itself.
    const selectionRing = this.add.rectangle(0, 0, CARD_W + 8, CARD_H + 8, 0x000000, 0)
      .setStrokeStyle(3, 0x55ddff, 1).setVisible(false);

    const label = this.add.text(0, -CARD_H / 2 + 18, '', {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '15px',
      color: '#ffd700',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5);
    const aliveText = this.add.text(0, -14, '', {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '14px',
      color: '#ffffff',
    }).setOrigin(0.5);
    const infoText = this.add.text(0, 10, '', {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '13px',
      color: '#ffffff',
      align: 'center',
      lineSpacing: 6,
    }).setOrigin(0.5);
    const hpBarBg = this.add.rectangle(0, CARD_H / 2 - 18, CARD_W - 30, 8, 0x222222).setVisible(false);
    const hpBarFill = this.add.rectangle(-(CARD_W - 30) / 2, CARD_H / 2 - 18, CARD_W - 30, 6, 0xff4444)
      .setOrigin(0, 0.5).setVisible(false);

    container.add([bg, selectionRing, label, aliveText, infoText, hpBarBg, hpBarFill]);

    this.tweens.add({
      targets: container,
      scale: 1,
      alpha: 1,
      duration: 220,
      ease: 'Back.easeOut',
    });

    return {
      container, bg, selectionRing, label, aliveText, infoText, hpBarBg, hpBarFill,
      roomId, prevAliveCount: null, lowHpTween: null,
    };
  }

  updateCardContent(card, summary, i) {
    const modeLabel = summary.mode === 'BOSS' ? '⚔️ 보스전' : '🏃 생존';
    card.label.setText(`${i + 1}조 ${modeLabel}`);

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
    card.infoText.setText(`점수 ${summary.score}\n남은시간 ${timerStr}`);

    if (summary.boss) {
      card.hpBarBg.setVisible(true);
      card.hpBarFill.setVisible(true);
      const ratio = summary.boss.maxHp > 0 ? Math.max(0, summary.boss.hp / summary.boss.maxHp) : 0;
      card.hpBarFill.setSize((CARD_W - 30) * ratio, 6);

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
