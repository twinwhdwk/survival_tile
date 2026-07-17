import Phaser from 'phaser';

import { getSocket } from '../net/socket';
import { getNickname } from '../net/session';
import { generateBackgroundTexture, generateParticleTextures } from '../utilities/EffectTextures';
import { createAmbientEmbers } from '../utilities/SceneFx';
import { applyButtonFx } from '../utilities/ButtonFx';
import { playVictory } from '../utilities/SoundFx';
import { vibrateVictory } from '../utilities/Haptics';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../../shared/hexGrid';
import {
  FONT_DISPLAY, FONT_BODY, COLORS, TEXT_STROKE, BUTTON,
} from '../theme/Theme';
import { drawRoundedPanel, drawRoundedRect } from '../utilities/RoundedPanel';

export default class ResultScene extends Phaser.Scene {

  constructor() {
    super({
      key: 'ResultScene',
    });
  }

  create(data) {
    this.socket = getSocket();
    this.status = data.status;
    this.rankingTexts = [];
    // Phaser reuses the same Scene instance across repeated scene.start()
    // calls rather than constructing a fresh one -- plain instance
    // properties like this survive a scene restart even though the actual
    // GameObjects (including showReturnButton()'s DOM button) are torn down
    // and recreated. Without resetting this here, an admin/spectator who
    // sits through more than one tournament in the same browser session
    // would hit showReturnButton()'s own `if (this.hasReturnButton) return`
    // guard still sticky true from the *previous* tournament's result
    // screen, silently skipping the real re-add and leaving this second (or
    // later) results screen with no button at all.
    this.hasReturnButton = false;

    generateBackgroundTexture(this, 'bg_gradient', WORLD_WIDTH, WORLD_HEIGHT);
    generateParticleTextures(this);
    this.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'bg_gradient').setDepth(-30);
    createAmbientEmbers(this);

    // Backing panels behind the headline and (later) the ranking list, in
    // the same warm ember-bordered language used everywhere else now —
    // previously a flat navy fill with a near-invisible white hairline,
    // which read as generic/incomplete against the fire theme. Rounded
    // rather than flat square-cornered boxes (see LoginScene's same fix) —
    // Graphics has no persistent .setSize() the way Rectangle does, so
    // these get cleared + redrawn on demand instead.
    this.messagePanel = this.add.graphics();
    this.rankingsPanel = this.add.graphics().setVisible(false);

    // Fixed offsets from the *top* (y=0), not WORLD_HEIGHT/2 -- see
    // LoginScene's own comment on the same fix. WORLD_HEIGHT is derived
    // from MAP_COLS/MAP_ROWS (mapConfig.js), which have been re-tuned for
    // gameplay-tile-size reasons down to a canvas as short as ~270px;
    // WORLD_HEIGHT/2-relative negative offsets pushed this whole screen's
    // content off the top at that size.
    this.messageText = this.add.text(WORLD_WIDTH / 2, 40, data.message || '', {
      fontFamily: FONT_DISPLAY,
      fontSize: '26px',
      color: '#ffffff',
      align: 'center',
      stroke: TEXT_STROKE,
      strokeThickness: 4,
    }).setOrigin(0.5);
    // .width (not getBounds(), which reflects the *current* transform) so
    // this is safe regardless of the entrance tween's scale — used instead
    // of the getBounds() fit elsewhere since showRankings() below needs to
    // redraw this same panel later while the tween may still be mid-flight.
    drawRoundedPanel(this.messagePanel, WORLD_WIDTH / 2, 40, this.messageText.width + 28, 46);
    this.messageText.setScale(0.6).setAlpha(0);

    this.tweens.add({
      targets: this.messageText,
      scale: 1,
      alpha: 1,
      duration: 450,
      ease: 'Back.easeOut',
    });

    if (data.status === 'eliminated') {
      this.cameras.main.flash(300, 255, 90, 90);
    } else if (data.status === 'waiting') {
      this.cameras.main.flash(300, 110, 255, 150);
    }

