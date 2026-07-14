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
    this.rosterTexts = [];
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
    this.add.rectangle(WORLD_WIDTH / 2, 38, 130, 34, COLORS.panelFill, COLORS.panelFillAlpha)
      .setOrigin(0.5, 0).setStrokeStyle(COLORS.panelBorderWidth, COLORS.panelBorder, COLORS.panelBorderAlpha);

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
    this.rosterTexts.forEach((text) => text.destroy());
    this.rosterTexts = [];

    const entries = Object.entries(players || {});
    this.countText.setText(`${entries.length}명 참가 중`);

    entries.forEach(([socketId, entry], i) => {
      const col = i % GRID_COLS;
      const row = Math.floor(i / GRID_COLS);
      const cellX = GRID_START_X + col * GRID_CELL_W;
      const cellY = GRID_START_Y + row * GRID_CELL_H;

      const cell = this.add.container(cellX, cellY).setScale(0.5).setAlpha(0);

      // Same "find myself instantly" idea as the in-round gold nickname/
      // spotlight ring, applied here too — a player waiting in a crowded
      // lobby grid has the same problem finding their own entry.
      const isMe = socketId === this.socket.id;
      const bg = this.add.rectangle(0, 0, GRID_CELL_W - 10, GRID_CELL_H - 8,
        isMe ? 0x3a2f0a : COLORS.panelFill, isMe ? 0.6 : COLORS.panelFillAlpha)
        .setStrokeStyle(COLORS.panelBorderWidth, isMe ? 0xffd700 : COLORS.panelBorder, isMe ? 0.7 : COLORS.panelBorderAlpha);
      cell.add(bg);

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
        cell.add(icon);
      }

      const color = isMe ? '#ffd700' : (entry.isBot ? '#9aa3c9' : '#ffffff');
      const text = this.add.text(-16, 0, entry.nickname, {
        fontFamily: FONT_BODY,
        fontSize: '14px',
        color,
      }).setOrigin(0, 0.5);
      cell.add(text);

      if (entry.isBot) {
        const badge = this.add.text(-18, -10, '🤖', { fontSize: '9px' }).setOrigin(0.5);
        cell.add(badge);
      }

      this.tweens.add({
        targets: cell,
        scale: 1,
        alpha: 1,
        delay: i * 25,
        duration: 220,
        ease: 'Back.easeOut',
      });

      this.rosterTexts.push(cell);
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
