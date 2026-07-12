import Phaser from 'phaser';
import GameScene from './scenes/GameScene';
import LoginScene from './scenes/LoginScene';
import LobbyScene from './scenes/LobbyScene';
import ResultScene from './scenes/ResultScene';
import DashboardScene from './scenes/DashboardScene';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../shared/hexGrid';

const config = {
  title:    'Phaser 3 Multiplayer Game',
  version:  '0.0.1',
  parent:   'game',
  type:     Phaser.AUTO,
  input: {
    keyboard: true,
    mouse:    true,
    touch:    true,
    gamepad:  false,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
  },
  render: {
    pixelArt:   true,
    antialias:  true,
  },
  backgroundColor: '0x000000',
  dom: {
    createContainer: true,
  },
  scene: [ LoginScene, LobbyScene, GameScene, ResultScene, DashboardScene ],
};

new Phaser.Game(config);
