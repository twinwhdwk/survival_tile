import Phaser from 'phaser';

import { getSocket } from '../net/socket';
import { generateBackgroundTexture, generateParticleTextures } from '../utilities/EffectTextures';
import { createAmbientEmbers } from '../utilities/SceneFx';
import { applyButtonFx } from '../utilities/ButtonFx';
import { ensureAnimalTexture } from '../utilities/AnimalTextures';
import { ANIMAL_COUNT } from '../../shared/animals';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../../shared/hexGrid';
import { PUBLIC_SITE_URL } from '../../shared/publicUrl';
import { FONT_DISPLAY, FONT_BODY, COLORS, TEXT_STROKE } from '../theme/Theme';
import { fitTitlePanel, drawRoundedRect } from '../utilities/RoundedPanel';

const GRID_COLS = 8;
const GRID_CELL_W = 90;
const GRID_CELL_H = 32;
const GRID_START_X = (WORLD_WIDTH - GRID_COLS * GRID_CELL_W) / 2 + GRID_CELL_W / 2;
const GRID_START_Y = 112;

export default class LobbyScene extends Phaser.Scene {

  constructor() {
    super({
      key: 'LobbyScene',
    });
  }

  create(data) {
    this.socket = getSocket();
    this.rosterCells = {};
    this.isAdmin = !!data.isAdmin;
    this.statusPulseTween = null;

    generateBackgroundTexture(this, 'bg_gradient', WORLD_WIDTH, WORLD_HEIGHT);
    generateParticleTextures(this);
    this.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'bg_gradient').setDepth(-30);
    this.createFloatingAnimals();
    createAmbientEmbers(this);

    this.add.text(WORLD_WIDTH / 2, 20, `참가 주소: ${PUBLIC_SITE_URL}`, {
      fontFamily: FONT_BODY,
      fontSize: '18px',
      color: COLORS.textInfo,
    }).setOrigin(0.5);

    // Same warm ember-bordered panel language as every other HUD readout in
    // the app (GameScene's timer/score panels, ResultScene/DashboardScene's
    // headline) — keeps the title grounded instead of floating bare over
    // the background like it was before.
    const titlePanel = this.add.graphics();

    // A single title with a drop shadow for the "burning" mood, rather than
    // a second overlapping emoji text — the previous additive-blend glow
    // copy scaled independently of the main title (flickerTitleGlow) and
    // drifted out of alignment, reading as a stray duplicate/shadow instead
    // of a soft glow. See LoginScene for the same fix.
    this.titleText = this.add.text(WORLD_WIDTH / 2, 52, '🔥 대기실', {
      fontFamily: FONT_DISPLAY,
      fontSize: '26px',
      color: '#ffffff',
      stroke: TEXT_STROKE,
      strokeThickness: 4,
    }).setOrigin(0.5).setShadow(0, 0, '#ff6622', 12, true, true);
    // See LoginScene's title panel fix — rounded rather than a flat
    // square-cornered box, and getBounds() (what GameScene's own HUD
    // panels already use) reflects the emoji glyph's real drawn extent,
    // unlike plain .width.
    fitTitlePanel(titlePanel, WORLD_WIDTH / 2, 55, 34, this.titleText, 28);

    this.countText = this.add.text(WORLD_WIDTH / 2, 82, '', {
      fontFamily: FONT_BODY,
      fontSize: '14px',
      color: COLORS.textMuted,
    }).setOrigin(0.5);

    this.statusText = this.add.text(WORLD_WIDTH / 2, WORLD_HEIGHT - 70, '', {
      fontFamily: FONT_BODY,
      fontSize: '14px',
      color: COLORS.textGold,
      align: 'center',
    }).setOrigin(0.5);

