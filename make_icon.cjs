/**
 * Convert favicon.svg → suirobo.ico (multi-size icon cho Windows)
 *
 * Output: dist-agent/suirobo.ico
 *
 * Cần: png-to-ico (npm)
 */
const fs   = require('fs');
const path = require('path');

const SVG_PATH = path.join(__dirname, 'public', 'favicon.svg');
const OUT_DIR  = path.join(__dirname, 'dist-agent');
const OUT_ICO  = path.join(OUT_DIR, 'suirobo.ico');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Phương án: render SVG → PNG multi-size → combine .ico
async function makeIcon() {
  let sharp, pngToIco;
  try {
    sharp = require('sharp');
    pngToIco = require('png-to-ico');
    if (typeof pngToIco !== 'function') pngToIco = pngToIco.default || pngToIco;
  } catch (e) {
    console.error('Cài deps: npm install -D sharp png-to-ico');
    process.exit(1);
  }

  if (!fs.existsSync(SVG_PATH)) {
    console.error('Không thấy SVG:', SVG_PATH);
    process.exit(1);
  }

  const svgBuf = fs.readFileSync(SVG_PATH);
  const sizes  = [16, 24, 32, 48, 64, 128, 256];
  const pngs   = [];

  console.log('🖼  Rendering SVG → PNG multi-size...');
  for (const size of sizes) {
    const png = await sharp(svgBuf).resize(size, size).png().toBuffer();
    pngs.push(png);
    console.log(`   ✓ ${size}x${size} (${png.length} bytes)`);
  }

  console.log('📦 Building .ico...');
  const ico = await pngToIco(pngs);
  fs.writeFileSync(OUT_ICO, ico);
  console.log(`✅ ${OUT_ICO} (${(ico.length / 1024).toFixed(1)} KB)`);
}

makeIcon().catch(e => { console.error(e); process.exit(1); });
