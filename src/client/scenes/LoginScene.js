import Phaser from 'phaser';

import { getSocket } from '../net/socket';
import { setNickname } from '../net/session';
import { ensureAnimalTexture } from '../utilities/AnimalTextures';
import { generateBackgroundTexture, generateParticleTextures } from '../utilities/EffectTextures';
import { createAmbientEmbers } from '../utilities/SceneFx';
import { applyButtonFx } from '../utilities/ButtonFx';
import { unlockAudio } from '../utilities/SoundFx';
import { ANIMAL_COUNT } from '../../shared/animals';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../../shared/hexGrid';
import { NICKNAME_MAX_LENGTH } from '../../shared/roomConfig';
import { PUBLIC_SITE_URL } from '../../shared/publicUrl';

export default class LoginScene extends Phaser.Scene {

  constructor() {
    super({
      key: 'LoginScene',
    });
  }

  create() {
    this.socket = getSocket();

    generateBackgroundTexture(this, 'bg_gradient', WORLD_WIDTH, WORLD_HEIGHT);
    generateParticleTextures(this);
    this.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'bg_gradient').setDepth(-30);
    this.createFloatingAnimals();
    createAmbientEmbers(this);

    this.add.text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 175, `참가 주소: ${PUBLIC_SITE_URL}`, {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '14px',
      color: '#88ccff',
    }).setOrigin(0.5);

    // Same dark backing panel as every other headline in the app (lobby,
    // dashboard, result screen) — keeps the title grounded instead of
    // floating bare over the background.
    this.add.rectangle(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 140, 230, 40, 0x0b0e1c, 0.55)
      .setStrokeStyle(1, 0xffffff, 0.08);

    // A single title with a drop shadow for the "burning" mood, instead of a
    // second overlapping emoji text whose additive blend + randomized scale
    // (flickerTitleGlow) drifted out of alignment with the main title and
    // read as a stray duplicate/shadow rather than a soft glow.
    const title = this.add.text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 140, '🔥 타일 서바이벌 🔥', {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '28px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5).setScale(0.6).setAlpha(0)
      .setShadow(0, 0, '#ff6622', 12, true, true);

    this.tweens.add({
      targets: title,
      scale: 1,
      alpha: 1,
      duration: 500,
      ease: 'Back.easeOut',
    });

    this.statusText = this.add.text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 + 60, '', {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '14px',
      color: '#ff5555',
    }).setOrigin(0.5);

    const formHtml = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:12px;">
        <input id="nickname-input" type="text" maxlength="${NICKNAME_MAX_LENGTH}" placeholder="닉네임 (최대 ${NICKNAME_MAX_LENGTH}자)"
          style="width:220px;padding:10px;font-size:18px;text-align:center;border-radius:8px;border:2px solid #ffffff;background:#111827;color:#ffffff;outline:none;" />
        <button id="join-button" type="button"
          style="width:220px;padding:12px;font-size:18px;border-radius:8px;border:none;background:#10b981;color:#ffffff;cursor:pointer;">
          참가하기
        </button>
      </div>
    `;

    this.formNode = this.add.dom(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 40).createFromHTML(formHtml);

    this.input_ = this.formNode.getChildByID('nickname-input');
    this.button = this.formNode.getChildByID('join-button');
    applyButtonFx(this.button);

    this.input_.style.transition = 'border-color 0.2s ease, box-shadow 0.2s ease';
    this.input_.addEventListener('focus', () => {
      this.input_.style.borderColor = '#55ffaa';
      this.input_.style.boxShadow = '0 0 12px rgba(85,255,170,0.55)';
    });
    this.input_.addEventListener('blur', () => {
      this.input_.style.borderColor = '#ffffff';
      this.input_.style.boxShadow = 'none';
    });

    // Admin password, tucked into the corner rather than the main form so
    // it doesn't clutter the regular join flow — but still legible enough
    // for someone who knows to look for it.
    const adminHtml = `
      <input id="admin-password-input" type="password" placeholder="관리자"
        style="width:80px;height:22px;font-size:11px;padding:2px 6px;text-align:center;border-radius:5px;border:1px solid #555555;background:#111827cc;color:#cccccc;outline:none;" />
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
    this.input_.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        this.submit();
      }
    });
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
