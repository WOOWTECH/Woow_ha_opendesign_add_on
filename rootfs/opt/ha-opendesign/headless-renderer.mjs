import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 1000;
const MAX_DIMENSION = 8192;
const MAX_DOCUMENT_HEIGHT = 30_000;
const MAX_PIXELS = 120_000_000;
const MAX_HTML_BYTES = 32 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 120_000;
const SLIDE_SELECTOR = '.slide, [data-screen-label], .deck-slide, .ppt-slide';
const CHROME_SELECTOR = '.progress-bar, .notes-overlay, aside.notes, .speaker-notes, .deck-nav, .deck-hint, .deck-counter';

function escapeHtmlAttribute(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function injectBaseHref(html, baseHref) {
  if (!baseHref) return html;
  const tag = `<base href="${escapeHtmlAttribute(baseHref)}">`;
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${tag}`);
  }
  return `${tag}${html}`;
}

export function isLoopbackHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

function positiveDimension(value, fallback, label) {
  if (value == null) return fallback;
  if (!Number.isFinite(value) || value < 1 || value > MAX_DIMENSION) {
    throw new Error(`${label} must be between 1 and ${MAX_DIMENSION}`);
  }
  return Math.round(value);
}

export function confinedOutputPath(outputDir, filename) {
  if (!path.isAbsolute(outputDir)) throw new Error('outputDir must be an absolute path');
  if (typeof filename !== 'string' || filename.length === 0 || path.basename(filename) !== filename) {
    throw new Error('output filename must be a basename');
  }
  const output = path.resolve(outputDir, filename);
  const relative = path.relative(path.resolve(outputDir), output);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('output path escapes outputDir');
  }
  return output;
}

export function validateRendererInput(value, options = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('renderer input must be an object');
  const html = value.html;
  if (typeof html !== 'string' || html.length === 0) throw new Error('html must be a non-empty string');
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw new Error('html exceeds the 32 MiB render limit');
  if (typeof value.outputDir !== 'string' || !path.isAbsolute(value.outputDir)) {
    throw new Error('outputDir must be supplied as an absolute path');
  }
  const dataDir = path.resolve(options.dataDir ?? process.env.OD_DATA_DIR ?? '/data/opendesign');
  const exportRoot = path.resolve(dataDir, 'export-render');
  const outputDir = path.resolve(value.outputDir);
  const relative = path.relative(exportRoot, outputDir);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`outputDir must be a child of ${exportRoot}`);
  }
  if (value.baseHref != null && !isLoopbackHttpUrl(value.baseHref)) {
    throw new Error('baseHref must be an HTTP(S) loopback URL');
  }
  if (value.deck != null && typeof value.deck !== 'boolean') throw new Error('deck must be boolean');
  if (value.editable != null && typeof value.editable !== 'boolean') throw new Error('editable must be boolean');
  if (value.stitch != null && typeof value.stitch !== 'boolean') throw new Error('stitch must be boolean');
  if (value.paginate != null && typeof value.paginate !== 'boolean') throw new Error('paginate must be boolean');
  if (value.pageImageFormat != null && !['png', 'jpeg'].includes(value.pageImageFormat)) {
    throw new Error('pageImageFormat must be png or jpeg');
  }
  if (value.index != null && (!Number.isInteger(value.index) || value.index < 0 || value.index > 9999)) {
    throw new Error('index must be a non-negative integer');
  }
  return {
    ...value,
    html,
    outputDir,
    width: positiveDimension(value.width, DEFAULT_WIDTH, 'width'),
    height: positiveDimension(value.height, DEFAULT_HEIGHT, 'height'),
    pageImageFormat: value.pageImageFormat === 'jpeg' ? 'jpeg' : 'png',
  };
}

export function chooseRenderMode(deck, slideCount) {
  if (deck === true && slideCount === 0) return 'missing-deck';
  if (deck === false) return 'page';
  return slideCount > 0 ? 'deck' : 'page';
}

export function planCapture({ mode, count, index, stitch, paginate, documentHeight, viewportHeight }) {
  if (mode === 'deck') {
    if (index != null && index >= count) return { errorCode: 'SLIDE_INDEX_OUT_OF_RANGE', indices: [] };
    return { indices: index == null ? Array.from({ length: count }, (_, i) => i) : [index], stitch: stitch === true };
  }
  const height = Math.max(1, Math.ceil(documentHeight));
  if (!paginate) return { pages: [{ y: 0, height }] };
  const pages = [];
  for (let y = 0; y < height; y += viewportHeight) pages.push({ y, height: Math.min(viewportHeight, height - y) });
  return { pages };
}

function executablePath() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('system Chromium executable not found');
  return found;
}

async function canonicalOutputDir(outputDir) {
  await mkdir(outputDir, { recursive: true });
  return realpath(outputDir);
}

function screenshotOptions(filepath, format) {
  return format === 'jpeg'
    ? { path: filepath, type: 'jpeg', quality: 88 }
    : { path: filepath, type: 'png' };
}

async function settleDocument(page) {
  await page.evaluate(async () => {
    const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
    const fonts = document.fonts?.ready?.catch?.(() => undefined) ?? Promise.resolve();
    const images = Promise.all(Array.from(document.images).map((image) => {
      if (image.complete) return Promise.resolve();
      return new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      });
    }));
    await Promise.race([Promise.all([fonts, images]), timeout]);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function realSlides(page) {
  return page.evaluate((selector) => Array.from(document.querySelectorAll(selector))
    .filter((element) => !element.closest('.mini-slide, .overview, .notes-overlay, .thumb')).length, SLIDE_SELECTOR);
}

async function measureDeck(page, fallback) {
  return page.evaluate(({ selector, fallback }) => {
    const slides = Array.from(document.querySelectorAll(selector))
      .filter((element) => !element.closest('.mini-slide, .overview, .notes-overlay, .thumb'));
    const element = slides.find((slide) => slide.getBoundingClientRect().width > 1) ?? slides[0];
    if (!element) return fallback;
    const stage = element.closest('deck-stage, #deck-stage, .deck-stage');
    const target = stage ?? element;
    const style = getComputedStyle(target);
    const width = Number.parseFloat(target.getAttribute('width') || target.style.width || style.width) || target.offsetWidth;
    const height = Number.parseFloat(target.getAttribute('height') || target.style.height || style.height) || target.offsetHeight;
    if (width < 1 || height < 1 || width > 8192 || height > 8192) return fallback;
    return { width: Math.round(width), height: Math.round(height) };
  }, { selector: SLIDE_SELECTOR, fallback });
}

async function stageSlide(page, index, size) {
  return page.evaluate(({ selector, chromeSelector, index, size }) => {
    document.getElementById('__od_headless_capture_layer')?.remove();
    document.querySelectorAll(chromeSelector).forEach((element) => element.style.setProperty('display', 'none', 'important'));
    document.querySelectorAll('deck-stage, #deck-stage, .deck-stage').forEach((stage) => {
      stage.setAttribute('noscale', '');
      stage.style.setProperty('transform', 'none', 'important');
    });
    const slides = Array.from(document.querySelectorAll(selector))
      .filter((element) => !element.closest('.mini-slide, .overview, .notes-overlay, .thumb'));
    const selected = slides[index];
    if (!selected) return false;
    slides.forEach((slide, current) => {
      const active = current === index;
      ['active', 'visible', 'is-active', 'current'].forEach((name) => slide.classList.toggle(name, active));
      slide.toggleAttribute('data-od-deck-active', active);
      slide.style.setProperty('visibility', active ? 'visible' : 'hidden', 'important');
      slide.style.setProperty('opacity', active ? '1' : '0', 'important');
    });
    const layer = document.createElement('div');
    layer.id = '__od_headless_capture_layer';
    layer.style.cssText = `position:fixed!important;inset:0 auto auto 0!important;width:${size.width}px!important;height:${size.height}px!important;overflow:hidden!important;z-index:2147483647!important;background:${getComputedStyle(document.body).backgroundColor || '#fff'}!important`;
    selected.style.setProperty('position', 'absolute', 'important');
    selected.style.setProperty('inset', '0', 'important');
    selected.style.setProperty('margin', '0', 'important');
    selected.style.setProperty('transform', 'none', 'important');
    selected.style.setProperty('width', `${size.width}px`, 'important');
    selected.style.setProperty('height', `${size.height}px`, 'important');
    layer.appendChild(selected);
    document.documentElement.appendChild(layer);
    return true;
  }, { selector: SLIDE_SELECTOR, chromeSelector: CHROME_SELECTOR, index, size });
}

async function stitchFiles(browser, files, outputDir, format, width, height) {
  const scale = Math.min(1, MAX_DOCUMENT_HEIGHT / (height * files.length), Math.sqrt(MAX_PIXELS / (width * height * files.length)));
  const outputWidth = Math.max(1, Math.floor(width * scale));
  const outputHeight = Math.max(1, Math.floor(height * scale)) * files.length;
  const sources = await Promise.all(files.map(async (file) => `data:image/${format};base64,${(await readFile(file)).toString('base64')}`));
  const page = await browser.newPage({ viewport: { width: outputWidth, height: Math.min(outputHeight, DEFAULT_HEIGHT) } });
  try {
    await page.setContent(`<style>html,body{margin:0;background:#fff}img{display:block;width:${outputWidth}px;height:${Math.floor(height * scale)}px}</style>${sources.map((src) => `<img src="${src}">`).join('')}`);
    const ext = format === 'jpeg' ? 'jpg' : 'png';
    const filepath = confinedOutputPath(outputDir, `stitched.${ext}`);
    await page.screenshot({ ...screenshotOptions(filepath, format), fullPage: true });
    return { files: [filepath], width: outputWidth, height: outputHeight };
  } finally {
    await page.close();
  }
}

async function captureDeck(browser, page, input, count) {
  const requested = { width: input.width, height: input.height };
  const size = input.width !== DEFAULT_WIDTH || input.height !== DEFAULT_HEIGHT
    ? requested
    : await measureDeck(page, { width: 1920, height: 1080 });
  await page.setViewportSize(size);
  const plan = planCapture({ mode: 'deck', count, index: input.index, stitch: input.stitch });
  if (plan.errorCode) {
    return { ok: false, error: `slide index ${input.index} is out of range (deck has ${count} slide(s))`, errorCode: plan.errorCode };
  }
  const files = [];
  const ext = input.pageImageFormat === 'jpeg' ? 'jpg' : 'png';
  for (const index of plan.indices) {
    if (!await stageSlide(page, index, size)) return { ok: false, error: 'slide disappeared during capture', errorCode: 'RENDER_FAILED' };
    await page.waitForTimeout(50);
    const filepath = confinedOutputPath(input.outputDir, `slide-${index}.${ext}`);
    await page.screenshot({ ...screenshotOptions(filepath, input.pageImageFormat), clip: { x: 0, y: 0, width: size.width, height: size.height } });
    files.push(filepath);
  }
  if (plan.stitch && files.length > 1) {
    const stitched = await stitchFiles(browser, files, input.outputDir, input.pageImageFormat, size.width, size.height);
    return { ok: true, slideFiles: stitched.files, width: stitched.width, height: stitched.height, mode: 'deck' };
  }
  return { ok: true, slideFiles: files, width: size.width, height: size.height, mode: 'deck' };
}

async function capturePage(page, input) {
  await page.setViewportSize({ width: input.width, height: input.height });
  const dimensions = await page.evaluate(() => ({
    width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0, 1),
    height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0, 1),
  }));
  if (dimensions.height > MAX_DOCUMENT_HEIGHT || dimensions.width * dimensions.height > MAX_PIXELS) {
    return { ok: false, error: 'page exceeds the bounded capture size', errorCode: 'PAGE_TOO_TALL' };
  }
  const plan = planCapture({ mode: 'page', paginate: input.paginate, documentHeight: dimensions.height, viewportHeight: input.height });
  const files = [];
  const ext = input.pageImageFormat === 'jpeg' ? 'jpg' : 'png';
  for (let index = 0; index < plan.pages.length; index += 1) {
    const segment = plan.pages[index];
    const filepath = confinedOutputPath(input.outputDir, `page-${index}.${ext}`);
    if (input.paginate) {
      await page.screenshot({ ...screenshotOptions(filepath, input.pageImageFormat), clip: { x: 0, y: segment.y, width: Math.min(input.width, dimensions.width), height: segment.height } });
    } else {
      await page.screenshot({ ...screenshotOptions(filepath, input.pageImageFormat), fullPage: true });
    }
    files.push(filepath);
  }
  return { ok: true, slideFiles: files, width: dimensions.width, height: input.paginate ? input.height : dimensions.height, mode: 'page' };
}

