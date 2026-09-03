import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseRenderMode,
  confinedOutputPath,
  injectBaseHref,
  isLoopbackHttpUrl,
  planCapture,
  validateRendererInput,
} from '../rootfs/opt/ha-opendesign/headless-renderer.mjs';

test('injectBaseHref inserts an escaped base immediately after head', () => {
  assert.equal(
    injectBaseHref('<html><head class="x"><title>T</title></head></html>', 'http://127.0.0.1:7456/a?x=1&y="q"'),
    '<html><head class="x"><base href="http://127.0.0.1:7456/a?x=1&amp;y=&quot;q&quot;"><title>T</title></head></html>',
  );
  assert.equal(injectBaseHref('<main>x</main>', 'http://localhost:7456/raw/'), '<base href="http://localhost:7456/raw/"><main>x</main>');
});

test('loopback base validation rejects remote or non-http navigation', () => {
  assert.equal(isLoopbackHttpUrl('http://127.0.0.1:7456/raw/'), true);
  assert.equal(isLoopbackHttpUrl('https://localhost/raw/'), true);
  assert.equal(isLoopbackHttpUrl('https://example.com/raw/'), false);
  assert.equal(isLoopbackHttpUrl('file:///etc/passwd'), false);
});

test('renderer input is validated and confined to the daemon export root', () => {
  const valid = validateRendererInput({
    html: '<h1>ok</h1>',
    outputDir: '/tmp/od-test/export-render/job-1',
    baseHref: 'http://127.0.0.1:7456/api/projects/p/raw/',
    width: 1920,
    height: 1080,
  }, { dataDir: '/tmp/od-test' });
  assert.equal(valid.width, 1920);
  assert.equal(valid.pageImageFormat, 'png');
  assert.throws(() => validateRendererInput({ html: 'x', outputDir: '/etc' }, { dataDir: '/tmp/od-test' }), /child of/);
  assert.throws(() => validateRendererInput({ html: 'x', outputDir: 'relative' }, { dataDir: '/tmp/od-test' }), /absolute/);
  assert.throws(() => validateRendererInput({ html: 'x', outputDir: '/tmp/od-test/export-render/job', baseHref: 'https://example.com' }, { dataDir: '/tmp/od-test' }), /loopback/);
});

test('output filenames cannot escape their supplied directory', () => {
  assert.equal(confinedOutputPath('/tmp/export', 'slide-0.png'), '/tmp/export/slide-0.png');
  assert.throws(() => confinedOutputPath('/tmp/export', '../secret'), /basename/);
  assert.throws(() => confinedOutputPath('tmp/export', 'slide.png'), /absolute/);
});

test('deck detection honors explicit caller intent', () => {
  assert.equal(chooseRenderMode(false, 4), 'page');
  assert.equal(chooseRenderMode(true, 0), 'missing-deck');
  assert.equal(chooseRenderMode(true, 3), 'deck');
  assert.equal(chooseRenderMode(undefined, 2), 'deck');
  assert.equal(chooseRenderMode(undefined, 0), 'page');
});

test('capture planning covers one slide, all slides, stitching and pagination', () => {
  assert.deepEqual(planCapture({ mode: 'deck', count: 3 }), { indices: [0, 1, 2], stitch: false });
  assert.deepEqual(planCapture({ mode: 'deck', count: 3, index: 1, stitch: true }), { indices: [1], stitch: true });
  assert.equal(planCapture({ mode: 'deck', count: 2, index: 2 }).errorCode, 'SLIDE_INDEX_OUT_OF_RANGE');
  assert.deepEqual(
    planCapture({ mode: 'page', paginate: true, documentHeight: 2200, viewportHeight: 1000 }).pages,
    [{ y: 0, height: 1000 }, { y: 1000, height: 1000 }, { y: 2000, height: 200 }],
  );
});