    this.subText = this.add.text(WORLD_WIDTH / 2, 68, '', {
      fontFamily: FONT_BODY,
      fontSize: '14px',
      color: COLORS.textMuted,
    }).setOrigin(0.5);

    // The tournament can end in the exact same instant this player's own
    // room finishes; the final rankings ride along on that same event
    // (see GameScene's roomResult handler) so they're already known here
    // and there's nothing left to wait on.
    if (data.rankings) {
      this.showRankings(data.rankings);
      return;
    }

    const cleanup = () => {
      this.socket.off('gameStarting', onGameStarting);
      this.socket.off('tournamentEnded', onTournamentEnded);
    };

    const onGameStarting = (payload) => {
      cleanup();
      this.scene.start('GameScene', payload);
    };

    const onTournamentEnded = ({ rankings }) => {
      cleanup();
      this.showRankings(rankings);
    };

    if (data.status === 'waiting') {
      this.startWaitingDots();
    } else {
      this.showReturnButton();
    }

    this.socket.on('gameStarting', onGameStarting);
    this.socket.on('tournamentEnded', onTournamentEnded);

    this.events.once('shutdown', () => {
      this.stopWaitingDots();
      cleanup();
    });
  }

  startWaitingDots() {
    const base = '다음 상대를 기다리는 중';
    let dots = 0;
    this.subText.setText(base);
    this.waitingDotsEvent = this.time.addEvent({
      delay: 450,
      loop: true,
      callback: () => {
        dots = (dots + 1) % 4;
        this.subText.setText(base + '.'.repeat(dots));
      },
    });
  }

  stopWaitingDots() {
    if (this.waitingDotsEvent) {
      this.waitingDotsEvent.remove();
      this.waitingDotsEvent = null;
    }
  }

  showRankings(rankings) {
    this.stopWaitingDots();
    this.messageText.setText('토너먼트 결과');
    drawRoundedPanel(this.messagePanel, WORLD_WIDTH / 2, 40, this.messageText.width + 28, 46);
    this.subText.setText('');

    const mySocketId = this.socket.id;
    const startY = 100;
    const rowCount = Math.max(rankings ? rankings.length : 0, 1);
    const listCenterY = startY + ((rowCount - 1) * 26) / 2;
    drawRoundedPanel(this.rankingsPanel, WORLD_WIDTH / 2, listCenterY, 360, rowCount * 26 + 30);
    this.rankingsPanel
      .setVisible(true)
      .setAlpha(0);
    this.tweens.add({ targets: this.rankingsPanel, alpha: 1, duration: 300 });

    if (!rankings || rankings.length === 0) {
      const empty = this.add.text(WORLD_WIDTH / 2, startY, '결과가 없습니다.', {
        fontFamily: FONT_BODY,
        fontSize: '16px',
        color: COLORS.textMuted,
      }).setOrigin(0.5);
      this.rankingTexts.push(empty);
    }

    const RANK_COLORS = [COLORS.textGold, COLORS.textSilver, COLORS.textBronze];
    const RANK_MEDALS = ['🥇 ', '🥈 ', '🥉 '];

    rankings.forEach((entry, i) => {
      const isMine = (entry.socketIds || []).includes(mySocketId);
      const medal = RANK_MEDALS[i] || '';
      const champTag = entry.result === 'champion' ? ' 🏆' : '';
      const label = `${i + 1}위 ${medal}${entry.nicknames.join(', ')} - ${entry.score}점${champTag}`;
      const color = isMine ? '#55ff88' : (RANK_COLORS[i] || '#ffffff');
      const rowY = startY + i * 26;

      if (isMine) {
        // A quiet highlight bar so the viewer's own placement doesn't get
        // lost by eye among a long list — the green text color alone is
        // easy to skim past once there are 6+ rows. Rounded like every
        // other panel in the app now, rather than the one remaining flat
        // square-cornered box.
        const highlight = this.add.graphics().setAlpha(0);
        drawRoundedRect(highlight, WORLD_WIDTH / 2, rowY, 340, 24, {
          fillColor: 0x55ff88, fillAlpha: 0.12, strokeWidth: 1, strokeColor: 0x55ff88, strokeAlpha: 0.4, radius: 6,
        });
        this.tweens.add({ targets: highlight, alpha: 1, delay: i * 90, duration: 260 });
        this.rankingTexts.push(highlight);
      }

      const text = this.add.text(WORLD_WIDTH / 2, rowY, label, {
        fontFamily: FONT_BODY,
        fontSize: '15px',
        color,
      }).setOrigin(0.5);
      // A merged team (later bracket stages) can join several nicknames
      // into one row — at full size that easily runs wider than the
      // rankingsPanel itself (360px) and spilled out both edges instead of
      // staying inside it. Scaling the whole row down to fit keeps every
      // name intact rather than truncating anyone out of their own result.
      const fitScale = Math.min(1, 336 / text.width);
      text.setScale(fitScale * 0.7).setAlpha(0);

      this.tweens.add({
        targets: text,
        scale: fitScale,
        alpha: 1,
        delay: i * 90,
        duration: 260,
        ease: 'Back.easeOut',
      });

      this.rankingTexts.push(text);
    });

    if (rankings.some((entry) => entry.result === 'champion')) {
      this.celebrateChampion();
    }

    if (!this.hasReturnButton) {
      this.showReturnButton();
    }
  }

  celebrateChampion() {
    generateParticleTextures(this);

    const emitter = this.add.particles('particle_spark').setDepth(31).createEmitter({
      x: { min: 40, max: WORLD_WIDTH - 40 },
      y: -10,
      speedY: { min: 120, max: 220 },
      speedX: { min: -40, max: 40 },
      gravityY: 200,
      lifespan: { min: 1200, max: 1800 },
      scale: { start: 1, end: 0.2 },
      tint: [0xffd700, 0xff5555, 0x55ff88, 0x55aaff, 0xff88ff],
      quantity: 2,
      frequency: 40,
    });

    this.time.delayedCall(1800, () => emitter.stop());
    this.cameras.main.flash(500, 255, 220, 120);
    playVictory();
    vibrateVictory();
  }

  showReturnButton() {
    if (this.hasReturnButton) {
      return;
    }
    this.hasReturnButton = true;

    const buttonHtml = `
      <button id="return-button" type="button"
        style="padding:9px 20px;font-size:15px;border-radius:8px;border:none;background:${BUTTON.primaryBg};color:${BUTTON.primaryText};cursor:pointer;font-family:${FONT_BODY};font-weight:600;">
        대기실로 돌아가기
      </button>
    `;
    this.buttonNode = this.add.dom(WORLD_WIDTH / 2, WORLD_HEIGHT - 40).createFromHTML(buttonHtml);
    const button = this.buttonNode.getChildByID('return-button');
    applyButtonFx(button);

    button.addEventListener('click', () => {
      button.disabled = true;

      // join is expected to succeed here (getNickname() is only ever empty
      // before a player has ever logged in, which can't be true on this
      // screen) — but if the server ever does reject it, re-enable the
      // button instead of leaving it disabled with no way to retry.
      const cleanup = () => {
        this.socket.off('lobbyUpdate', onLobby);
        this.socket.off('joinRejected', onRejected);
      };
      const onLobby = (payload) => {
        cleanup();
        this.scene.start('LobbyScene', payload);
      };
      const onRejected = () => {
        cleanup();
        button.disabled = false;
      };
      this.socket.once('lobbyUpdate', onLobby);
      this.socket.once('joinRejected', onRejected);

      this.socket.emit('join', { nickname: getNickname() });
    });
  }
}
