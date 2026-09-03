import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dataDir = process.env.OD_DATA_DIR || '/data/opendesign';
const rendererPath = process.env.RENDERER_MODULE || '/opt/ha-opendesign/headless-renderer.mjs';
const { renderSlides } = await import(pathToFileURL(rendererPath));
const root = await mkdtemp(path.join(dataDir, 'export-render', 'container-e2e-'));

function imageDimensions(bytes, format) {
  if (format === 'png') {
    assert.deepEqual(bytes.subarray(12, 16), Buffer.from('IHDR'));
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  throw new Error('JPEG dimensions not found');
}

try {
  const html = `<!doctype html><html><head><style>
    html,body{margin:0}.slide{width:320px;height:180px;color:white;font:24px sans-serif}
    .slide:first-of-type{background:#165dba}.slide:last-of-type{background:#a33}
  </style></head><body><section class="slide">Slide one</section><section class="slide">Slide two</section></body></html>`;
  for (const [format, magic] of [['png', Buffer.from([0x89, 0x50, 0x4e, 0x47])], ['jpeg', Buffer.from([0xff, 0xd8, 0xff])]]) {
    const outputDir = path.join(root, format);
    const result = await renderSlides({
      html,
      outputDir,
      baseHref: 'http://127.0.0.1:7456/',
      deck: true,
      stitch: true,
      pageImageFormat: format,
      width: 320,
      height: 180,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.slideFiles?.length, 1);
    assert.deepEqual({ width: result.width, height: result.height }, { width: 320, height: 360 });
    const bytes = await readFile(result.slideFiles[0]);
    assert.ok(bytes.length > 100, `${format} output is empty`);
    assert.deepEqual(bytes.subarray(0, magic.length), magic, `${format} signature mismatch`);
    assert.deepEqual(imageDimensions(bytes, format), { width: 320, height: 360 }, `${format} must contain both stitched slides`);
  }

  const editable = await renderSlides({
    html: '<section class="slide">editable</section>',
    outputDir: path.join(root, 'editable'),
    baseHref: 'http://127.0.0.1:7456/',
    deck: true,
    editable: true,
  });
  assert.equal(editable.ok, false);
  assert.match(editable.error, /Editable PPTX is unsupported/);
  console.log('container renderer e2e: two-slide PNG/JPEG stitching and editable PPTX rejection passed');
} finally {
  await rm(root, { recursive: true, force: true });
}
