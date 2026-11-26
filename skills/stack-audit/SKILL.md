---
name: stack-audit
description: Trigger this if the user says 'stack audit'.
---

# Stack audit

Check whether a repo still follows its template stack, and report where it
drifted. The audit reads code only. It never edits, installs, commits or
pushes. Fixes are a separate request from the user.

## What to audit, against what

- **Repo:** the path after "stack audit", otherwise the repo in the current
  directory. If neither is a Node repo, ask which one.
- **Template:** the template repo your instructions name for stack audits
  (CLAUDE.md, AGENTS.md or a rules file). Without one, use
  `~/create-t3-turbo`. If that does not exist either, ask.
- **Reference data table:** your instructions may name a repo whose data
  table follows the contract below. Read it when it exists, and cite it in
  findings as the code to copy.

Audit what ships, not a stale checkout. Run `git fetch` in both repos. If a
checkout is behind its default branch on origin, or has local changes, add a
detached worktree of `origin/<default>` under `~/.cache/stack-audit/` and
audit that. Remove the worktree when done. Say in the report which commit of
each repo you audited.

## 1. Dependencies and tooling

Run `node <this skill's directory>/scripts/stack-diff.mjs <template> <repo>`
(absolute path). It reads only tracked `package.json` files inside the
workspace globs, resolves `catalog:` versions, and prints:

- package manager, lockfiles, root config files and root scripts that differ
- packages the template replaced (react-hook-form, tRPC, Prisma, ESLint and
  so on), with what the template uses instead
- template packages the repo has one or more majors behind
- core stack packages the repo lacks, then every other template package it
  lacks
- shared packages pinned per workspace instead of through the catalog

Judge each line. A missing core package can be correct: an app without a
database has no Drizzle. Say which lines are real drift and which are
features the repo does not need. Never report "other packages missing" one by
one; summarize them.

Also check the template's guards in the repo, because they exist for
outages that already happened:

- Next.js 16.4.5 or later with oRPC's `CompressionPlugin` in a route
  handler is a broken API (double gzip). `grep -rnE "new CompressionPlugin\(|import .*CompressionPlugin" apps/*/src/app/api`.
- Every Drizzle `timestamp(` column has `withTimezone: true`.
- `lefthook.yml` runs the same gates as the template's. Compare the two
  files.

## 2. Data tables

The stack's data table is shadcn's data table pattern on
`@tanstack/react-table`, paged on the server by page number. Check the latest
TanStack Table version with `npm view @tanstack/react-table version` first.
A repo on an older major is drift.

A list page passes when all of these hold:

1. **One shared component.** A `DataTable` built on `@tanstack/react-table`
   and the shadcn `Table` primitives lives in the UI package
   (`packages/ui/src/data-table.tsx` or similar). Pages use it. No other
   table library (AG Grid, MUI DataGrid, Mantine/Material React Table,
   react-data-table-component).
2. **Server-side.** The table sets `manualPagination: true` (and
   `manualSorting` / `manualFiltering` when the server sorts or searches) and
   gets the row count or page count from the API. Server data never goes
   through `getPaginationRowModel()`, which pages rows already in the browser.
3. **Page number contract.** The API input is `page` (1-based) and
   `pageSize` with a server-side maximum. The output is one page of rows plus
   the total. It is not `limit`/`offset` from the client, a cursor,
   `useInfiniteQuery`, or "load more". Sort and search changes go back to
   page 1.
4. **Numbered pages in the UI.** The pager shows page numbers (shadcn
   `Pagination` with `PaginationLink`, or the same buttons), plus previous and
   next and a rows-per-page select. Previous and next alone fails.

Find candidates with
`git grep -nE "@tanstack/react-table|useReactTable|getPaginationRowModel|manualPagination|useInfiniteQuery|<Table[ >]"`
and the API's list inputs
(`git grep -nE "\b(limit|offset|cursor|page|pageSize)\b\s*:" -- 'packages/api/**/*.ts' 'packages/validators/**/*.ts'`).
A page that renders API rows in a raw `<Table>` with no paging, where the
list can grow without bound, is a finding too. Small fixed lists (settings
with three rows) are fine as plain tables; say so when you skip one.

If the template itself breaks this contract (for example a list procedure
with `limit`/`offset`), report that as template drift in its own section, so
the user can fix the template too.

## 3. Forms

Forms use TanStack Form through the template's form hook: `useAppForm` from
the UI package (`createFormHook` in `packages/ui/src/form.tsx`), fields as
`form.AppField`, validation with zod schemas from the validators package or
the component, and submit through a TanStack Query mutation. Read one of the
template's forms (`apps/nextjs/src/components/forms/`) before judging.

Findings:

- `react-hook-form`, `@hookform/resolvers`, Formik, or shadcn's old
  `<Form>`/`<FormField>` components
- `useForm` from `@tanstack/react-form` used directly in pages, skipping the
  shared `useAppForm` and its field components
- hand-rolled forms: a `<form>` with one `useState` per field and manual
  validation (`git grep -lE "<form[ >]" -- '*.tsx' '*.jsx'` lists the files;
  read each one that does not use `useAppForm`)
- a mobile app with its own form approach when the template's Expo app has
  `apps/expo/src/components/ui/form.tsx`

## Report

Start with one line per area: aligned, drift, or missing.

| Area | Status | Summary |
| --- | --- | --- |
| Dependencies and tooling | drift | 3 majors behind, ESLint instead of ultracite |
| Data tables | drift | 4 of 9 list pages page in the browser |
| Forms | aligned | 12 forms, all `useAppForm` |

Then each finding, most important first: the file and line, what the repo
does, what the template does instead (with the template's file), and the
size of the change to align it. Count everything you checked, not only what
failed, so "aligned" has evidence. Finish with the commits you audited.
