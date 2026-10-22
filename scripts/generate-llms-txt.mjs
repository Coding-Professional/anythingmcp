#!/usr/bin/env node
// Repository documentation for AI clients. No runtime or website output.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = 'https://raw.githubusercontent.com/HelpCode-ai/anythingmcp/main/';
const GITHUB = 'https://github.com/HelpCode-ai/anythingmcp/blob/main/';
const SECTIONS = [
  ['Getting started', ['README.md', 'docs/deployment.md', 'docs/guides.md']],
  ['Connectors', ['docs/connectors/*.md', 'docs/tool-definition.md']],
  ['AI clients', ['docs/integrations/*.md']],
  ['Operations and security', ['docs/operations/*.md', 'docs/sso.md', 'docs/scim-entra-setup.md', 'docs/license-faq.md']],
  ['Reference', ['docs/api-reference.md', 'docs/mcp-resources.md', 'docs/knowledge-graph.md']],
  ['Contributing', ['.github/CONTRIBUTING.md', 'AGENTS.md']],
  ['Optional', ['docs/guides/*.md', 'docs/ROADMAP.md', 'docs/ADOPTERS.md']],
];
const DESCRIPTIONS = {
  'README.md': 'Run AnythingMCP locally, connect an AI client, and discover ready-made connectors.',
  'docs/deployment.md': 'Deploy AnythingMCP with Docker and configure authentication, networking, and production settings.',
  'docs/connectors/login-token-auth.md': 'Build connectors that exchange credentials for cached bearer tokens with automatic refresh and re-login.',
  'docs/api-reference.md': 'REST API reference for authentication, connectors, tools, MCP servers, and administration.',
  'docs/guides/connect-sorare-to-chatgpt.md': 'Connect Sorare fantasy football tools to ChatGPT through AnythingMCP.',
  'docs/guides/connect-sorare-to-claude.md': 'Connect Sorare fantasy football tools to Claude Desktop and Claude Code.',
  'docs/guides/connect-sorare-to-cloud.md': 'Use AnythingMCP Cloud to connect the Sorare GraphQL API without a local server.',
  'docs/guides/connect-sorare-to-copilot.md': 'Use Sorare tools in GitHub Copilot Chat through an AnythingMCP MCP endpoint.',
  'docs/guides/connect-sorare-to-openclaw.md': 'Connect Sorare tools to the self-hosted OpenClaw AI assistant.',
  'docs/guides/sorare-to-mcp.md': 'Expose the Sorare GraphQL API as MCP tools for compatible AI clients.',
  'docs/license-faq.md': 'Understand the AGPL license, the commercial EE boundary, and contributor licensing.',
  '.github/CONTRIBUTING.md': 'Set up development, test changes, and submit a contribution.',
  'AGENTS.md': 'Repository instructions, setup commands, tests, and contribution boundaries for coding agents.',
};

