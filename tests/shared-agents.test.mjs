import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initializeSharedAgents, statusSharedAgents } from '../rootfs/opt/ha-opendesign/shared-agents.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ha-opendesign-shared-'));
  const home = path.join(root, 'home');
  const dataDir = path.join(root, 'data');
  await mkdir(home);
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, home, dataDir };
}

test('initializes all skill paths as links to one persistent source and is repeatable', async (t) => {
  const f = await fixture(t);
  const first = await initializeSharedAgents(f);
  const source = path.join(f.dataDir, 'shared/skills');
  await mkdir(path.join(source, 'common-skill'));
  await writeFile(path.join(source, 'common-skill/SKILL.md'), '---\nname: common-skill\ndescription: Shared\n---\n');

  for (const relative of ['.claude/skills', '.agents/skills', '.pi/agent/skills', '.config/opencode/skills']) {
    const link = path.join(f.home, relative);
    assert.equal(await realpath(link), source);
    assert.match(await readFile(path.join(link, 'common-skill/SKILL.md'), 'utf8'), /name: common-skill/);
  }
  const second = await initializeSharedAgents(f);
  assert.equal(first.sharedRoot, second.sharedRoot);
  assert.equal((await statusSharedAgents(f)).mcpServerCount, 0);
});

test('migrates preexisting skills and keeps a backup plus conflicting content', async (t) => {
  const f = await fixture(t);
  const sharedSkills = path.join(f.dataDir, 'shared/skills');
  await mkdir(path.join(sharedSkills, 'same'), { recursive: true });
  await writeFile(path.join(sharedSkills, 'same/SKILL.md'), 'canonical');
  const old = path.join(f.home, '.pi/agent/skills');
  await mkdir(path.join(old, 'same'), { recursive: true });
  await mkdir(path.join(old, 'old-skill'));
  await writeFile(path.join(old, 'same/SKILL.md'), 'old local');
  await writeFile(path.join(old, 'old-skill/SKILL.md'), 'old skill');

  const result = await initializeSharedAgents(f);
  assert.equal(await realpath(old), sharedSkills);
  assert.match(await readFile(path.join(sharedSkills, 'old-skill/SKILL.md'), 'utf8'), /old skill/);
  assert.match(await readFile(path.join(sharedSkills, '.migration-conflicts/pi/same/SKILL.md'), 'utf8'), /old local/);
  assert.equal(result.skills.pi.migrated, 1);
});

test('rejects a skills symlink that points outside the canonical store', async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.root, 'outside');
  await mkdir(outside);
  await mkdir(path.join(f.home, '.agents'), { recursive: true });
  await symlink(outside, path.join(f.home, '.agents/skills'));
  await assert.rejects(initializeSharedAgents(f), /refusing unexpected skills symlink/);
});

test('translates MCP catalog to all native formats and preserves unrelated settings', async (t) => {
  const f = await fixture(t);
  await initializeSharedAgents(f);
  await writeFile(path.join(f.dataDir, 'shared/mcp/servers.json'), JSON.stringify({
    version: 1,
    servers: [
      { name: 'docs', command: 'node', args: ['server.js', '--safe'] },
      { name: 'remote', url: 'https://example.invalid/mcp', headers: { 'X-Region': 'west' } },
      { name: 'disabled', command: 'unsafe', enabled: false },
    ],
  }));
  await writeFile(path.join(f.home, '.claude.json'), JSON.stringify({ theme: 'dark', mcpServers: { personal: { command: 'mine' } } }));
  await writeFile(path.join(f.home, '.config/opencode/opencode.json'), JSON.stringify({ model: 'test/model', mcp: { personal: { type: 'remote', url: 'https://personal.invalid' } } }));
  await writeFile(path.join(f.home, '.codex/config.toml'), 'model = "test"\n');

  await initializeSharedAgents(f);
  const claude = JSON.parse(await readFile(path.join(f.home, '.claude.json'), 'utf8'));
  const pi = JSON.parse(await readFile(path.join(f.home, '.pi/agent/mcp.json'), 'utf8'));
  const opencode = JSON.parse(await readFile(path.join(f.home, '.config/opencode/opencode.json'), 'utf8'));
  const codex = await readFile(path.join(f.home, '.codex/config.toml'), 'utf8');
  assert.equal(claude.theme, 'dark');
  assert.equal(claude.mcpServers.personal.command, 'mine');
  assert.equal(claude.mcpServers['ha-shared-docs'].command, 'node');
  assert.equal(pi.mcpServers['ha-shared-remote'].url, 'https://example.invalid/mcp');
  assert.equal(opencode.model, 'test/model');
  assert.equal(opencode.mcp.personal.url, 'https://personal.invalid');
  assert.deepEqual(opencode.mcp['ha-shared-docs'].command, ['node', 'server.js', '--safe']);
  assert.match(codex, /^model = "test"/);
  assert.match(codex, /\[mcp_servers\.ha-shared-docs\]/);
  assert.match(codex, /http_headers = \{ "X-Region" = "west" \}/);
  assert.doesNotMatch(codex, /mcp_servers\.ha-shared-disabled/);
  assert.equal((await statusSharedAgents(f)).mcpServerCount, 2);
});

test('rejects malformed MCP entries and does not replace user settings on error', async (t) => {
  const f = await fixture(t);
  await initializeSharedAgents(f);
  await writeFile(path.join(f.home, '.claude.json'), '{"keep":true}\n');
  await writeFile(path.join(f.dataDir, 'shared/mcp/servers.json'), '{"version":1,"servers":[{"name":"oops","command":"x","url":"https://example.invalid"}]}');
  await assert.rejects(initializeSharedAgents(f), /must define exactly one/);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.home, '.claude.json'), 'utf8')), { keep: true });
});

test('discovers portable plugin components and reports missing native adapters', async (t) => {
  const f = await fixture(t);
  const first = await initializeSharedAgents(f);
  await mkdir(path.join(f.dataDir, 'shared/skills/grill-me'), { recursive: true });
  await writeFile(path.join(f.dataDir, 'shared/skills/grill-me/SKILL.md'), 'portable skill');
  const pluginDir = path.join(f.dataDir, 'shared/plugins/team-tools');
  await mkdir(pluginDir, { recursive: true });
  await writeFile(path.join(pluginDir, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    name: 'team-tools',
    components: { skills: ['grill-me'], mcpServers: [] },
    nativeAdapters: { claude: 'claude/plugin.json', opencode: 'opencode/plugin.ts' },
  }));
  await mkdir(path.join(pluginDir, 'claude'));
  await writeFile(path.join(pluginDir, 'claude/plugin.json'), '{}');
  const result = await initializeSharedAgents(f);
  assert.deepEqual(result.plugins, [{
    name: 'team-tools',
    skills: ['grill-me'],
    mcpServers: [],
    missingSkills: [],
    missingServers: [],
    nativeAdapters: { claude: true, opencode: false },
  }]);
  assert.equal(first.plugins.length, 0);
});
