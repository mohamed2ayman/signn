const sharp = require('sharp');
const path = require('path');

const sizes = [16, 32, 64, 80, 128];
const input = path.resolve(__dirname, '../public/assets/sign_logo_final.svg');
const outputDir = path.resolve(__dirname, '../public/assets');

(async () => {
  for (const size of sizes) {
    await sharp(input)
      .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png()
      .toFile(path.join(outputDir, `icon-${size}.png`));
    console.log(`✓ icon-${size}.png generated`);
  }
})();
