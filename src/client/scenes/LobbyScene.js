import Phaser from 'phaser';

import { getSocket } from '../net/socket';
import { generateBackgroundTexture, generateParticleTextures } from '../utilities/EffectTextures';
import { createAmbientEmbers } from '../utilities/SceneFx';
import { applyButtonFx } from '../utilities/ButtonFx';
import { ensureAnimalTexture } from '../utilities/AnimalTextures';
import { ANIMAL_COUNT } from '../../shared/animals';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../../shared/hexGrid';
import { PUBLIC_SITE_URL } from '../../shared/publicUrl';
import {
  FONT_DISPLAY, FONT_BODY, COLORS, TEXT_STROKE, EVENT_BANNER_TEXT, BUTTON,
} from '../theme/Theme';
import { fitTitlePanel, drawRoundedRect } from '../utilities/RoundedPanel';

// Shrunk from an original 90 (with icon/text layout tightened to match in
// createRosterCell) specifically to fit more columns per row -- at this
// map's actual WORLD_WIDTH (~588px), 90px cells only fit 6 columns with
// ~48px of unused margin left over, so any roster past 6 people immediately
// wrapped into a 2nd row and dragged the whole grid into cellScale's
// shrink-to-fit path (see renderLobby()) far sooner than the available
// width actually required. 68px fits 8, meaningfully raising the number of
// waiting players that render at full, readable size before that shrink
// ever kicks in.
const GRID_CELL_W = 68;
// Shrunk from 32 alongside the bottom controls being collapsed into one
// combined row (see the DOM button block below) -- freed-up vertical
// budget goes toward fitting more rows before cellScale's shrink-to-fit
// kicks in, not toward taller cells with nothing driving the need for it.
const GRID_CELL_H = 28;
// Computed from the live WORLD_WIDTH rather than a fixed count -- a fixed
// GRID_COLS (originally 8, then manually re-tuned down to 6 and 5 as the
// map got narrower for portrait/landscape experiments) kept silently
// overflowing off the right edge of the screen every time MAP_COLS
// (mapConfig.js) changed again for unrelated gameplay-tile-size reasons.
// This adapts automatically instead, with a floor of 3 columns so an
// unusually narrow WORLD_WIDTH still lays out something sane instead of 0.
// Margin trimmed from 40 to 20 alongside the GRID_CELL_W shrink above --
// still enough for comfortable left/right breathing room once centered
// (see renderLobby()'s startX), just no longer wasteful.
const GRID_COLS = Math.max(3, Math.floor((WORLD_WIDTH - 20) / GRID_CELL_W));
// Shifted down from the original 112 to leave room for the event banner
// pinned above the "🔥 대기실" title.
const GRID_START_Y = 138;
// Vertical budget the roster grid is allowed to use before it starts
// overlapping the bottom control bar (reset/clear/mode-toggle/addBot/start,
// all one combined row now -- see the DOM button block below) pinned to the
// very bottom of the screen. 36px covers that single compact row plus a
// small margin -- down from 80px when it was two separate rows (action
// buttons above the mode toggle), which was the single biggest bite out of
// this budget. At MAX_LOBBY_PLAYERS (40) and the current GRID_COLS, this
// keeps cellScale at a full, readable 1 instead of shrinking to its 0.45
// floor and clustering unreadably small in the middle of the screen -- see
// renderLobby()'s cellScale computation.
const GRID_AVAILABLE_HEIGHT = Math.max(GRID_CELL_H, WORLD_HEIGHT - GRID_START_Y - 36);

export default class LobbyScene extends Phaser.Scene {

  constructor() {
    super({
      key: 'LobbyScene',
    });
  }