    const buttonHtml = `
      <div style="display:flex;gap:12px;align-items:center;">
        <button id="clear-lobby-button" type="button"
          style="padding:14px 16px;font-size:14px;border-radius:10px;border:none;background:#4b5563;color:#ffffff;cursor:pointer;font-family:'Gothic A1','Malgun Gothic',sans-serif;">
          초기화
        </button>
        <button id="add-bot-button" type="button"
          style="padding:14px 20px;font-size:16px;border-radius:10px;border:none;background:#6366f1;color:#ffffff;cursor:pointer;font-family:'Gothic A1','Malgun Gothic',sans-serif;">
          봇 추가
        </button>
        <button id="start-button" type="button"
          style="padding:14px 28px;font-size:18px;border-radius:10px;border:none;background:#10b981;color:#ffffff;cursor:pointer;font-family:'Gothic A1','Malgun Gothic',sans-serif;">
          게임 시작
        </button>
      </div>
    `;
    this.buttonNode = this.add.dom(WORLD_WIDTH / 2, WORLD_HEIGHT - 30).createFromHTML(buttonHtml);
    this.startButton = this.buttonNode.getChildByID('start-button');
    this.addBotButton = this.buttonNode.getChildByID('add-bot-button');
    this.clearLobbyButton = this.buttonNode.getChildByID('clear-lobby-button');
    applyButtonFx(this.startButton);
    applyButtonFx(this.addBotButton);
    applyButtonFx(this.clearLobbyButton);

    this.startButton.addEventListener('click', () => {
      this.socket.emit('startTournament');
    });
    this.addBotButton.addEventListener('click', () => {
      this.socket.emit('addBot');
    });
    // Removes bots (which have no real socket, so nothing ever cleans them
    // up if a test session ends without starting the tournament) and any
    // lobby entry whose socket has actually disconnected — never touches a
    // currently-connected real player.
    this.clearLobbyButton.addEventListener('click', () => {
      this.socket.emit('clearLobby');
    });

    if (!this.isAdmin) {
      this.startButton.style.display = 'none';
      this.addBotButton.style.display = 'none';
      this.clearLobbyButton.style.display = 'none';
    }

    this.handleLobbyUpdate = (payload) => this.renderLobby(payload);
    this.handleGameStarting = (payload) => {
      this.cleanupSocketHandlers();
      this.scene.start('GameScene', payload);
    };
    // Admin-only: stage 1 (and 2) always route the admin to the multi-room
    // dashboard instead of a single room's GameScene — see server.js's
    // 'dashboardStarting' branch in startStage(). Regular players never
    // receive this event, only 'gameStarting' above.
    this.handleDashboardStarting = (payload) => {
      this.cleanupSocketHandlers();
      this.scene.start('DashboardScene', payload);
    };

    this.socket.on('lobbyUpdate', this.handleLobbyUpdate);
    this.socket.on('gameStarting', this.handleGameStarting);
    this.socket.on('dashboardStarting', this.handleDashboardStarting);

    this.events.once('shutdown', () => this.cleanupSocketHandlers());

