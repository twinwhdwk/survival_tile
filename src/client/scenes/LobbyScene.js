import Phaser from 'phaser';

import { getSocket } from '../net/socket';
import { generateBackgroundTexture, generateParticleTextures } from '../utilities/EffectTextures';
import { createAmbientEmbers } from '../utilities/SceneFx';
import { applyButtonFx } from '../utilities/ButtonFx';
import { ensureAnimalTexture } from '../utilities/AnimalTextures';
import { ANIMAL_COUNT } from '../../shared/animals';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../../shared/hexGrid';
import { PUBLIC_SITE_URL } from '../../shared/publicUrl';
import { FONT_DISPLAY, FONT_BODY, COLORS, TEXT_STROKE, EVENT_BANNER_TEXT } from '../theme/Theme';
import { fitTitlePanel, drawRoundedRect } from '../utilities/RoundedPanel';

// 6 (not the original 8) so 6*GRID_CELL_W stays inside the now-narrower
// portrait-shaped WORLD_WIDTH (see mapConfig.js) with room to spare.
const GRID_COLS = 6;
const GRID_CELL_W = 90;
const GRID_CELL_H = 32;
const GRID_START_X = (WORLD_WIDTH - GRID_COLS * GRID_CELL_W) / 2 + GRID_CELL_W / 2;
// Shifted down from the original 112 to leave room for the event banner
// pinned above the "🔥 대기실" title.
const GRID_START_Y = 138;

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
    // 팀전 (TEAM) is the original bracket this app was built around, so it
    // stays the default — 개인전 (SOLO) is an admin opt-in per tournament,
    // not a per-player choice (a single lobby roster can't be split into
    // two simultaneous modes). Sent along with 'startTournament' below.
    this.selectedGameMode = 'TEAM';

    generateBackgroundTexture(this, 'bg_gradient', WORLD_WIDTH, WORLD_HEIGHT);
    generateParticleTextures(this);
    this.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'bg_gradient').setDepth(-30);
    this.createFloatingAnimals();
    createAmbientEmbers(this);

    // Event banner, pinned to the very top of the screen and sized to read
    // from across the room — separate from (and above) the room's own
    // "🔥 대기실" title below it. See LoginScene for the matching banner.
    this.add.text(WORLD_WIDTH / 2, 22, EVENT_BANNER_TEXT, {
      fontFamily: FONT_DISPLAY,
      fontSize: '28px',
      color: COLORS.textGold,
      stroke: TEXT_STROKE,
      strokeThickness: 5,
    }).setOrigin(0.5).setShadow(0, 0, '#ff6622', 10, true, true);

    this.add.text(WORLD_WIDTH / 2, 58, `참가 주소: ${PUBLIC_SITE_URL}`, {
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
    // copy scaled independently of the main title and drifted out of
    // alignment, reading as a stray duplicate/shadow instead of a soft
    // glow. See LoginScene for the same fix.
    this.titleText = this.add.text(WORLD_WIDTH / 2, 90, '🔥 대기실', {
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
    fitTitlePanel(titlePanel, WORLD_WIDTH / 2, 93, 34, this.titleText, 28);

    this.countText = this.add.text(WORLD_WIDTH / 2, 120, '', {
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

    // Segmented mode toggle, admin-only, sitting just above the action
    // row — kept as two plain buttons rather than a native <select>/radio
    // pair so the active state can reuse the same visual language
    // (filled/outlined) as every other button here instead of a form
    // control that would look out of place against the rest of the UI.
    const modeToggleHtml = `
      <div style="display:flex;gap:8px;align-items:center;">
        <button id="mode-team-button" type="button"
          style="padding:8px 16px;font-size:13px;border-radius:8px;cursor:pointer;font-family:${FONT_BODY};">
          팀전
        </button>
        <button id="mode-solo-button" type="button"
          style="padding:8px 16px;font-size:13px;border-radius:8px;cursor:pointer;font-family:${FONT_BODY};">
          개인전
        </button>
      </div>
    `;
    this.modeToggleNode = this.add.dom(WORLD_WIDTH / 2, WORLD_HEIGHT - 76).createFromHTML(modeToggleHtml);
    this.modeTeamButton = this.modeToggleNode.getChildByID('mode-team-button');
    this.modeSoloButton = this.modeToggleNode.getChildByID('mode-solo-button');
    applyButtonFx(this.modeTeamButton);
    applyButtonFx(this.modeSoloButton);

    const refreshModeButtons = () => {
      const activeStyle = `background:#f59e0b;color:#1c130d;border:1px solid #f59e0b;`;
      const inactiveStyle = `background:#1c130dcc;color:#ffd9a0;border:1px solid #ffa94d55;`;
      this.modeTeamButton.style.cssText += this.selectedGameMode === 'TEAM' ? activeStyle : inactiveStyle;
      this.modeSoloButton.style.cssText += this.selectedGameMode === 'SOLO' ? activeStyle : inactiveStyle;
    };
    refreshModeButtons();

    this.modeTeamButton.addEventListener('click', () => {
      this.selectedGameMode = 'TEAM';
      refreshModeButtons();
    });
    this.modeSoloButton.addEventListener('click', () => {
      this.selectedGameMode = 'SOLO';
      refreshModeButtons();
    });

    const buttonHtml = `
      <div style="display:flex;gap:12px;align-items:center;">
        <button id="reset-server-button" type="button"
          style="padding:14px 16px;font-size:14px;border-radius:10px;border:none;background:#7f1d1d;color:#ffffff;cursor:pointer;font-family:${FONT_BODY};">
          서버 초기화
        </button>
        <button id="clear-lobby-button" type="button"
          style="padding:14px 16px;font-size:14px;border-radius:10px;border:none;background:#4b5563;color:#ffffff;cursor:pointer;font-family:${FONT_BODY};">
          초기화
        </button>
        <button id="add-bot-button" type="button"
          style="padding:14px 20px;font-size:16px;border-radius:10px;border:none;background:#6366f1;color:#ffffff;cursor:pointer;font-family:${FONT_BODY};">
          봇 추가
        </button>
        <button id="start-button" type="button"
          style="padding:14px 28px;font-size:18px;border-radius:10px;border:none;background:#10b981;color:#ffffff;cursor:pointer;font-family:${FONT_BODY};">
          게임 시작
        </button>
      </div>
    `;
    this.buttonNode = this.add.dom(WORLD_WIDTH / 2, WORLD_HEIGHT - 30).createFromHTML(buttonHtml);
    this.startButton = this.buttonNode.getChildByID('start-button');
    this.addBotButton = this.buttonNode.getChildByID('add-bot-button');
    this.clearLobbyButton = this.buttonNode.getChildByID('clear-lobby-button');
    this.resetServerButton = this.buttonNode.getChildByID('reset-server-button');
    applyButtonFx(this.startButton);
    applyButtonFx(this.addBotButton);
    applyButtonFx(this.clearLobbyButton);
    applyButtonFx(this.resetServerButton);

    this.startButton.addEventListener('click', () => {
      this.socket.emit('startTournament', { mode: this.selectedGameMode });
    });
    this.addBotButton.addEventListener('click', () => {
      this.socket.emit('addBot');
    });
    // A full reset, not just a stale-entry sweep — removes every bot plus
    // force-disconnects every currently-connected non-admin real player
    // too (see server.js's clearLobby handler). That's a real, immediate
    // consequence for anyone actually waiting in the lobby right now, and
    // this button otherwise looks identical to any other lobby button, so
    // a plain native confirm() (no custom modal — stays within "simple,
    // no added UI") guards against a stray misclick during a live event.
    this.clearLobbyButton.addEventListener('click', () => {
      if (!window.confirm('초기화하면 현재 접속 중인 참가자도 모두 퇴장됩니다. 계속할까요?')) {
        return;
      }
      this.socket.emit('clearLobby');
    });
    // A soft reset (see server.js's resetServer handler) — the Node process
    // itself keeps running (no downtime), but every in-progress room and
    // the whole tournament bracket get torn down, not just the lobby
    // roster, so this reaches further than 초기화 above and works from any
    // phase. Meant as an emergency "start over" if a tournament gets stuck,
    // not routine cleanup — the darker red button color plus its own,
    // more explicit confirm() wording both signal that distinction.
    this.resetServerButton.addEventListener('click', () => {
      if (!window.confirm('서버를 초기화하면 진행 중인 모든 게임이 즉시 종료되고 모든 참가자가 로그인 화면으로 돌아갑니다. 계속할까요?')) {
        return;
      }
      this.socket.emit('resetServer');
    });

    if (!this.isAdmin) {
      this.startButton.style.display = 'none';
      this.addBotButton.style.display = 'none';
      this.clearLobbyButton.style.display = 'none';
      this.resetServerButton.style.display = 'none';
      this.modeToggleNode.setVisible(false);
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
    // Counts only newly-created cells this pass, separately from `i` (each
    // entry's position in the *full* roster) -- staggering brand-new cells
    // by their absolute roster index meant a single bot added on top of an
    // already-large roster (e.g. the 31st player) wouldn't even start
    // popping in until i*25 = 750ms after the click, well past what reads
    // as an instant response to your own action. New cells now stagger
    // against each other instead, starting at 0 regardless of how many
    // already-settled cells sit ahead of them in the grid.
    let newCellIndex = 0;
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
        delay: newCellIndex * 25,
        duration: 220,
        ease: 'Back.easeOut',
      });
      newCellIndex += 1;
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
      this.modeTeamButton.disabled = true;
      this.modeSoloButton.disabled = true;
      this.stopStatusPulse();
    } else if (this.isAdmin) {
      this.statusText.setText('');
      this.startButton.disabled = false;
      this.addBotButton.disabled = false;
      this.clearLobbyButton.disabled = false;
      this.modeTeamButton.disabled = false;
      this.modeSoloButton.disabled = false;
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
    // Nicknames can be up to NICKNAME_MAX_LENGTH (8) characters — at full
    // Korean-glyph width that's wider than this cell has room for, and
    // was previously left to just overflow straight out the side of the
    // rounded chip. Shrinking to fit (rather than truncating) keeps the
    // full name legible instead of losing characters to an ellipsis.
    const maxTextWidth = 50;
    if (text.width > maxTextWidth) {
      text.setScale(maxTextWidth / text.width);
    }
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