function plain(text) {
  return text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<\/?(?:a|strong|em|b|i|code|span)\b[^>]*>/gi, '').replace(/[*`]/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

export function collectDocuments(root = ROOT) {
  return SECTIONS.map(([title, patterns]) => ({
    title,
    paths: patterns.flatMap(pattern => {
      if (!pattern.includes('*')) return [pattern];
      const dir = posix.dirname(pattern);
      return readdirSync(resolve(root, dir), { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
        .map(entry => `${dir}/${entry.name}`).sort();
    }),
  }));
}

export function absoluteLink(target, source) {
  if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return target;
  const resolved = new URL(target, GITHUB + source);
  // A leading slash denotes a repository-root path in these Markdown docs.
  if (target.startsWith('/')) return GITHUB + target.slice(1);
  return resolved.href;
}

// Scan balanced labels/destinations, including linked badges and URLs with
// parentheses. Keep optional link titles and reference-link definitions.
export function rewriteLinks(markdown, source) {
  const text = markdown.replace(/^( {0,3}\[[^\]\n]+\]:\s*)(<[^>]+>|\S+)(.*)$/gm,
    (_, prefix, url, suffix) => `${prefix}<${absoluteLink(url.replace(/^<|>$/g, ''), source)}>${suffix}`);
  let output = '';
  for (let i = 0; i < text.length;) {
    const image = text[i] === '!' && text[i + 1] === '[';
    const start = i + (image ? 1 : 0);
    if (text[start] !== '[' || (i > 0 && text[i - 1] === '\\')) { output += text[i++]; continue; }
    let end = start + 1;
    let depth = 1;
    for (; end < text.length && depth; end++) {
      if (text[end] === '\\') { end++; continue; }
      if (text[end] === '[') depth++;
      if (text[end] === ']') depth--;
    }
    if (depth) { output += text[i++]; continue; }
    const label = text.slice(start + 1, end - 1);
    if (text[end] === '(') {
      let close = end + 1;
      depth = 1;
      for (; close < text.length && depth; close++) {
        if (text[close] === '\\') { close++; continue; }
        if (text[close] === '(') depth++;
        if (text[close] === ')') depth--;
      }
      if (depth) { output += text[i++]; continue; }
      const destination = text.slice(end + 1, close - 1).match(/^\s*(<[^>]*>|\S+?)(\s+["'][\s\S]*["'])?\s*$/);
      if (!destination) { output += text[i++]; continue; }
      const cleanedLabel = rewriteLinks(label, source);
      if (!image && cleanedLabel.trim()) {
        const url = absoluteLink(destination[1].replace(/^<|>$/g, ''), source);
        output += `[${cleanedLabel}](<${url}>${destination[2] || ''})`;
      }
      i = close;
    } else if (image) {
      const reference = text.slice(end).match(/^\[[^\]\n]*\]/);
      i = end + (reference?.[0].length || 0);
    } else { output += text.slice(i, end); i = end; }
  }
  return output;
}

export function cleanMarkdown(markdown, source) {
  let text = markdown.replace(/\r\n?/g, '\n');
  if (source === 'README.md') {
    text = text.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_, title) => `# ${plain(title)}\n`)
      .replace(/<p\b[^>]*>\s*<strong>(AnythingMCP[\s\S]*?)<\/strong>[\s\S]*?<\/p>/i,
        (_, summary) => `${plain(summary)}\n`);
  }
  text = text.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(picture|p|div|table)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<img\b[^>]*\/?\s*>/gi, '')
    .replace(/^\s*<\/?(?:details|summary)\b[^>]*>.*$/gm, '')
    .replace(/<\/?(?:a|strong|em|b|i|code|pre|br|hr|h[1-6]|span|source)\b[^>]*>/gi, '');
  return rewriteLinks(text, source).replace(/\n{3,}/g, '\n\n').trim();
}

function metadata(content, path) {
  const title = plain(content.match(/^#\s+(.+)$/m)?.[1] || posix.basename(path, '.md'));
  const paragraph = content.split(/\n\s*\n/).find(block => {
    const line = block.trim();
    return line && !/^(?:#|>|[-*]|\d+\.|\||```|~~~|\[)/.test(line);
  }) || title;
  const sentence = plain(paragraph).split(/(?<=[.!?])\s+(?=[A-Z])/)[0];
  const description = DESCRIPTIONS[path] || (sentence.length > 160
    ? sentence.slice(0, 157).replace(/\s+\S*$/, '') + '...' : sentence);
  return { title: title.replace(/([\[\]])/g, '\\$1'), description };
}

export function generate(root = ROOT) {
  const summary = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).description;
  const header = `# AnythingMCP\n\n> ${summary}\n`;
  let index = header;
  let full = header;
  for (const section of collectDocuments(root)) {
    index += `\n## ${section.title}\n\n`;
    for (const path of section.paths) {
      const content = cleanMarkdown(readFileSync(resolve(root, path), 'utf8'), path);
      const { title, description } = metadata(content, path);
      index += `- [${title}](${RAW}${path}): ${description}\n`;
      full += `\n---\n\n## ${path}\n\nSource: ${RAW}${path}\n\n${content}\n`;
    }
  }
  return { 'llms.txt': index, 'llms-full.txt': full };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: node scripts/generate-llms-txt.mjs [--check]');
    const check = process.argv.includes('--check');
    for (const [name, content] of Object.entries(generate())) {
      const path = resolve(ROOT, name);
      if (check) {
        if (!existsSync(path) || readFileSync(path, 'utf8') !== content) {
          console.error(`${name} is stale. Run node scripts/generate-llms-txt.mjs and commit the result.`);
          process.exitCode = 1;
        }
      } else { writeFileSync(path, content, 'utf8'); console.log(`Generated ${name}`); }
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
