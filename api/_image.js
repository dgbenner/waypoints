/* ============================================================================
 * WAYPOINTS — incoming images for the inbox: check the type by its bytes,
 * then shrink to a small WebP (about 100 KB) for the model and for storage.
 * Leading underscore keeps Vercel from serving this file as a route.
 * ========================================================================== */
const sharp = require('sharp');

// What the bytes say the file is (the sender's label can't be trusted).
function sniff(buf) {
  if (buf.length < 12) return '';
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'png';
  if (buf.toString('ascii', 0, 3) === 'GIF') return 'gif';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)$/.test(buf.toString('ascii', 8, 12))) return 'heic';
  return '';
}

// base64 in (any whitespace/line breaks allowed) → { b64, mediaType } or { error }.
async function prepareImage(b64in) {
  const clean = String(b64in || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!clean) return { error: 'empty' };
  const buf = Buffer.from(clean, 'base64');
  const kind = sniff(buf);
  if (kind === 'heic') return { error: 'heic' };
  if (!kind) return { error: 'type' };
  try {
    const out = await sharp(buf, { animated: false }).rotate()
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 }).toBuffer();
    return { b64: out.toString('base64'), mediaType: 'image/webp', bytes: out.length };
  } catch (e) {
    return { error: 'decode' };
  }
}

module.exports = { prepareImage, sniff };
