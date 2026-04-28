#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Build a distributable add-in zip.
 *
 * Steps:
 *   1. Run `webpack --mode production` (which emits dist/, including
 *      the production manifest copied via CopyWebpackPlugin).
 *   2. Substitute ${ADDIN_ORIGIN} / ${SIGN_API_ORIGIN} placeholders in
 *      dist/manifest.xml from environment variables.
 *   3. Validate the resulting manifest with office-addin-manifest.
 *   4. Zip dist/ into dist/word-addin.zip.
 *
 * Required env vars:
 *   ADDIN_ORIGIN       e.g. https://word-addin.sign.ai
 *   SIGN_API_ORIGIN    e.g. https://api.sign.ai
 *   SIGN_API_URL       e.g. https://api.sign.ai/api/v1
 *                      (compiled into the bundle by webpack DefinePlugin)
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const ADDIN_ORIGIN = process.env.ADDIN_ORIGIN;
const SIGN_API_ORIGIN = process.env.SIGN_API_ORIGIN;

if (!ADDIN_ORIGIN || !SIGN_API_ORIGIN) {
  console.error(
    'package.js: ADDIN_ORIGIN and SIGN_API_ORIGIN env vars are required.\n' +
      '  ADDIN_ORIGIN     — HTTPS origin where taskpane bundle is hosted\n' +
      '  SIGN_API_ORIGIN  — HTTPS origin of the SIGN backend API\n' +
      '  SIGN_API_URL     — full API base URL (consumed by webpack)\n',
  );
  process.exit(1);
}

console.log('• building production bundle…');
execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

const manifestPath = path.join(DIST, 'manifest.xml');
if (!fs.existsSync(manifestPath)) {
  console.error(`package.js: ${manifestPath} not found after build.`);
  process.exit(1);
}

console.log('• substituting manifest placeholders…');
let manifest = fs.readFileSync(manifestPath, 'utf8');
manifest = manifest
  .replace(/\$\{ADDIN_ORIGIN\}/g, ADDIN_ORIGIN.replace(/\/$/, ''))
  .replace(/\$\{SIGN_API_ORIGIN\}/g, SIGN_API_ORIGIN.replace(/\/$/, ''));
fs.writeFileSync(manifestPath, manifest);

console.log('• validating manifest…');
try {
  execSync(`npx office-addin-manifest validate "${manifestPath}"`, {
    cwd: ROOT,
    stdio: 'inherit',
  });
} catch {
  console.error('package.js: manifest validation failed.');
  process.exit(1);
}

console.log('• zipping dist → word-addin.zip…');
const zipPath = path.join(DIST, 'word-addin.zip');
const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  console.log(
    `✓ wrote ${zipPath} (${(archive.pointer() / 1024).toFixed(1)} KB)`,
  );
});
archive.on('error', (err) => {
  throw err;
});
archive.pipe(output);
archive.glob('**/*', {
  cwd: DIST,
  ignore: ['word-addin.zip'],
});
archive.finalize();
