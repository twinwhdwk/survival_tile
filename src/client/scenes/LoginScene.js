import Phaser from 'phaser';

import { getSocket } from '../net/socket';
import { setNickname } from '../net/session';
import { ensureAnimalTexture } from '../utilities/AnimalTextures';
import { generateBackgroundTexture, generateParticleTextures } from '../utilities/EffectTextures';
import { createAmbientEmbers } from '../utilities/SceneFx';
import { applyButtonFx } from '../utilities/ButtonFx';
import { unlockAudio, playError } from '../utilities/SoundFx';
import { ANIMAL_COUNT } from '../../shared/animals';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../../shared/hexGrid';
import { NICKNAME_MAX_LENGTH } from '../../shared/roomConfig';
import { PUBLIC_SITE_URL } from '../../shared/publicUrl';
import { FONT_DISPLAY, FONT_BODY, COLORS, TEXT_STROKE } from '../theme/Theme';
import { fitTitlePanel } from '../utilities/RoundedPanel';

export default class LoginScene extends Phaser.Scene {

  constructor() {
    super({
      key: 'LoginScene',
    });
  }

  create() {
    // The static HTML preloader (index.html) has done its job the moment
    // Phaser has something real to show -- remove it now rather than
    // leaving it sitting on top of (or under) the actual game forever.
    const preloader = document.getElementById('preloader');
    if (preloader) {
      preloader.remove();
    }

    this.socket = getSocket();

    generateBackgroundTexture(this, 'bg_gradient', WORLD_WIDTH, WORLD_HEIGHT);
    generateParticleTextures(this);
    this.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'bg_gradient').setDepth(-30);
    this.createFloatingAnimals();
    createAmbientEmbers(this);