  create(data) {
    this.socket = getSocket();
    this.rosterCells = {};
    this.cellScale = 1;
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

    // Same warm near-black fade every scene now opens with (see GameScene's
    // identical fadeIn) -- this scene is re-entered every time a round ends
    // and the bracket loops back here, so this fires on every return trip
    // too, not just the very first visit.
    this.cameras.main.fadeIn(400, 13, 8, 5);

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
      stroke: TEXT_STROKE,
      strokeThickness: 2,
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
      stroke: TEXT_STROKE,
      strokeThickness: 2,
    }).setOrigin(0.5);

    this.statusText = this.add.text(WORLD_WIDTH / 2, WORLD_HEIGHT - 70, '', {
      fontFamily: FONT_BODY,
      fontSize: '14px',
      color: COLORS.textGold,
      align: 'center',
      stroke: TEXT_STROKE,
      strokeThickness: 2,
    }).setOrigin(0.5);

    // Everything that used to be two stacked rows (action buttons above,
    // mode toggle below) is now one single row pinned to the very bottom
    // edge of the screen -- freeing up the vertical space the second row
    // used to cost entirely for the roster grid above it (see
    // GRID_AVAILABLE_HEIGHT's own comment), since a crowded lobby needs
    // that room far more than these controls need to be visually separated.
    // Three groups (destructive/reset on the left, the mode toggle centered,
    // routine/frequently-used on the right) in one flex row rather than one
    // undifferentiated cluster, so "게임 시작" -- the one actually pressed
    // every round -- doesn't read as visually interchangeable with the rare,
    // destructive reset buttons next to it.
    const buttonHtml = `
      <div style="display:flex;justify-content:space-between;align-items:center;width:${WORLD_WIDTH - 32}px;">
        <div style="display:flex;gap:8px;">
          <button id="reset-server-button" type="button"
            style="padding:6px 10px;font-size:10px;border-radius:7px;border:1px solid ${BUTTON.dangerBorder};background:${BUTTON.dangerBg};color:${BUTTON.dangerText};cursor:pointer;font-family:${FONT_BODY};">
            서버 초기화
          </button>
          <button id="clear-lobby-button" type="button"
            style="padding:6px 10px;font-size:10px;border-radius:7px;border:1px solid ${BUTTON.secondaryBorder};background:${BUTTON.secondaryBg};color:${BUTTON.secondaryText};cursor:pointer;font-family:${FONT_BODY};">
            초기화
          </button>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <button id="mode-team-button" type="button"
            style="padding:5px 12px;font-size:11px;border-radius:7px;cursor:pointer;font-family:${FONT_BODY};">
            팀전
          </button>
          <button id="mode-solo-button" type="button"
            style="padding:5px 12px;font-size:11px;border-radius:7px;cursor:pointer;font-family:${FONT_BODY};">
            개인전
          </button>
        </div>
        <div style="display:flex;gap:8px;">
          <button id="add-bot-button" type="button"
            style="padding:6px 12px;font-size:11px;border-radius:7px;border:1px solid ${BUTTON.secondaryBorder};background:${BUTTON.secondaryBg};color:${BUTTON.secondaryText};cursor:pointer;font-family:${FONT_BODY};">
            봇 추가
          </button>
          <button id="start-button" type="button"
            style="padding:6px 16px;font-size:12px;border-radius:7px;border:none;background:${BUTTON.primaryBg};color:${BUTTON.primaryText};cursor:pointer;font-family:${FONT_BODY};font-weight:600;">
            게임 시작
          </button>
        </div>
      </div>
    `;
    this.buttonNode = this.add.dom(WORLD_WIDTH / 2, WORLD_HEIGHT - 16).createFromHTML(buttonHtml);
    this.modeTeamButton = this.buttonNode.getChildByID('mode-team-button');
    this.modeSoloButton = this.buttonNode.getChildByID('mode-solo-button');
    applyButtonFx(this.modeTeamButton);
    applyButtonFx(this.modeSoloButton);
    // applyButtonFx already sets its own transition (transform/filter/
    // box-shadow) via a plain assignment, which would silently clobber a
    // transition declared in the button's original inline style -- appended
    // here instead, once, so refreshModeButtons()'s active/inactive color
    // swap below animates smoothly like every other button/input in the
    // app rather than snapping instantly.
    [this.modeTeamButton, this.modeSoloButton].forEach((btn) => {
      btn.style.transition += ', background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease';
    });

    // Sets the three swapped properties directly rather than appending to
    // cssText (the previous approach) -- cssText += kept concatenating a
    // fresh copy of whichever style string was active onto the *existing*
    // string every single toggle, growing unbounded over a long admin
    // session's worth of clicks instead of actually replacing anything.
    const refreshModeButtons = () => {
      const apply = (btn, active) => {
        btn.style.background = active ? BUTTON.primaryBg : `${BUTTON.secondaryBg}cc`;
        btn.style.color = active ? BUTTON.primaryText : BUTTON.secondaryText;
        btn.style.border = active ? `1px solid ${BUTTON.primaryBg}` : `1px solid ${BUTTON.secondaryBorder}`;
      };
      apply(this.modeTeamButton, this.selectedGameMode === 'TEAM');
      apply(this.modeSoloButton, this.selectedGameMode === 'SOLO');
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

    // Every control in this bar (reset/clear/mode-toggle/addBot/start) is
    // admin-only -- hiding the single combined node covers all of them at
    // once now that they're one DOM element instead of needing to hide each
    // child individually.
    if (!this.isAdmin) {
      this.buttonNode.setVisible(false);
    }

    this.handleLobbyUpdate = (payload) => this.renderLobby(payload);
    this.handleGameStarting = (payload) => {
      this.cleanupSocketHandlers();
      this.scene.start('GameScene', payload);
    };
    // Admin-only in practice: stage 1 (and 2) always route the admin to the
    // multi-room dashboard instead of a single room's GameScene — see
    // server.js's 'dashboardStarting' branch in startStage(). A regular
    // player cut from the bracket also ends up on this same dashboard (see
    // seatSpectator()), but always via GameScene's own identical handler at
    // the moment their room finishes, never by receiving this event while
    // sitting in LobbyScene.
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

    // A big roster at a short WORLD_HEIGHT (see GRID_AVAILABLE_HEIGHT's own
    // comment) can need more rows than actually fit before the grid runs
    // into the mode-toggle/action buttons below it -- shrink every cell
    // uniformly so the whole roster stays above those buttons instead.
    // Clamped to 0.45 rather than shrinking indefinitely: past that a cell
    // is too small to read anyway, and an extreme roster is better served
    // by fixing the room count than by an unreadably tiny grid.
    const neededRows = Math.max(1, Math.ceil(entries.length / GRID_COLS));
    const maxRows = Math.max(1, Math.floor(GRID_AVAILABLE_HEIGHT / GRID_CELL_H));
    const cellScale = neededRows > maxRows ? Math.max(0.45, maxRows / neededRows) : 1;
    const spacingW = GRID_CELL_W * cellScale;
    const spacingH = GRID_CELL_H * cellScale;
    const startX = (WORLD_WIDTH - GRID_COLS * spacingW) / 2 + spacingW / 2;

    if (cellScale !== this.cellScale) {
      // Rare (only when the roster crosses a row-count threshold) -- an
      // instant swap rather than an exit tween, since every cell needs to
      // end up at a new size and every entrance below already re-animates
      // them in fresh at the new scale.
      Object.values(this.rosterCells).forEach(({ container }) => container.destroy());
      this.rosterCells = {};
      this.cellScale = cellScale;
    }

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
      const cellX = startX + col * spacingW;
      const cellY = GRID_START_Y + row * spacingH;

      const existing = this.rosterCells[socketId];
      if (existing) {
        if (existing.container.x !== cellX || existing.container.y !== cellY) {
          this.tweens.add({ targets: existing.container, x: cellX, y: cellY, duration: 200, ease: 'Quad.easeOut' });
        }
        return;
      }

      const cell = this.createRosterCell(socketId, entry, cellX, cellY, cellScale);
      this.rosterCells[socketId] = cell;
      this.tweens.add({
        targets: cell.container,
        scale: cellScale,
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

  createRosterCell(socketId, entry, cellX, cellY, cellScale) {
    const container = this.add.container(cellX, cellY).setScale(cellScale * 0.5).setAlpha(0);

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
      // Scaled/positioned down from 0.4 @ x=-30 alongside GRID_CELL_W's own
      // shrink above -- keeps icon+name both fitting inside the now-narrower
      // chip instead of the icon eating space the name needs more.
      const icon = this.add.image(-20, 0, ensureAnimalTexture(this, entry.animalIndex)).setScale(0.28);
      container.add(icon);
    }

    const color = isMe ? '#ffd700' : (entry.isBot ? '#9aa3c9' : '#ffffff');
    const text = this.add.text(-11, 0, entry.nickname, {
      fontFamily: FONT_BODY,
      fontSize: '14px',
      color,
      stroke: TEXT_STROKE,
      strokeThickness: 2,
    }).setOrigin(0, 0.5);
    // Nicknames can be up to NICKNAME_MAX_LENGTH (8) characters — at full
    // Korean-glyph width that's wider than this cell has room for, and
    // was previously left to just overflow straight out the side of the
    // rounded chip. Shrinking to fit (rather than truncating) keeps the
    // full name legible instead of losing characters to an ellipsis.
    const maxTextWidth = 36;
    if (text.width > maxTextWidth) {
      text.setScale(maxTextWidth / text.width);
    }
    container.add(text);

    if (entry.isBot) {
      const badge = this.add.text(-12, -9, '🤖', { fontSize: '8px' }).setOrigin(0.5);
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
