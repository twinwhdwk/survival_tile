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
    // Same reused-Scene-instance caveat as hasReturnButton above: these
    // generic this.input.on(...) listeners (see setUpRankingsScroll) are
    // plugin-level, not tied to any GameObject's own lifecycle, so a second
    // tournament's showRankings() in the same browser session would stack a
    // duplicate set on top of the first's if they were never removed. Torn
    // down in the 'shutdown' handler below and re-armed fresh each time
    // showRankings() actually has overflowing content to scroll.
    this.rankingsScrollCleanup = null;
    // Registered unconditionally (unlike the socket cleanup below) since the
    // data.rankings branch a few lines down returns early, before ever
    // reaching that other shutdown listener.
    this.events.once('shutdown', () => {
      if (this.rankingsScrollCleanup) {
        this.rankingsScrollCleanup();
        this.rankingsScrollCleanup = null;
      }
    });

    generateBackgroundTexture(this, 'bg_gradient', WORLD_WIDTH, WORLD_HEIGHT);
    generateParticleTextures(this);
    this.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'bg_gradient').setDepth(-30);
    createAmbientEmbers(this);

    // Same warm near-black fade every scene now opens with (see GameScene's
    // identical fadeIn) -- layers fine underneath the eliminated/waiting
    // status flash() below, which is a separate additive color pulse over
    // whatever's already on screen, not a from-black fade.
    this.cameras.main.fadeIn(400, 13, 8, 5);

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
      stroke: TEXT_STROKE,
      strokeThickness: 2,
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

    if (this.rankingsScrollCleanup) {
      this.rankingsScrollCleanup();
      this.rankingsScrollCleanup = null;
    }

    const mySocketId = this.socket.id;
    const startY = 100;
    const rowCount = Math.max(rankings ? rankings.length : 0, 1);
    const contentHeight = rowCount * 26 + 30;

    // Available vertical space for the list before it runs into the return
    // button near the bottom of the screen. A bracket with more than a
    // handful of finishers used to produce rows taller than this and they'd
    // simply render off the bottom of the canvas -- Phaser doesn't clip or
    // scroll anything on its own, so those rows were just gone with no way
    // to reach them. Rows now live in their own container (rowsContainer,
    // below), clipped to this window by a geometry mask and pannable via
    // setUpRankingsScroll() whenever the content is actually taller than it.
    const viewTop = startY - 15;
    const viewBottom = WORLD_HEIGHT - 60;
    const viewHeight = Math.max(26, viewBottom - viewTop);
    const panelHeight = Math.min(contentHeight, viewHeight);
    const listCenterY = viewTop + panelHeight / 2;
    drawRoundedPanel(this.rankingsPanel, WORLD_WIDTH / 2, listCenterY, 360, panelHeight);
    this.rankingsPanel
      .setVisible(true)
      .setAlpha(0);
    this.tweens.add({ targets: this.rankingsPanel, alpha: 1, duration: 300 });

    const rowsContainer = this.add.container(0, 0);
    this.rankingTexts.push(rowsContainer);

    if (!rankings || rankings.length === 0) {
      const empty = this.add.text(WORLD_WIDTH / 2, startY, '결과가 없습니다.', {
        fontFamily: FONT_BODY,
        fontSize: '16px',
        color: COLORS.textMuted,
        stroke: TEXT_STROKE,
        strokeThickness: 2,
      }).setOrigin(0.5);
      rowsContainer.add(empty);
    }

    const RANK_COLORS = [COLORS.textGold, COLORS.textSilver, COLORS.textBronze];
    const RANK_MEDALS = ['🥇', '🥈', '🥉'];
    // Column layout (rank | name | score) rather than one long sentence per
    // row -- a real leaderboard reads by scanning a column, not by reading
    // full sentences n times. All three x-anchors are relative to the fixed
    // 360-wide rankingsPanel, same as the highlight/zebra bars below.
    const rankX = WORLD_WIDTH / 2 - 170;
    const nameX = WORLD_WIDTH / 2 - 112;
    const scoreX = WORLD_WIDTH / 2 + 170;
    const nameMaxWidth = scoreX - 80 - nameX;

    rankings.forEach((entry, i) => {
      const isMine = (entry.socketIds || []).includes(mySocketId);
      const isPodium = i < 3;
      const medal = RANK_MEDALS[i] || '';
      const champTag = entry.result === 'champion' ? ' 🏆' : '';
      const rankLabel = medal ? `${medal} ${i + 1}` : `${i + 1}위`;
      const nameLabel = entry.nicknames.join(', ');
      const scoreLabel = `${entry.score}점${champTag}`;
      const rankColor = isMine ? '#55ff88' : (RANK_COLORS[i] || '#ffffff');
      const nameColor = isMine ? '#55ff88' : '#ffffff';
      const scoreColor = isMine ? '#55ff88' : COLORS.textGold;
      const rowY = startY + i * 26;
      const fontSize = isPodium ? '16px' : '15px';
      const fontStyle = isPodium ? 'bold' : 'normal';
      // Regular rows had no stroke at all -- a thin, regular-weight Gothic A1
      // glyph at 15px anti-aliases into a soft, "muddy" edge next to the
      // podium rows' bold weight (which reads clean by sheer stroke width
      // alone). The same TEXT_STROKE outline every other panel/label in the
      // app already gets fixes that without needing to touch weight/size.
      const strokeThickness = isPodium ? 3 : 2;

      // Alternating row tint so a long, scrolled list stays easy to scan by
      // eye -- drawn first (bottom of the row's own z-order) so isMine's own
      // highlight below can still layer cleanly on top of it.
      if (i % 2 === 1) {
        const zebra = this.add.graphics();
        drawRoundedRect(zebra, WORLD_WIDTH / 2, rowY, 340, 24, {
          fillColor: 0xffffff, fillAlpha: 0.05, strokeAlpha: 0, radius: 6,
        });
        this.rankingTexts.push(zebra);
        rowsContainer.add(zebra);
      }

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
        rowsContainer.add(highlight);
      }

      const rankText = this.add.text(rankX, rowY, rankLabel, {
        fontFamily: FONT_BODY,
        fontSize,
        fontStyle,
        color: rankColor,
        stroke: TEXT_STROKE,
        strokeThickness,
      }).setOrigin(0, 0.5);

      const nameText = this.add.text(nameX, rowY, nameLabel, {
        fontFamily: FONT_BODY,
        fontSize,
        fontStyle,
        color: nameColor,
        stroke: TEXT_STROKE,
        strokeThickness,
      }).setOrigin(0, 0.5);
      // A merged team (later bracket stages) can join several nicknames
      // into one row — at full size that easily runs wider than its column,
      // which would either overlap the score or spill past the panel.
      // Scaling just the name down to fit keeps every name intact rather
      // than truncating anyone out of their own result, without affecting
      // the rank/score columns' own alignment.
      const nameFitScale = Math.min(1, nameMaxWidth / nameText.width);

      const scoreText = this.add.text(scoreX, rowY, scoreLabel, {
        fontFamily: FONT_BODY,
        fontSize,
        fontStyle,
        color: scoreColor,
        stroke: TEXT_STROKE,
        strokeThickness,
      }).setOrigin(1, 0.5);

      [rankText, nameText, scoreText].forEach((obj, colIdx) => {
        const targetScale = colIdx === 1 ? nameFitScale : 1;
        obj.setScale(targetScale * 0.7).setAlpha(0);
        this.tweens.add({
          targets: obj,
          scale: targetScale,
          alpha: 1,
          delay: i * 90,
          duration: 260,
          ease: 'Back.easeOut',
        });
        this.rankingTexts.push(obj);
        rowsContainer.add(obj);
      });
    });

    if (rankings.some((entry) => entry.result === 'champion')) {
      this.celebrateChampion();
    }

    // Clip the rows to the panel's visible window, then wire up drag/wheel
    // scrolling only if the content actually overflows it -- a short list
    // (the common case) needs neither, and setUpRankingsScroll's own
    // cleanup would just be a no-op churn for it.
    const maskShape = this.make.graphics({}, false);
    maskShape.fillStyle(0xffffff);
    maskShape.fillRect(WORLD_WIDTH / 2 - 190, viewTop, 380, viewHeight);
    rowsContainer.setMask(maskShape.createGeometryMask());

    const maxScroll = Math.max(0, contentHeight - viewHeight);
    if (maxScroll > 0) {
      // The drag/wheel handling below has no visual footprint of its own --
      // without some on-screen cue, a long ranking list just looks like it
      // stops short with no indication the rest is one drag/scroll away.
      // A slim track + thumb on the panel's right edge (like a native
      // scrollbar) makes that discoverable at a glance.
      // Drawn by hand rather than through drawRoundedRect -- that helper's
      // drop shadow/stroke/inset-line are tuned for full panels and would
      // read as visual noise on a bar this thin (4px wide).
      const trackX = WORLD_WIDTH / 2 + 172;
      const barRadius = 2;
      const scrollTrack = this.add.graphics();
      scrollTrack.fillStyle(0xffffff, 0.12);
      scrollTrack.fillRoundedRect(trackX - 2, viewTop, 4, viewHeight, barRadius);
      const thumbHeight = Math.max(20, viewHeight * (viewHeight / contentHeight));
      const scrollThumb = this.add.graphics();
      const drawThumb = (scrollY) => {
        const ratio = maxScroll > 0 ? (-scrollY / maxScroll) : 0;
        const thumbTravel = viewHeight - thumbHeight;
        const thumbTop = viewTop + ratio * thumbTravel;
        scrollThumb.clear();
        scrollThumb.fillStyle(0xffd700, 0.7);
        scrollThumb.fillRoundedRect(trackX - 2, thumbTop, 4, thumbHeight, barRadius);
      };
      drawThumb(0);
      this.rankingsScrollCleanup = this.setUpRankingsScroll(
        rowsContainer, viewTop, viewBottom, maxScroll, maskShape, drawThumb,
      );
      const innerCleanup = this.rankingsScrollCleanup;
      this.rankingsScrollCleanup = () => {
        innerCleanup();
        scrollTrack.destroy();
        scrollThumb.destroy();
      };
    } else {
      this.rankingsScrollCleanup = () => maskShape.destroy();
    }

    if (!this.hasReturnButton) {
      this.showReturnButton();
    }
  }

  // Lets the rankings list be dragged (touch/mouse) or wheel-scrolled once
  // it's taller than its visible window. Returns a cleanup function that
  // undoes every listener/GameObject this adds -- the caller (showRankings)
  // runs it before rebuilding the list, and ResultScene's own shutdown
  // handler runs it on scene teardown, since this scene's instance is
  // reused across tournaments in the same browser session (see
  // hasReturnButton's comment for the same caveat) and these this.input.on
  // listeners are plugin-level, not tied to any GameObject's lifecycle that
  // would otherwise clean them up automatically.
  setUpRankingsScroll(container, viewTop, viewBottom, maxScroll, maskShape, onScroll) {
    const viewHeight = viewBottom - viewTop;
    const centerY = viewTop + viewHeight / 2;
    // Invisible drag surface over just the visible list window -- nothing
    // else in this scene occupies that area, so it's safe as a full-window
    // hit target for both touch drag and mouse wheel.
    const zone = this.add.zone(WORLD_WIDTH / 2, centerY, 380, viewHeight)
      .setOrigin(0.5)
      .setInteractive();

    const clamp = (y) => Phaser.Math.Clamp(y, -maxScroll, 0);
    const notify = () => { if (onScroll) { onScroll(container.y); } };

    let dragStartPointerY = null;
    let dragStartContainerY = 0;

    const onZoneDown = (pointer) => {
      dragStartPointerY = pointer.y;
      dragStartContainerY = container.y;
    };
    const onPointerMove = (pointer) => {
      if (dragStartPointerY === null) {
        return;
      }
      container.y = clamp(dragStartContainerY + (pointer.y - dragStartPointerY));
      notify();
    };
    const endDrag = () => {
      dragStartPointerY = null;
    };
    const onWheel = (pointer, currentlyOver, deltaX, deltaY) => {
      container.y = clamp(container.y - deltaY * 0.5);
      notify();
    };

    zone.on('pointerdown', onZoneDown);
    this.input.on('pointermove', onPointerMove);
    this.input.on('pointerup', endDrag);
    this.input.on('pointerupoutside', endDrag);
    this.input.on('wheel', onWheel);

    return () => {
      zone.off('pointerdown', onZoneDown);
      zone.destroy();
      this.input.off('pointermove', onPointerMove);
      this.input.off('pointerup', endDrag);
      this.input.off('pointerupoutside', endDrag);
      this.input.off('wheel', onWheel);
      maskShape.destroy();
    };
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
