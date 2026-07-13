const path    = require('path');
const webpack = require('webpack');

const www         = path.join(__dirname, 'public');
const nodeModules = path.join(__dirname, 'node_modules');
const server      = path.join(__dirname, 'src/server');
const client      = path.join(__dirname, 'src/client/client');

const definePlugin = new webpack.DefinePlugin({
  CANVAS_RENDERER: JSON.stringify(true),
  WEBGL_RENDERER:  JSON.stringify(true)
});

module.exports = {
  mode: 'production',
  devtool: 'source-map',
  plugins: [ definePlugin ],
  entry: {
    app: client,
  },
  // This game does zero physics simulation (all collision/movement is
  // server-authoritative hex-grid math, see src/shared/hexGrid.js) but
  // `phaser` bundles MatterJS by default. Phaser itself ships
  // phaser-arcade-physics.js, an official alternate entry that drops only
  // Matter (Arcade physics stays in, unused but harmless) -- aliasing to
  // it here needs zero changes to any `import Phaser from 'phaser'` call
  // site. Confirmed via a scratch build: ~129KB smaller raw, ~37KB smaller
  // gzipped, with every Phaser API this project actually touches
  // (Tweens, Geom, Math, BlendModes, Display.Color, DOM, particles)
  // still present -- unlike phaser-core.js, which also drops some of
  // those and was rejected for that reason.
  resolve: {
    alias: {
      phaser: path.join(nodeModules, 'phaser/dist/phaser-arcade-physics.js'),
    },
  },
  output: {
    path: path.join(www, 'js'),
    filename: 'bundle.js',
    publicPath: '/'
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: [ nodeModules, server ],
        use: 'babel-loader'
      },
      {
        test: /\.(png|jpg|gif|ico|svg|pvr|pkm|static|ogg|mp3|wav)$/,
        exclude: [ nodeModules, server ],
        use: 'file-loader'
      },
    ]
  }
};
