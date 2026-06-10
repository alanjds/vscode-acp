//@ts-check
'use strict';

const path = require('path');
const fs = require('fs');
const webpack = require('webpack');

class CopyWebviewCssPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('CopyWebviewCssPlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'CopyWebviewCssPlugin',
          stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS,
        },
        () => {
          const cssPath = path.resolve(__dirname, 'webview/src/styles.css');
          compilation.emitAsset(
            'chat.css',
            new webpack.sources.RawSource(fs.readFileSync(cssPath, 'utf8')),
          );
        },
      );
    });
  }
}

/** @type {import('webpack').Configuration} */
const extensionConfig = {
  name: 'extension',
  target: 'node',
  mode: 'none',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
  },
  externals: {
    vscode: 'commonjs vscode',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [{ loader: 'ts-loader' }],
      },
    ],
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: 'log',
  },
};

/** @type {import('webpack').Configuration} */
const webviewConfig = {
  name: 'webview',
  target: 'web',
  mode: 'none',
  entry: './webview/src/main.tsx',
  output: {
    path: path.resolve(__dirname, 'resources', 'webview', 'dist'),
    filename: 'chat.js',
    clean: true,
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: [{
          loader: 'ts-loader',
          options: {
            configFile: path.resolve(__dirname, 'webview', 'tsconfig.json'),
          },
        }],
      },
    ],
  },
  plugins: [
    new CopyWebviewCssPlugin(),
  ],
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: 'log',
  },
};

module.exports = [extensionConfig, webviewConfig];
