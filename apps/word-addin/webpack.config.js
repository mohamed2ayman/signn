/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const devCerts = require('office-addin-dev-certs');
const webpack = require('webpack');

const PORT = 3001;

module.exports = async (_env, argv) => {
  const dev = argv.mode !== 'production';
  const apiUrl =
    process.env.SIGN_API_URL || 'http://localhost:3000/api/v1';

  return {
    mode: dev ? 'development' : 'production',
    devtool: dev ? 'inline-source-map' : 'source-map',
    entry: {
      taskpane: './src/taskpane/index.tsx',
      commands: './src/commands/commands.ts',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      clean: true,
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          loader: 'ts-loader',
          exclude: /node_modules/,
          options: { transpileOnly: true },
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader'],
        },
        {
          test: /\.(png|jpg|gif|svg)$/,
          type: 'asset/resource',
        },
      ],
    },
    plugins: [
      new webpack.DefinePlugin({
        'process.env.SIGN_API_URL': JSON.stringify(apiUrl),
      }),
      new HtmlWebpackPlugin({
        filename: 'taskpane.html',
        template: './src/taskpane/index.html',
        chunks: ['taskpane'],
      }),
      new HtmlWebpackPlugin({
        filename: 'commands.html',
        template: './src/commands/commands.html',
        chunks: ['commands'],
      }),
      new CopyWebpackPlugin({
        patterns: [
          { from: 'public/assets', to: 'assets', noErrorOnMissing: true },
          {
            from: dev
              ? 'manifest.localhost.xml'
              : 'manifest.xml',
            to: 'manifest.xml',
            noErrorOnMissing: true,
          },
        ],
      }),
    ],
    devServer: {
      port: PORT,
      hot: true,
      static: {
        directory: path.resolve(__dirname, 'dist'),
      },
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      server: {
        type: 'https',
        options: dev ? await devCerts.getHttpsServerOptions() : undefined,
      },
    },
  };
};
