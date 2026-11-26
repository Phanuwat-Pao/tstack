#!/usr/bin/env node
// Compare a repo's dependencies and tooling with the template's.
// Usage: node stack-diff.mjs <template dir> <repo dir>
// Reads only files tracked by git, resolves pnpm `catalog:` references, and
// prints Markdown. Changes nothing.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [templateDir, repoDir] = process.argv.slice(2);
if (!(templateDir && repoDir)) {
  console.error("usage: node stack-diff.mjs <template dir> <repo dir>");
  process.exit(2);
}

// Packages the template replaced, and what it uses instead.
const REPLACED = [
  [/^react-hook-form$|^@hookform\//, "@tanstack/react-form"],
  [/^formik$|^final-form$|^react-final-form$/, "@tanstack/react-form"],
  [/^@trpc\//, "@orpc/*"],
  [/^next-auth$|^@auth\/|^lucia$|^@clerk\//, "better-auth"],
  [/^prisma$|^@prisma\/|^typeorm$|^sequelize$|^mongoose$/, "drizzle-orm"],
  [/^swr$/, "@tanstack/react-query"],
  [
    /^ag-grid|^@mui\/x-data-grid|^react-data-table-component$|^mantine-react-table$|^material-react-table$|^react-table$/,
    "@tanstack/react-table with the shadcn data table",
  ],
  [/^next-intl$|^react-intl$|^@lingui\//, "i18next + react-i18next"],
  [/^yup$|^joi$|^valibot$|^superstruct$/, "zod"],
  [/^moment$|^dayjs$|^luxon$/, "date-fns"],
  [/^eslint$|^@eslint\/|^eslint-|^prettier$|^@biomejs\/biome$|^typescript-eslint$/, "ultracite (oxlint + oxfmt)"],
  [/^husky$|^lint-staged$/, "lefthook"],
  [/^tailwindcss-animate$/, "tw-animate-css"],
  [/^@radix-ui\/react-form$/, "@acme/ui/form (TanStack Form)"],
];

// The template's core stack. A repo without one of these either does not need
// that layer (no database, no mobile app) or uses something else for it.
const CORE = [
  "next", "react", "@orpc/server", "@orpc/client", "@orpc/tanstack-query",
  "@tanstack/react-query", "@tanstack/react-form", "better-auth", "drizzle-orm",
  "zod", "tailwindcss", "i18next", "react-i18next", "turbo", "ultracite",
  "oxlint", "oxfmt", "lefthook", "typescript", "vitest", "expo",
];

// Root files the template keeps, and what each one means.
const ROOT_FILES = [
  ["pnpm-workspace.yaml", "pnpm workspace with catalogs"],
  ["turbo.json", "Turborepo"],
  ["lefthook.yml", "lefthook pre-commit gates"],
  ["oxlint.config.ts", "oxlint config (ultracite)"],
  ["oxfmt.config.ts", "oxfmt config (ultracite)"],
  ["AGENTS.md", "agent instructions"],
  ["t3.json", "T3 Code worktree setup"],
  ["idp.yaml", "MiniIDP deploy config"],
];

function tracked(dir) {
  return execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

// Just enough YAML for `catalog:` and `catalogs:` in pnpm-workspace.yaml.
function readCatalogs(dir) {
  const file = join(dir, "pnpm-workspace.yaml");
  const catalogs = { default: {} };
  if (!existsSync(file)) {
    return catalogs;
  }
  let section = null;
  let named = null;
  const unquote = (s) => s.trim().replace(/^["']|["']$/g, "");
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (/^\S/.test(line)) {
      section = line.startsWith("catalog:") ? "catalog" : line.startsWith("catalogs:") ? "catalogs" : null;
      named = null;
      continue;
    }
    const entry = line.match(/^(\s+)("[^"]+"|'[^']+'|[^:#\s][^:]*):\s*(.*?)\s*(#.*)?$/);
    if (!(entry && section)) {
      continue;
    }
    const [, indent, rawKey, rawValue] = entry;
    if (section === "catalog" && indent.length === 2 && rawValue) {
      catalogs.default[unquote(rawKey)] = unquote(rawValue);
    } else if (section === "catalogs" && indent.length === 2 && !rawValue) {
      named = unquote(rawKey);
      catalogs[named] = {};
    } else if (section === "catalogs" && named && indent.length === 4 && rawValue) {
      catalogs[named][unquote(rawKey)] = unquote(rawValue);
    }
  }
  return catalogs;
}

// The workspace globs from pnpm-workspace.yaml `packages:` or package.json
// `workspaces`, so vendored sources and fixtures do not count.
function workspaceMatcher(dir) {
  const globs = [];
  const yaml = join(dir, "pnpm-workspace.yaml");
  if (existsSync(yaml)) {
    let inPackages = false;
    for (const line of readFileSync(yaml, "utf8").split("\n")) {
      if (/^\S/.test(line)) {
        inPackages = line.startsWith("packages:");
        continue;
      }
      const item = line.match(/^\s+-\s*["']?([^"'#]+?)["']?\s*(#.*)?$/);
      if (inPackages && item) {
        globs.push(item[1]);
      }
    }
  }
  if (globs.length === 0) {
    try {
      const root = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      const ws = Array.isArray(root.workspaces) ? root.workspaces : (root.workspaces?.packages ?? []);
      globs.push(...ws);
    } catch {
      // no root package.json
    }
  }
  const toRegex = (glob) =>
    new RegExp(
      `^${glob
        .replace(/\/$/, "")
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "\u0000")
        .replace(/\*/g, "[^/]+")
        .replace(/\u0000/g, ".*")}$`
    );
  const include = globs.filter((g) => !g.startsWith("!")).map(toRegex);
  const exclude = globs.filter((g) => g.startsWith("!")).map((g) => toRegex(g.slice(1)));
  return (path) => include.some((r) => r.test(path)) && !exclude.some((r) => r.test(path));
}

function readStack(dir) {
  const catalogs = readCatalogs(dir);
  const files = tracked(dir);
  const inWorkspace = workspaceMatcher(dir);
  const manifests = files.filter(
    (f) => f === "package.json" || (f.endsWith("/package.json") && inWorkspace(f.slice(0, -"/package.json".length)))
  );
  const deps = new Map(); // name -> { range, where[] , viaCatalog }
  let root = {};
  for (const manifest of manifests) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(dir, manifest), "utf8"));
    } catch {
      continue;
    }
    if (manifest === "package.json") {
      root = pkg;
    }
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
        if (spec.startsWith("workspace:")) {
          continue;
        }
        let range = spec;
        let viaCatalog = false;
        if (spec.startsWith("catalog:")) {
          viaCatalog = true;
          const catalogName = spec.slice("catalog:".length) || "default";
          range = catalogs[catalogName]?.[name] ?? `${spec} (not in catalog)`;
        }
        const seen = deps.get(name) ?? { range, where: [], viaCatalog };
        seen.where.push(manifest);
        seen.viaCatalog ||= viaCatalog;
        deps.set(name, seen);
      }
    }
  }
  const lockfiles = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock", "bun.lockb"].filter((f) =>
    files.includes(f)
  );
  return { catalogs, deps, files, lockfiles, root };
}

// The major a range allows, e.g. "^16.4.6" -> 16, "npm:@tsc-rs/typescript@0.8.0" -> "0.8".
function major(range) {
  const version = range.replace(/^npm:(@?[^@]+)@/, "").match(/(\d+)\.(\d+)/);
  if (!version) {
    return null;
  }
  return version[1] === "0" ? `0.${version[2]}` : version[1];
}

const template = readStack(templateDir);
const repo = readStack(repoDir);
const out = [];
const line = (s = "") => out.push(s);

line(`# Stack diff: ${repoDir} against ${templateDir}`);
line();
line("## Package manager and root tooling");
line();
line(`- packageManager: template \`${template.root.packageManager}\`, repo \`${repo.root.packageManager ?? "none"}\``);
line(`- lockfiles in repo: ${repo.lockfiles.join(", ") || "none"}`);
line(`- engines.node: template \`${template.root.engines?.node}\`, repo \`${repo.root.engines?.node ?? "none"}\``);
for (const [file, what] of ROOT_FILES) {
  if (template.files.includes(file) && !repo.files.includes(file)) {
    line(`- missing \`${file}\` (${what})`);
  }
}
const repoScripts = repo.root.scripts ?? {};
for (const name of ["check", "check:fix", "typecheck", "lint:ws", "build"]) {
  if (template.root.scripts?.[name] && repoScripts[name] !== template.root.scripts[name]) {
    line(`- root script \`${name}\`: template \`${template.root.scripts[name]}\`, repo \`${repoScripts[name] ?? "none"}\``);
  }
}
line();

line("## Packages the template replaced");
line();
let replaced = 0;
for (const [name, info] of [...repo.deps].sort()) {
  for (const [pattern, instead] of REPLACED) {
    if (pattern.test(name)) {
      line(`- \`${name}\` ${info.range} in ${info.where.join(", ")}. Template uses ${instead}.`);
      replaced++;
      break;
    }
  }
}
if (!replaced) {
  line("- none");
}
line();

line("## Template packages behind by a major or missing");
line();
const behind = [];
const missing = [];
for (const [name, info] of [...template.deps].sort()) {
  if (name.startsWith("@acme/")) {
    continue;
  }
  const mine = repo.deps.get(name);
  if (!mine) {
    missing.push(`\`${name}\` ${info.range}`);
    continue;
  }
  const want = major(info.range);
  const have = major(mine.range);
  if (want && have && want !== have) {
    behind.push(`- \`${name}\`: template ${info.range}, repo ${mine.range} (${mine.where.join(", ")})`);
  }
}
line(behind.length ? behind.join("\n") : "- no major differences");
line();
const coreMissing = CORE.filter((name) => template.deps.has(name) && !repo.deps.has(name));
line("Core stack packages the repo does not use:");
line();
line(coreMissing.length ? coreMissing.map((name) => `- \`${name}\``).join("\n") : "- none");
line();
const otherMissing = missing.filter((entry) => !coreMissing.some((name) => entry.startsWith(`\`${name}\` `)));
line(`Other template packages the repo does not use (${otherMissing.length}). Most are features the repo may not need:`);
line();
line(otherMissing.length ? otherMissing.join(", ") : "none");
line();

line("## Catalog use");
line();
const templateCatalog = Object.keys(template.catalogs.default);
const notCataloged = [];
for (const name of templateCatalog) {
  const mine = repo.deps.get(name);
  if (mine && !mine.viaCatalog && mine.where.length > 1) {
    notCataloged.push(`\`${name}\` (${mine.where.length} workspaces)`);
  }
}
line(
  notCataloged.length
    ? `Shared by several workspaces but pinned in each instead of \`catalog:\`: ${notCataloged.join(", ")}`
    : "- shared template packages go through the catalog"
);

console.log(out.join("\n"));
