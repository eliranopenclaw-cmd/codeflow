// End-to-end verification: run the same extractor pipeline Phase 2.5 runs in
// index.html, against the real Brain vault, and emit the same export shape
// that exportJSON produces. Proves the parser works on the real-world fixture.

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMarkdownLinks, resolveMarkdownLink } from './md-extractors.mjs';

const IGNORE = new Set(['node_modules', '.git', '.obsidian', '__pycache__', '.DS_Store']);
export const LEGACY_BRAIN_VAULT = '/Users/malcolm/Documents/Claude/Projects/Brain';
export const REPO_LOCAL_VAULT = fileURLToPath(new URL('../../vault', import.meta.url));
const FIXTURE_VAULT = fileURLToPath(new URL('./fixtures/vault', import.meta.url));

function walk(root, base = root, out = []) {
  for (const name of readdirSync(root)) {
    if (IGNORE.has(name)) continue;
    const full = join(root, name);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, base, out);
    else if (s.isFile()) out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

function analyzeVault(vaultPath) {
  const paths = walk(vaultPath).sort();
  const mdPaths = paths.filter((p) => /\.(md|markdown)$/i.test(p));
  const analyzed = paths.map((p) => ({
    path: p,
    name: p.split('/').pop(),
    content: readFileSync(join(vaultPath, p), 'utf8'),
    functions: [],
    dependencies: [],
    layer: 'utils',
    lines: 0,
  }));
  analyzed.forEach((f) => {
    f.lines = f.content.split('\n').length;
  });
  const conns = [];
  const allPaths = analyzed.map((f) => f.path);
  analyzed.forEach((file) => {
    if (!/\.(md|markdown)$/i.test(file.name)) return;
    const links = extractMarkdownLinks(file.content);
    const deps = [];
    for (const link of links) {
      const resolved = resolveMarkdownLink(link.target, file.path, allPaths, link.kind);
      deps.push({ kind: link.kind, raw: link.raw, target: link.target, resolved });
      if (resolved && resolved !== file.path) {
        conns.push({ source: file.path, target: resolved, fn: link.raw, count: 1, kind: link.kind });
      }
    }
    file.dependencies = deps;
    file.layer = 'note';
  });
  return { analyzed, conns, mdPaths };
}

function exportShape(analyzed, conns) {
  return {
    stats: { files: analyzed.length, connections: conns.length },
    files: analyzed.map((f) => ({
      path: f.path,
      fns: f.functions.length,
      layer: f.layer,
      lines: f.lines,
      dependencies: f.dependencies || [],
    })),
    connections: conns,
  };
}

export function resolveBrainVaultPath({ env = process.env, exists = existsSync } = {}) {
  if (env.BRAIN_VAULT) {
    if (!exists(env.BRAIN_VAULT)) {
      throw new Error(`BRAIN_VAULT does not exist: ${env.BRAIN_VAULT}`);
    }
    return env.BRAIN_VAULT;
  }
  if (exists(REPO_LOCAL_VAULT)) return REPO_LOCAL_VAULT;
  return LEGACY_BRAIN_VAULT;
}

function buildTargets(env = process.env) {
  const targets = [{ label: 'Test fixtures', path: FIXTURE_VAULT }];
  const brainVaultPath = resolveBrainVaultPath({ env });
  if (brainVaultPath && existsSync(brainVaultPath)) {
    targets.unshift({ label: 'Brain vault', path: brainVaultPath });
  }
  return targets;
}

export function runVerification({ env = process.env } = {}) {
  const targets = buildTargets(env);
  const outPath = env.OUT || '/tmp/codeflow-verify.json';
  const results = {};

  for (const t of targets) {
    const r = analyzeVault(t.path);
    const exp = exportShape(r.analyzed, r.conns);
    const wiki = r.conns.filter((c) => c.kind === 'wikilink');
    const md = r.conns.filter((c) => c.kind === 'mdlink');
    const totalLinks = r.analyzed.reduce((s, f) => s + (f.dependencies?.length || 0), 0);
    const resolvedLinks = r.analyzed.reduce(
      (s, f) => s + (f.dependencies?.filter((d) => d.resolved).length || 0),
      0,
    );
    results[t.label] = {
      vault: t.path,
      mdFiles: r.mdPaths.length,
      totalLinks,
      resolvedLinks,
      wikilinkEdges: wiki.length,
      mdlinkEdges: md.length,
      sampleWikilink: wiki[0] || null,
      sampleMdlink: md[0] || null,
      export: exp,
    };
  }

  writeFileSync(outPath, JSON.stringify(results, null, 2));
  return { outPath, results };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { outPath, results } = runVerification();

  for (const [label, r] of Object.entries(results)) {
    console.log(`\n=== ${label} (${r.vault}) ===`);
    console.log(`  .md files scanned: ${r.mdFiles}`);
    console.log(`  links extracted:   ${r.totalLinks}`);
    console.log(`  links resolved:    ${r.resolvedLinks}`);
    console.log(`  wikilink edges:    ${r.wikilinkEdges}`);
    console.log(`  mdlink edges:      ${r.mdlinkEdges}`);
    if (r.sampleWikilink) {
      console.log(`  sample wikilink:   ${r.sampleWikilink.source} -> ${r.sampleWikilink.target} (${r.sampleWikilink.fn})`);
    }
    if (r.sampleMdlink) {
      console.log(`  sample mdlink:     ${r.sampleMdlink.source} -> ${r.sampleMdlink.target} (${r.sampleMdlink.fn})`);
    }
  }
  console.log(`\nFull report written to ${outPath}`);
}
