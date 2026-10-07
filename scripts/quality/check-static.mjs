import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const exactProjectionExceptions = [
  {
    path: 'src/features/auth-session/operation-adapter.ts',
    symbol: 'SessionOperationRequester',
    projection: 'SessionContextValue.requestPublic',
    reason: 'Exact compatibility adapter tracks SessionContextValue.requestPublic.',
  },
  {
    path: 'src/features/catalog-discovery/api.ts',
    symbol: 'CatalogRequester',
    projection: 'ApiClient.request',
    reason: 'Exact compatibility adapter tracks ApiClient.request.',
  },
  {
    path: 'src/app/layouts/catalog-header-search-controller.ts',
    symbol: 'location',
    projection: 'CatalogHeaderSearchProps.location',
    reason: 'The helper consumes the named route-location contract without recreating it.',
  },
];

export function staticSuppressions() {
  return exactProjectionExceptions.map(({ path, symbol, reason }) => ({
    ruleId: 'TS-TYPE-002',
    path,
    symbol,
    reason,
  }));
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = resolve(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    }),
  );
  return nested.flat();
}

function relativeFile(file, sourceRoot = root) {
  const fromRoot = relative(sourceRoot, file).replace(/\\/g, '/');
  return fromRoot.startsWith('..') ? file.replace(/\\/g, '/') : fromRoot;
}

function finding(file, line, ruleId, message, category = 'deterministic') {
  return { category, file, line, ruleId, message };
}

