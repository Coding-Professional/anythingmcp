import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { absoluteLink, cleanMarkdown, collectDocuments, generate, rewriteLinks } from './generate-llms-txt.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('index covers the requested files in stable order with existing raw links', () => {
  const sections = collectDocuments();
  assert.deepEqual(sections.map(s => s.title), [
    'Getting started', 'Connectors', 'AI clients', 'Operations and security', 'Reference', 'Contributing', 'Optional',
  ]);
  const paths = sections.flatMap(s => s.paths);
  assert.equal(paths.length, new Set(paths).size);
  assert.ok(paths.length > 30);
  assert.ok(paths.includes('AGENTS.md'));
  assert.ok(!paths.some(p => p.startsWith('content/') || /^README\.[^.]+\.md$/.test(p)));
  const outputs = generate();
  assert.deepEqual(outputs, generate());
  const links = [...outputs['llms.txt'].matchAll(/\]\(https:\/\/raw\.githubusercontent\.com\/HelpCode-ai\/anythingmcp\/main\/([^)]*)\)/g)];
  assert.deepEqual(links.map(m => m[1]), paths);
  for (const [, path] of links) assert.ok(existsSync(resolve(ROOT, path)), path);
  const description = JSON.parse(readFileSync(resolve(ROOT, 'package.json'))).description;
  assert.ok(outputs['llms.txt'].startsWith(`# AnythingMCP\n\n> ${description}\n`));
  let offset = 0;
  for (const path of paths) {
    const next = outputs['llms-full.txt'].indexOf(`## ${path}\n`, offset);
    assert.ok(next >= offset, path);
    offset = next + 1;
  }
  for (const content of Object.values(outputs)) assert.ok(!content.includes('\r'));
  for (const line of outputs['llms.txt'].split('\n').filter(line => line.startsWith('- ['))) {
    assert.ok(line.slice(line.indexOf('): ') + 3).length <= 160, line);
  }
});

test('full text has no images or relative inline/reference Markdown links', () => {
  const full = generate()['llms-full.txt'];
  assert.doesNotMatch(full, /<\/?(?:picture|img)\b|!\[/i);
  for (const [, url] of full.matchAll(/\]\(<?([^\s)>]+)/g)) {
    assert.match(url, /^(?:[a-z][a-z\d+.-]*:|\/\/)/i, url);
  }
  for (const [, url] of full.matchAll(/^ {0,3}\[[^\]\n]+\]:\s*<?([^\s>]+)/gm)) {
    assert.match(url, /^(?:[a-z][a-z\d+.-]*:|\/\/)/i, url);
  }
  assert.match(full, /# AnythingMCP: self-hosted MCP gateway/);
  assert.match(full, /AnythingMCP is an open-source, self-hosted MCP gateway/);
  assert.match(full, /### How do I create a custom connector for Claude\?/);
  assert.doesNotMatch(full, /star-history\.com|badges\/banner\.png/);
});

test('rewrites fragments, nested paths, reference links and balanced destinations', () => {
  const source = 'docs/connectors/rest.md';
  const github = 'https://github.com/HelpCode-ai/anythingmcp/blob/main/';
  assert.equal(absoluteLink('../guides.md#setup', source), `${github}docs/guides.md#setup`);
  assert.equal(absoluteLink('#auth', source), `${github}${source}#auth`);
  assert.equal(absoluteLink('/README.md', source), `${github}README.md`);
  const markdown = '[API](../api-reference.md "API docs")\n[Guide](../guide_(new).md#intro)\n[ref]: <../../README.md#setup> "README"\n[Email](mailto:test@example.com)';
  const result = rewriteLinks(markdown, source);
  assert.ok(result.includes(`[API](<${github}docs/api-reference.md> "API docs")`));
  assert.ok(result.includes(`[Guide](<${github}docs/guide_(new).md#intro>)`));
  assert.ok(result.includes(`[ref]: <${github}README.md#setup> "README"`));
  assert.ok(result.includes('[Email](<mailto:test@example.com>)'));
});

test('removes linked/reference images and HTML blocks without losing text or placeholders', () => {
  const input = '# Heading\n\nA useful paragraph with `LOGIN_TOKEN` and `/mcp/<serverId>`.\n\n' +
    '<picture><source srcset="banner.svg"><img src="banner.png"></picture>\n' +
    '<div>HTML-only content</div>\n<img src="logo.svg" />\n' +
    '[![badge](badge.svg)](https://example.com) ![alt][logo]\n' +
    '<details>\n<summary>More</summary>\n\nKeep this Markdown.\n</details>\n' +
    '<https://example.com> [Keep](../README.md)\n';
  const output = cleanMarkdown(input, 'docs/example.md');
  assert.doesNotMatch(output, /badge|HTML-only|<picture|<img|!\[/);
  assert.ok(output.includes('Keep this Markdown.'));
  assert.ok(output.includes('### More'));
  assert.ok(output.includes('/mcp/<serverId>'));
  assert.ok(output.includes('<https://example.com>'));
});

test('CLI resolves its own root, detects changed or missing output, and regenerates deterministically', t => {
  const fixture = mkdtempSync(resolve(tmpdir(), 'amcp-llms-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const paths = collectDocuments().flatMap(section => section.paths);
  for (const path of [...paths, 'package.json', 'scripts/generate-llms-txt.mjs']) {
    mkdirSync(dirname(resolve(fixture, path)), { recursive: true });
    cpSync(resolve(ROOT, path), resolve(fixture, path));
  }
  const run = (...args) => spawnSync(process.execPath, [resolve(fixture, 'scripts/generate-llms-txt.mjs'), ...args],
    { cwd: tmpdir(), encoding: 'utf8' });
  assert.equal(run('--check').status, 1);
  assert.equal(run().status, 0);
  const first = readFileSync(resolve(fixture, 'llms-full.txt'));
  assert.equal(run().status, 0);
  assert.deepEqual(readFileSync(resolve(fixture, 'llms-full.txt')), first);
  assert.equal(run('--check').status, 0);
  const doc = resolve(fixture, 'docs/guides.md');
  writeFileSync(doc, readFileSync(doc, 'utf8') + '\nA new documentation paragraph.\n');
  const stale = run('--check');
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /llms-full.txt is stale/);
  assert.equal(run().status, 0);
  assert.equal(run('--check').status, 0);
  writeFileSync(resolve(fixture, 'docs/connectors/aaa-new.md'), '# New connector\r\n\r\nA newly added connector guide.\r\n');
  assert.equal(run('--check').status, 1);
  assert.equal(run().status, 0);
  const expanded = readFileSync(resolve(fixture, 'llms.txt'), 'utf8');
  assert.ok(expanded.indexOf('aaa-new.md') < expanded.indexOf('docs/connectors/database.md'));
  assert.ok(expanded.includes(': A newly added connector guide.'));
  assert.equal(run('--check').status, 0);
  // Byte checks also reject CRLF artifacts rather than silently accepting drift.
  const index = resolve(fixture, 'llms.txt');
  writeFileSync(index, readFileSync(index, 'utf8').replace(/\n/g, '\r\n'));
  assert.equal(run('--check').status, 1);
  assert.equal(run('--unknown').status, 1);
});
