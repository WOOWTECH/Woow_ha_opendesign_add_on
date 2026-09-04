import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const baseUrl = process.env.OD_EXPORT_BASE_URL;
const ingressPath = process.env.OD_EXPORT_INGRESS_PATH;
if (!baseUrl || !ingressPath) {
  throw new Error('OD_EXPORT_BASE_URL and OD_EXPORT_INGRESS_PATH must be set');
}

const fixturePath = process.env.OD_EXPORT_FIXTURE_PATH || fileURLToPath(new URL('./fixtures/export-deck.html', import.meta.url));
const projectId = `export-http-${randomUUID()}`;
const title = 'OpenDesign 匯出驗證 🎨';

function endpoint(requestPath) {
  return new URL(requestPath, baseUrl).toString();
}

async function request(requestPath, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('X-Ingress-Path', ingressPath);
  return fetch(endpoint(requestPath), { ...options, headers });
}

async function requestJson(requestPath, body) {
  return request(requestPath, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function assertStatus(response, expectedStatus) {
  if (response.status !== expectedStatus) {
    assert.fail(`expected HTTP ${expectedStatus}, received ${response.status}: ${await response.text()}`);
  }
}

function assertAttachment(response, expectedType) {
  assert.match(response.headers.get('content-type') || '', expectedType);
  assert.match(response.headers.get('content-disposition') || '', /attachment/i);
}

function zipMemberNames(bytes) {
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const minimumEocdOffset = Math.max(0, bytes.length - 65_557);
  let eocdOffset = -1;
  for (let offset = bytes.length - 22; offset >= minimumEocdOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }
  assert.notEqual(eocdOffset, -1, 'ZIP end-of-central-directory record is required');
  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  let offset = bytes.readUInt32LE(eocdOffset + 16);
  const names = [];
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(bytes.readUInt32LE(offset), centralSignature, 'ZIP central-directory entry is required');
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    names.push(bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

const fixture = await readFile(fixturePath, 'utf8');

const create = await requestJson('/api/projects', {
  id: projectId,
  name: 'Export HTTP contract',
  skipDiscoveryBrief: true,
});
await assertStatus(create, 200);

const upload = await requestJson(`/api/projects/${encodeURIComponent(projectId)}/files`, {
  name: 'export-deck.html',
  content: fixture,
});
await assertStatus(upload, 200);

const html = await requestJson(`/api/projects/${encodeURIComponent(projectId)}/export/html`, {
  fileName: 'export-deck.html',
  title,
});
await assertStatus(html, 200);
assertAttachment(html, /^text\/html\b/i);
const htmlBody = await html.text();
assert.ok(htmlBody.length > 0, 'HTML export must not be empty');
assert.match(htmlBody, /第一張 \/ Slide one/);
assert.match(htmlBody, /第二張 \/ Slide two/);

const malformedHtml = await requestJson(`/api/projects/${encodeURIComponent(projectId)}/export/html`, { title });
await assertStatus(malformedHtml, 400);
assert.doesNotMatch(malformedHtml.headers.get('content-type') || '', /^text\/html\b/i);
assert.doesNotMatch(malformedHtml.headers.get('content-disposition') || '', /attachment/i);
const malformedBody = await malformedHtml.json();
assert.equal(typeof malformedBody?.error?.code, 'string');
assert.equal(typeof malformedBody?.error?.message, 'string');

const archive = await request(`/api/projects/${encodeURIComponent(projectId)}/archive`);
await assertStatus(archive, 200);
assertAttachment(archive, /^application\/zip\b/i);
const archiveBytes = Buffer.from(await archive.arrayBuffer());
assert.deepEqual(archiveBytes.subarray(0, 2), Buffer.from('PK'));
const members = zipMemberNames(archiveBytes);
assert.ok(members.includes('export-deck.html'), JSON.stringify(members));
for (const member of members) {
  assert.ok(!member.startsWith('/'), member);
  assert.ok(!member.split('/').includes('..'), member);
}

console.log('export HTTP contract: HTML attachment/error and normal ZIP archive passed');