function lineFor(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function stringModuleSpecifier(node) {
  return node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
    ? node.moduleSpecifier.text
    : undefined;
}

function namedProjection(typeNode) {
  if (!ts.isIndexedAccessTypeNode(typeNode) || !ts.isTypeReferenceNode(typeNode.objectType))
    return undefined;
  if (!ts.isLiteralTypeNode(typeNode.indexType) || !ts.isStringLiteral(typeNode.indexType.literal))
    return undefined;
  return `${typeNode.objectType.typeName.getText()}.${typeNode.indexType.literal.text}`;
}

function nodeSymbol(node) {
  for (let current = node; current; current = current.parent) {
    if (
      (ts.isTypeAliasDeclaration(current) ||
        ts.isInterfaceDeclaration(current) ||
        ts.isFunctionDeclaration(current) ||
        ts.isClassDeclaration(current)) &&
      current.name
    )
      return { declaration: current, symbol: current.name.text };
    if (ts.isVariableDeclaration(current)) {
      if (ts.isIdentifier(current.name)) return { declaration: current, symbol: current.name.text };
      if (ts.isArrayBindingPattern(current.name)) {
        const binding = current.name.elements.find(
          (element) => ts.isBindingElement(element) && ts.isIdentifier(element.name),
        );
        if (binding && ts.isIdentifier(binding.name))
          return { declaration: current, symbol: binding.name.text };
      }
    }
    if (ts.isParameter(current) && ts.isIdentifier(current.name))
      return { declaration: current, symbol: current.name.text };
    if (
      (ts.isPropertySignature(current) || ts.isPropertyDeclaration(current)) &&
      current.name &&
      (ts.isIdentifier(current.name) || ts.isStringLiteral(current.name))
    )
      return { declaration: current, symbol: current.name.text };
  }
  return undefined;
}

function commentCarrier(declaration) {
  if (!ts.isVariableDeclaration(declaration)) return declaration;
  const declarationList = declaration.parent;
  return ts.isVariableDeclarationList(declarationList) &&
    ts.isVariableStatement(declarationList.parent)
    ? declarationList.parent
    : declaration;
}

function hasExactSuppressionComment(sourceFile, owner) {
  const { declaration, symbol } = owner;
  const marker = `quality-exception: TS-TYPE-002 ${symbol} `;
  const carrier = commentCarrier(declaration);
  const comments = ts.getLeadingCommentRanges(sourceFile.text, carrier.getFullStart()) ?? [];
  return comments.some(({ pos, end }) => {
    const comment = sourceFile.text
      .slice(pos, end)
      .replace(/^\/\/\s?/, '')
      .trim();
    const gap = sourceFile.text.slice(end, carrier.getStart(sourceFile));
    return comment.startsWith(marker) && !/\r?\n[ \t]*\r?\n/.test(gap);
  });
}

function isExactAdapter(file, owner, projection, sourceFile) {
  if (
    exactProjectionExceptions.some(
      (exception) =>
        exception.path === file &&
        exception.symbol === owner.symbol &&
        exception.projection === projection,
    )
  )
    return true;
  return hasExactSuppressionComment(sourceFile, owner);
}

export function analyseSourceText(file, content, sourceRoot = root) {
  const normalizedFile = relativeFile(file, sourceRoot);
  const sourceFile = ts.createSourceFile(normalizedFile, content, ts.ScriptTarget.Latest, true);
  const findings = [];
  function visit(node) {
    if (ts.isIndexedAccessTypeNode(node)) {
      const projection = namedProjection(node);
      const owner = nodeSymbol(node);
      if (
        projection &&
        owner &&
        !ts.findAncestor(node, ts.isInterfaceDeclaration) &&
        !isExactAdapter(normalizedFile, owner, projection, sourceFile)
      ) {
        findings.push(
          finding(
            normalizedFile,
            lineFor(sourceFile, node),
            'TS-TYPE-002',
            'Mechanical indexed projection hides a simple concrete type; declare or reuse the semantic type.',
          ),
        );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return findings;
}

function moduleCandidates(file, moduleSpecifier) {
  const extensionCandidates = (candidate) => [
    candidate,
    `${candidate}.ts`,
    `${candidate}.tsx`,
    `${candidate}/index.ts`,
    `${candidate}/index.tsx`,
  ];
  if (moduleSpecifier.startsWith('@'))
    return extensionCandidates(`src/${moduleSpecifier.slice(1)}`);
  if (moduleSpecifier.startsWith('.')) {
    const segments = file.split('/');
    segments.pop();
    for (const segment of moduleSpecifier.split('/')) {
      if (segment === '.' || segment === '') continue;
      if (segment === '..') segments.pop();
      else segments.push(segment);
    }
    return extensionCandidates(segments.join('/'));
  }
  return [];
}

function moduleEdges(file, content, sourceFilesByPath) {
  const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const edges = [];
  sourceFile.forEachChild((node) => {
    if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) return;
    const moduleSpecifier = stringModuleSpecifier(node);
    if (!moduleSpecifier) return;
    const target = moduleCandidates(file, moduleSpecifier).find((candidate) =>
      sourceFilesByPath.has(candidate),
    );
    if (target) edges.push({ target, line: lineFor(sourceFile, node) });
  });
  return edges;
}

export function collectImportCycleFindings(entries, sourceRoot = root) {
  const sourceFilesByPath = new Map(
    entries.map(({ file, content }) => [relativeFile(file, sourceRoot), content]),
  );
  const edges = new Map(
    [...sourceFilesByPath].map(([file, content]) => [
      file,
      moduleEdges(file, content, sourceFilesByPath),
    ]),
  );
  const visiting = new Set();
  const visited = new Set();
  const findings = [];
  function visit(file, trail) {
    if (visiting.has(file) || visited.has(file)) return;
    visiting.add(file);
    for (const edge of edges.get(file) ?? []) {
      if (visiting.has(edge.target)) {
        findings.push(
          finding(
            file,
            edge.line,
            'TS-BOUNDARY-001',
            `Direct import cycle detected: ${[...trail, file, edge.target].join(' -> ')}.`,
          ),
        );
      } else {
        visit(edge.target, [...trail, file]);
      }
    }
    visiting.delete(file);
    visited.add(file);
  }
  for (const file of sourceFilesByPath.keys()) visit(file, []);
  return findings;
}

export async function collectStaticFindings(
  directory = resolve(root, 'src'),
  sourceRoot = resolve(directory, '..'),
) {
  const files = await sourceFiles(directory);
  const entries = await Promise.all(
    files.map(async (file) => ({ file, content: await readFile(file, 'utf8') })),
  );
  return [
    ...entries.flatMap(({ file, content }) => analyseSourceText(file, content, sourceRoot)),
    ...collectImportCycleFindings(entries, sourceRoot),
  ];
}

export async function collectComplexitySignals(directory = resolve(root, 'src')) {
  const files = await sourceFiles(directory);
  const results = await Promise.all(
    files.map(async (file) => {
      const signals = complexitySignals(await readFile(file, 'utf8'));
      return signals.map((signal) => ({ ...signal, file: relativeFile(file) }));
    }),
  );
  return results.flat();
}

export function complexitySignals(content) {
  const signals = [];
  const branches = (content.match(/\b(if|switch|case|catch)\b|\?\s*[^.:]/g) ?? []).length;
  const effects = (content.match(/\buse(Effect|LayoutEffect|State|Reducer)\b/g) ?? []).length;
  const jsxBranches = (content.match(/&&|\?\s*<|:\s*</g) ?? []).length;
  if (branches >= 8 || effects >= 5 || jsxBranches >= 6)
    signals.push({ branches, effects, jsxBranches, ruleId: 'REACT-COMP-001' });
  return signals;
}

export const complexityReview = Object.freeze({
  basis: 'independent-responsibilities',
  guidance:
    'Review flagged modules for independent responsibilities and record a retain or split decision; file length alone is not a defect.',
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const findings = await collectStaticFindings();
  if (findings.length) {
    console.error(JSON.stringify({ findings }, null, 2));
    process.exitCode = 1;
  } else {
    console.log('QUALITY_STATIC_PASS');
  }
}
