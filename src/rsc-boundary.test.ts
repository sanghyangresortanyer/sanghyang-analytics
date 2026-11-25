import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC_ROOT = path.dirname(fileURLToPath(import.meta.url));
const TEST_FILE_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SOURCE_FILE_RE = /\.[cm]?[jt]sx?$/;

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkSourceFiles(full, out);
    } else if (SOURCE_FILE_RE.test(entry) && !TEST_FILE_RE.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function parseFile(filePath: string): ts.SourceFile {
  const code = readFileSync(filePath, "utf8");
  const kind = filePath.endsWith(".tsx") || filePath.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true, kind);
}

function hasUseClientDirective(sf: ts.SourceFile): boolean {
  for (const stmt of sf.statements) {
    if (!ts.isExpressionStatement(stmt) || !ts.isStringLiteral(stmt.expression)) {
      break;
    }
    if (stmt.expression.text === "use client") {
      return true;
    }
  }
  return false;
}

function resolveImportPath(importerPath: string, specifier: string): string | null {
  let base: string | null = null;
  if (specifier.startsWith("@/")) {
    base = path.join(SRC_ROOT, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(importerPath), specifier);
  } else {
    return null;
  }

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

/**
 * React client references exposed to Server Components may only be rendered as JSX components
 * (PascalCase names, not lowercase helpers or SCREAMING_SNAKE_CASE constants).
 */
function isPascalCaseComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name) && !/^[A-Z0-9_]+$/.test(name);
}

interface BoundaryViolation {
  importer: string;
  target: string;
  symbol: string;
  line: number;
}

function scanRscBoundaryViolations(): BoundaryViolation[] {
  const files = walkSourceFiles(SRC_ROOT);
  const parsed = new Map<string, ts.SourceFile>();
  const clientFiles = new Set<string>();

  for (const filePath of files) {
    const sf = parseFile(filePath);
    parsed.set(filePath, sf);
    if (hasUseClientDirective(sf)) {
      clientFiles.add(filePath);
    }
  }

  const violations: BoundaryViolation[] = [];

  for (const [filePath, sf] of parsed) {
    if (clientFiles.has(filePath)) continue;

    for (const stmt of sf.statements) {
      if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const clause = stmt.importClause;
        if (!clause || clause.isTypeOnly) continue;

        const target = resolveImportPath(filePath, stmt.moduleSpecifier.text);
        if (!target || !clientFiles.has(target)) continue;

        const line = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1;

        if (clause.name && !isPascalCaseComponentName(clause.name.text)) {
          violations.push({
            importer: path.relative(SRC_ROOT, filePath),
            target: path.relative(SRC_ROOT, target),
            symbol: `default (${clause.name.text})`,
            line,
          });
        }

        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
          violations.push({
            importer: path.relative(SRC_ROOT, filePath),
            target: path.relative(SRC_ROOT, target),
            symbol: `* as ${bindings.name.text}`,
            line,
          });
        } else if (bindings && ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            if (el.isTypeOnly) continue;
            const exportedName = (el.propertyName ?? el.name).text;
            if (!isPascalCaseComponentName(exportedName)) {
              violations.push({
                importer: path.relative(SRC_ROOT, filePath),
                target: path.relative(SRC_ROOT, target),
                symbol: exportedName,
                line,
              });
            }
          }
        }
      }

      if (
        ts.isExportDeclaration(stmt) &&
        !stmt.isTypeOnly &&
        stmt.moduleSpecifier &&
        ts.isStringLiteral(stmt.moduleSpecifier)
      ) {
        const target = resolveImportPath(filePath, stmt.moduleSpecifier.text);
        if (!target || !clientFiles.has(target)) continue;

        const line = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1;
        if (!stmt.exportClause) {
          violations.push({
            importer: path.relative(SRC_ROOT, filePath),
            target: path.relative(SRC_ROOT, target),
            symbol: "*",
            line,
          });
        } else if (ts.isNamedExports(stmt.exportClause)) {
          for (const el of stmt.exportClause.elements) {
            if (el.isTypeOnly) continue;
            const exportedName = (el.propertyName ?? el.name).text;
            if (!isPascalCaseComponentName(exportedName)) {
              violations.push({
                importer: path.relative(SRC_ROOT, filePath),
                target: path.relative(SRC_ROOT, target),
                symbol: exportedName,
                line,
              });
            }
          }
        }
      }
    }
  }

  return violations;
}

describe("Next.js RSC boundary guard", () => {
  it("forbids Server Components and server modules from importing non-component values from 'use client' files", () => {
    const violations = scanRscBoundaryViolations();
    expect(
      violations,
      violations
        .map((v) => `${v.importer}:${v.line} imports non-component '${v.symbol}' from 'use client' file ${v.target}`)
        .join("\n"),
    ).toEqual([]);
  });
});