    this.add.text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 175, `참가 주소: ${PUBLIC_SITE_URL}`, {
      fontFamily: FONT_BODY,
      fontSize: '14px',
      color: COLORS.textInfo,
    }).setOrigin(0.5);

    // Same warm ember-bordered panel as every other headline in the app
    // (lobby, dashboard, result screen) — keeps the title grounded instead
    // of floating bare over the background. Drawn (not sized) below once
    // the title text exists to measure against.
    const titlePanel = this.add.graphics();

    // A single title with a drop shadow for the "burning" mood, instead of a
    // second overlapping emoji text whose additive blend + randomized scale
    // drifted out of alignment with the main title and read as a stray
    // duplicate/shadow rather than a soft glow.
    const title = this.add.text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 140, '🔥 타일 서바이벌 🔥', {
      fontFamily: FONT_DISPLAY,
      fontSize: '28px',
      color: '#ffffff',
      stroke: TEXT_STROKE,
      strokeThickness: 4,
    }).setOrigin(0.5).setShadow(0, 0, '#ff6622', 12, true, true);
    // Rounded rather than a flat square-cornered rectangle — a hard box
    // read as an unstyled debug panel against the rounded DOM
    // inputs/buttons right below it. getBounds() (not .width, which
    // undercounts the two 🔥 emoji glyphs) sizes it to actually wrap the
    // text. Measured here at the text's default scale=1 — doing this after
    // the entrance tween's setScale(0.6) below would size the panel for
    // the shrunk starting pose instead of the settled title.
    fitTitlePanel(titlePanel, WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 140, 40, title, 28);
    title.setScale(0.6).setAlpha(0);

    this.tweens.add({
      targets: title,
      scale: 1,
      alpha: 1,
      duration: 500,
      ease: 'Back.easeOut',
    });

    this.statusText = this.add.text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 + 60, '', {
      fontFamily: FONT_BODY,
      fontSize: '14px',
      color: COLORS.textMuted,
    }).setOrigin(0.5);

    const formHtml = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:12px;">
        <input id="nickname-input" type="text" maxlength="${NICKNAME_MAX_LENGTH}" placeholder="닉네임 (최대 ${NICKNAME_MAX_LENGTH}자)"
          style="width:220px;padding:10px;font-size:18px;text-align:center;border-radius:10px;border:2px solid #8a6a45;background:#1c130dcc;color:#ffffff;outline:none;font-family:${FONT_BODY};" />
        <button id="join-button" type="button"
          style="width:220px;padding:12px;font-size:18px;border-radius:10px;border:none;background:#10b981;color:#ffffff;cursor:pointer;font-family:${FONT_BODY};">
          참가하기
        </button>
      </div>
    `;

    this.formNode = this.add.dom(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 40).createFromHTML(formHtml);

    this.input_ = this.formNode.getChildByID('nickname-input');
    this.button = this.formNode.getChildByID('join-button');
    applyButtonFx(this.button);

    // Typing a nickname is the only thing to do on this screen, so let
    // desktop players start typing immediately without an extra click.
    // Mobile browsers generally only raise the on-screen keyboard from a
    // focus that happens inside a real user gesture, so this is a no-op
    // there (no unexpected keyboard popping up on page load) -- a safe
    // improvement with no downside on either platform.
    this.input_.focus();

    this.input_.style.transition = 'border-color 0.2s ease, box-shadow 0.2s ease';
    this.input_.addEventListener('focus', () => {
      this.input_.style.borderColor = '#55ffaa';
      this.input_.style.boxShadow = '0 0 12px rgba(85,255,170,0.55)';
    });
    this.input_.addEventListener('blur', () => {
      this.input_.style.borderColor = '#8a6a45';
      this.input_.style.boxShadow = 'none';
    });

    // Admin password, tucked into the corner rather than the main form so
    // it doesn't clutter the regular join flow — but still legible enough
    // for someone who knows to look for it.
    const adminHtml = `
      <input id="admin-password-input" type="password" placeholder="관리자"
        style="width:80px;height:22px;font-size:11px;padding:2px 6px;text-align:center;border-radius:5px;border:1px solid #555555;background:#0b0e1ccc;color:#aaaaaa;outline:none;" />
    `;
    this.adminNode = this.add.dom(WORLD_WIDTH - 55, WORLD_HEIGHT - 18).createFromHTML(adminHtml);
    this.passwordInput_ = this.adminNode.getChildByID('admin-password-input');

    // outline:none above dropped ALL focus feedback, not just the default
    // browser outline — clicking into this field gave no visual sign it was
    // active. Kept deliberately subtle (no glow) to match this field's own
    // "tucked into the corner" intent, unlike the nickname input's bright
    // focus treatment.
    this.passwordInput_.style.transition = 'border-color 0.2s ease';
    this.passwordInput_.addEventListener('focus', () => {
      this.passwordInput_.style.borderColor = '#8899cc';
    });
    this.passwordInput_.addEventListener('blur', () => {
      this.passwordInput_.style.borderColor = '#555555';
    });

    this.button.addEventListener('click', () => this.submit());
    // An admin naturally types nickname -> tabs to password -> hits Enter,
    // expecting that to submit like any normal login form. Only the
    // nickname field had this before, so finishing in the password field
    // silently did nothing until they noticed and clicked the button instead.
    const submitOnEnter = (event) => {
      if (event.key === 'Enter') {
        this.submit();
      }
    };
    this.input_.addEventListener('keydown', submitOnEnter);
    this.passwordInput_.addEventListener('keydown', submitOnEnter);
  }

  createFloatingAnimals() {
    const count = 8;
    for (let i = 0; i < count; i++) {
      const idx = Phaser.Math.Between(0, ANIMAL_COUNT - 1);
      const x = Phaser.Math.Between(40, WORLD_WIDTH - 40);
      const y = Phaser.Math.Between(40, WORLD_HEIGHT - 40);
      const icon = this.add.image(x, y, ensureAnimalTexture(this, idx))
        .setAlpha(0.16)
        .setScale(1.4)
        .setDepth(-20);

      this.tweens.add({
        targets: icon,
        y: y - Phaser.Math.Between(20, 40),
        duration: 2200 + Math.random() * 1400,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      this.tweens.add({
        targets: icon,
        angle: Phaser.Math.Between(-8, 8),
        duration: 3000 + Math.random() * 1200,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  showError(message) {
    playError();
    this.statusText.setColor(COLORS.textDanger);
    this.statusText.setText(message);
    this.statusText.x = WORLD_WIDTH / 2;
    this.tweens.add({
      targets: this.statusText,
      x: { from: WORLD_WIDTH / 2 - 6, to: WORLD_WIDTH / 2 + 6 },
      duration: 60,
      yoyo: true,
      repeat: 3,
      onComplete: () => { this.statusText.x = WORLD_WIDTH / 2; },
    });
  }

  submit() {
    // Browsers block audio playback until it's resumed inside a real user
    // gesture — this is the very first click/tap in the whole app, so
    // every later scene's sounds work with no further gesture needed.
    unlockAudio();

    const nickname = this.input_.value.trim().slice(0, NICKNAME_MAX_LENGTH);
    if (!nickname) {
      this.showError('닉네임을 입력해주세요.');
      return;
    }

    // Reset color in case a previous attempt left this red from showError()
    // -- this same text object is reused for both the neutral in-progress
    // message and actual errors, and used to be stuck on error-red for both.
    this.statusText.setColor(COLORS.textMuted);
    this.statusText.setText('참가하는 중...');
    this.button.disabled = true;

    const cleanup = () => {
      this.socket.off('joinRejected', onRejected);
      this.socket.off('lobbyUpdate', onLobby);
    };

    const onRejected = ({ reason }) => {
      cleanup();
      this.button.disabled = false;
      if (reason === 'invalid') {
        this.showError('닉네임을 입력해주세요.');
      } else if (reason === 'bad-password') {
        this.showError('관리자 비밀번호가 틀렸습니다.');
      } else if (reason === 'no-session') {
        this.showError('아직 세션이 열리지 않았습니다. 관리자 접속을 기다려주세요.');
      } else {
        this.showError('참가할 수 없습니다.');
      }
    };

    const onLobby = (data) => {
      cleanup();
      setNickname(nickname);
      this.scene.start('LobbyScene', data);
    };

    this.socket.once('joinRejected', onRejected);
    this.socket.once('lobbyUpdate', onLobby);

    const password = this.passwordInput_.value;
    this.socket.emit('join', password ? { nickname, password } : { nickname });
  }
}
