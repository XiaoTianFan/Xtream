import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const srcRoot = join(root, 'src');
const codeExtensions = new Set(['.ts', '.tsx', '.js', '.jsx']);
const styleExtensions = new Set(['.css', '.scss', '.sass']);
const markupExtensions = new Set(['.html']);
const ignoredDirs = new Set(['node_modules', 'dist', 'release', '.git']);

function extensionOf(path) {
  const match = path.match(/(\.[^.\\/]+)$/);
  return match ? match[1].toLowerCase() : '';
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function count(pattern, text) {
  return [...text.matchAll(pattern)].length;
}

function analyze(file) {
  const text = readFileSync(file, 'utf8');
  const ext = extensionOf(file);
  const lines = text.split(/\r?\n/);
  const nonBlank = lines.filter((line) => line.trim()).length;
  const commentish = lines.filter((line) => /^\s*(\/\/|\/\*|\*|<!--|#)/.test(line)).length;
  const rel = relative(root, file).replaceAll('\\', '/');
  const isTest = /\.(test|spec)\.[cm]?[tj]sx?$/.test(rel) || /\.dom\.test\.[cm]?[tj]sx?$/.test(rel);
  const isCode = codeExtensions.has(ext);
  const isStyle = styleExtensions.has(ext);
  const isMarkup = markupExtensions.has(ext);

  return {
    file: rel,
    ext,
    bytes: statSync(file).size,
    lines: lines.length,
    nonBlank,
    commentish,
    isTest,
    category: isCode ? 'code' : isStyle ? 'style' : isMarkup ? 'markup' : 'other',
    imports: isCode ? count(/^\s*import\s+/gm, text) : 0,
    exports: isCode ? count(/^\s*export\s+/gm, text) : 0,
    functions: isCode ? count(/\b(?:function\s+\w+|\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>|\w+\s*=\s*(?:async\s*)?\w+\s*=>)/g, text) : 0,
    classes: isCode ? count(/\bclass\s+\w+/g, text) : 0,
    types: isCode ? count(/\b(?:type|interface)\s+\w+/g, text) : 0,
    domQueries: isCode ? count(/\b(?:querySelector|getElementById|createElement|appendChild|addEventListener)\b/g, text) : 0,
    ipcTouches: isCode ? count(/\b(?:ipcMain|ipcRenderer|invoke|handle|send)\b/g, text) : 0,
    cssSelectors: isStyle ? count(/^\s*[.#:[\]a-zA-Z0-9_-][^{@]*\{/gm, text) : 0,
    sectionHints: [
      ...new Set(
        [...text.matchAll(/^\s*\/\/\s*([A-Z][A-Za-z0-9 /&:-]{8,80})\s*$/gm)]
          .map((match) => match[1].trim())
          .slice(0, 8),
      ),
    ],
  };
}

function scoreForSplit(item) {
  if (item.isTest) return 0;
  let score = 0;
  if (item.category === 'code') {
    score += Math.max(0, item.lines - 350) / 25;
    score += Math.min(item.functions, 30) * 0.6;
    score += Math.min(item.domQueries, 45) * 0.35;
    score += Math.min(item.imports, 35) * 0.25;
    score += Math.min(item.exports, 20) * 0.35;
    score += item.classes * 1.5;
    score += item.ipcTouches * 0.15;
  } else if (item.category === 'style') {
    score += Math.max(0, item.lines - 250) / 20;
    score += Math.min(item.cssSelectors, 80) * 0.25;
  } else if (item.category === 'markup') {
    score += Math.max(0, item.lines - 150) / 20;
  }
  return Number(score.toFixed(1));
}

const all = walk(srcRoot)
  .map(analyze)
  .filter((item) => ['code', 'style', 'markup'].includes(item.category))
  .map((item) => ({ ...item, splitScore: scoreForSplit(item) }))
  .sort((a, b) => b.lines - a.lines);

const prodCode = all.filter((item) => item.category === 'code' && !item.isTest);
const tests = all.filter((item) => item.category === 'code' && item.isTest);
const styles = all.filter((item) => item.category === 'style');
const markup = all.filter((item) => item.category === 'markup');

function printTable(title, rows, fields) {
  console.log(`\n## ${title}`);
  for (const item of rows) {
    console.log(fields.map((field) => `${field}=${item[field]}`).join('  '));
  }
}

console.log(`# Bulky src analysis`);
console.log(`files=${all.length}  prodCode=${prodCode.length}  tests=${tests.length}  styles=${styles.length}  markup=${markup.length}`);
printTable('Largest production code files', prodCode.slice(0, 30), [
  'lines',
  'bytes',
  'imports',
  'exports',
  'functions',
  'classes',
  'types',
  'domQueries',
  'ipcTouches',
  'splitScore',
  'file',
]);
printTable('Highest split candidates', [...prodCode].sort((a, b) => b.splitScore - a.splitScore).slice(0, 20), [
  'splitScore',
  'lines',
  'imports',
  'exports',
  'functions',
  'domQueries',
  'file',
]);
printTable('Largest style files', styles.slice(0, 20), ['lines', 'bytes', 'cssSelectors', 'splitScore', 'file']);
printTable('Largest test files', tests.slice(0, 15), ['lines', 'bytes', 'imports', 'functions', 'file']);
printTable('Largest markup files', markup.slice(0, 10), ['lines', 'bytes', 'splitScore', 'file']);