export async function renderSlides(rawInput) {
  let browser;
  const deadline = setTimeout(() => void browser?.close().catch(() => {}), RENDER_TIMEOUT_MS);
  deadline.unref?.();
  try {
    const input = validateRendererInput(rawInput);
    if (input.editable === true) {
      return { ok: false, error: 'Editable PPTX is unsupported in the Home Assistant add-on; choose screenshot PPTX.', errorCode: 'RENDER_FAILED' };
    }
    input.outputDir = await canonicalOutputDir(input.outputDir);
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch({
      executablePath: executablePath(),
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    });
    const page = await browser.newPage({ viewport: { width: input.width, height: input.height } });
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(15_000);
    page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
    page.on('popup', (popup) => popup.close().catch(() => {}));
    await page.setContent(injectBaseHref(input.html, input.baseHref), { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await settleDocument(page);
    const count = await realSlides(page);
    const mode = chooseRenderMode(input.deck, count);
    if (mode === 'missing-deck') return { ok: false, error: 'no slide surfaces found in this deck', errorCode: 'NO_SLIDES' };
    return mode === 'deck' ? await captureDeck(browser, page, input, count) : await capturePage(page, input);
  } catch (error) {
    return { ok: false, error: `headless renderer failed: ${error instanceof Error ? error.message : String(error)}`, errorCode: 'RENDER_FAILED' };
  } finally {
    clearTimeout(deadline);
    await browser?.close().catch(() => {});
  }
}

export async function exportPdf(input) {
  let browser;
  const deadline = setTimeout(() => void browser?.close().catch(() => {}), RENDER_TIMEOUT_MS);
  deadline.unref?.();
  try {
    if (!input || typeof input.html !== 'string' || input.html.length === 0) throw new Error('html must be supplied');
    if (input.baseHref != null && !isLoopbackHttpUrl(input.baseHref)) throw new Error('baseHref must be an HTTP(S) loopback URL');
    const dataDir = path.resolve(process.env.OD_DATA_DIR ?? '/data/opendesign');
    const outputDir = path.join(dataDir, 'export-pdf');
    await mkdir(outputDir, { recursive: true });
    const filepath = confinedOutputPath(outputDir, `vector-${Date.now()}-${process.pid}.pdf`);
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch({ executablePath: executablePath(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15_000);
    await page.setContent(injectBaseHref(input.html, input.baseHref), { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await settleDocument(page);
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true, format: 'A4' });
    await writeFile(filepath, pdf);
    return { ok: true, path: filepath };
  } catch (error) {
    return { ok: false, error: `headless PDF export failed: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    clearTimeout(deadline);
    await browser?.close().catch(() => {});
  }
}

export const RENDER_LIMITS = Object.freeze({ RENDER_TIMEOUT_MS, MAX_DIMENSION, MAX_DOCUMENT_HEIGHT, MAX_PIXELS });
