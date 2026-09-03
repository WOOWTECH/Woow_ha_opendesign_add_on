import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dataDir = process.env.OD_DATA_DIR || '/data/opendesign';
const rendererPath = process.env.RENDERER_MODULE || '/opt/ha-opendesign/headless-renderer.mjs';
const { renderSlides } = await import(pathToFileURL(rendererPath));
const root = await mkdtemp(path.join(dataDir, 'export-render', 'container-e2e-'));

try {
  const html = '<!doctype html><html><head><style>html,body{margin:0}main{width:320px;height:180px;background:#2367d1;color:white}</style></head><body><main>renderer smoke</main></body></html>';
  for (const [format, magic] of [['png', Buffer.from([0x89, 0x50, 0x4e, 0x47])], ['jpeg', Buffer.from([0xff, 0xd8, 0xff])]]) {
    const outputDir = path.join(root, format);
    const result = await renderSlides({
      html,
      outputDir,
      baseHref: 'http://127.0.0.1:7456/',
      deck: false,
      pageImageFormat: format,
      width: 320,
      height: 180,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.slideFiles?.length, 1);
    const bytes = await readFile(result.slideFiles[0]);
    assert.ok(bytes.length > 100, `${format} output is empty`);
    assert.deepEqual(bytes.subarray(0, magic.length), magic, `${format} signature mismatch`);
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
  console.log('container renderer e2e: PNG/JPEG non-empty; editable PPTX rejected');
} finally {
  await rm(root, { recursive: true, force: true });
}