    this.renderLobby(data);
  }

  cleanupSocketHandlers() {
    this.socket.off('lobbyUpdate', this.handleLobbyUpdate);
    this.socket.off('gameStarting', this.handleGameStarting);
    this.socket.off('dashboardStarting', this.handleDashboardStarting);
  }

  renderLobby({ players, phase }) {
    const entries = Object.entries(players || {});
    this.countText.setText(`${entries.length}명 참가 중`);

    // Keyed by socketId (same diffing approach as DashboardScene's room
    // cards) rather than destroying and rebuilding the whole grid on every
    // 'lobbyUpdate' — that used to replay every existing player's entrance
    // pop-in animation each time anyone joined/left (e.g. clicking "봇 추가"
    // a few times in a row made the whole roster visibly flicker).
    const seenIds = new Set();
    entries.forEach(([socketId, entry], i) => {
      seenIds.add(socketId);
      const col = i % GRID_COLS;
      const row = Math.floor(i / GRID_COLS);
      const cellX = GRID_START_X + col * GRID_CELL_W;
      const cellY = GRID_START_Y + row * GRID_CELL_H;

      const existing = this.rosterCells[socketId];
      if (existing) {
        if (existing.container.x !== cellX || existing.container.y !== cellY) {
          this.tweens.add({ targets: existing.container, x: cellX, y: cellY, duration: 200, ease: 'Quad.easeOut' });
        }
        return;
      }

      const cell = this.createRosterCell(socketId, entry, cellX, cellY);
      this.rosterCells[socketId] = cell;
      this.tweens.add({
        targets: cell.container,
        scale: 1,
        alpha: 1,
        delay: i * 25,
        duration: 220,
        ease: 'Back.easeOut',
      });
    });

    Object.keys(this.rosterCells).forEach((socketId) => {
      if (!seenIds.has(socketId)) {
        // A quick fade/shrink out rather than an instant pop, matching the
        // entrance animation's own polish — most noticeable on 초기화
        // (reset), where every cell would otherwise vanish in one frame.
        const { container } = this.rosterCells[socketId];
        this.tweens.add({
          targets: container,
          scale: 0.5,
          alpha: 0,
          duration: 150,
          ease: 'Quad.easeIn',
          onComplete: () => container.destroy(),
        });
        delete this.rosterCells[socketId];
      }
    });

    if (phase === 'TOURNAMENT') {
      this.statusText.setText('토너먼트 진행 중입니다. 곧 다음 게임에 자동 참여합니다.');
      this.startButton.disabled = true;
      this.addBotButton.disabled = true;
      this.clearLobbyButton.disabled = true;
      this.stopStatusPulse();
    } else if (this.isAdmin) {
      this.statusText.setText('');
      this.startButton.disabled = false;
      this.addBotButton.disabled = false;
      this.clearLobbyButton.disabled = false;
      this.stopStatusPulse();
    } else {
      this.statusText.setText('관리자가 게임을 시작하기를 기다리는 중...');
      this.startStatusPulse();
    }
  }

  createRosterCell(socketId, entry, cellX, cellY) {
    const container = this.add.container(cellX, cellY).setScale(0.5).setAlpha(0);

    // Same "find myself instantly" idea as the in-round gold nickname/
    // spotlight ring, applied here too — a player waiting in a crowded
    // lobby grid has the same problem finding their own entry. Rounded
    // (smaller radius than the title panels' — this cell is only 24px
    // tall, and the default radius would look almost pill-shaped) rather
    // than a flat square-cornered chip, matching the rest of the app.
    const isMe = socketId === this.socket.id;
    const bg = this.add.graphics();
    drawRoundedRect(bg, 0, 0, GRID_CELL_W - 10, GRID_CELL_H - 8, {
      radius: 6,
      fillColor: isMe ? 0x3a2f0a : COLORS.panelFill,
      fillAlpha: isMe ? 0.6 : COLORS.panelFillAlpha,
      strokeColor: isMe ? 0xffd700 : COLORS.panelBorder,
      strokeAlpha: isMe ? 0.7 : COLORS.panelBorderAlpha,
    });
    container.add(bg);

    if (isMe) {
      this.tweens.add({
        targets: bg,
        alpha: 0.75,
        duration: 700,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    if (Number.isInteger(entry.animalIndex)) {
      const icon = this.add.image(-30, 0, ensureAnimalTexture(this, entry.animalIndex)).setScale(0.4);
      container.add(icon);
    }

    const color = isMe ? '#ffd700' : (entry.isBot ? '#9aa3c9' : '#ffffff');
    const text = this.add.text(-16, 0, entry.nickname, {
      fontFamily: FONT_BODY,
      fontSize: '14px',
      color,
    }).setOrigin(0, 0.5);
    container.add(text);

    if (entry.isBot) {
      const badge = this.add.text(-18, -10, '🤖', { fontSize: '9px' }).setOrigin(0.5);
      container.add(badge);
    }

    return { container };
  }

  startStatusPulse() {
    if (this.statusPulseTween) {
      return;
    }
    this.statusText.setAlpha(1);
    this.statusPulseTween = this.tweens.add({
      targets: this.statusText,
      alpha: 0.4,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  stopStatusPulse() {
    if (this.statusPulseTween) {
      this.statusPulseTween.stop();
      this.statusPulseTween = null;
      this.statusText.setAlpha(1);
    }
  }

  createFloatingAnimals() {
    const count = 6;
    for (let i = 0; i < count; i++) {
      const idx = Phaser.Math.Between(0, ANIMAL_COUNT - 1);
      const x = Phaser.Math.Between(30, WORLD_WIDTH - 30);
      const y = Phaser.Math.Between(WORLD_HEIGHT - 90, WORLD_HEIGHT - 20);
      const icon = this.add.image(x, y, ensureAnimalTexture(this, idx))
        .setAlpha(0.12)
        .setScale(1.3)
        .setDepth(-20);

      this.tweens.add({
        targets: icon,
        y: y - Phaser.Math.Between(15, 30),
        duration: 2200 + Math.random() * 1400,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

}
