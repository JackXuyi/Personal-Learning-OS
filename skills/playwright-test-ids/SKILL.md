---
name: playwright-test-ids
description: Adds stable data-testid attributes to interactive UI for Playwright locators and preserves existing testids across refactors. Use when implementing or refactoring components for E2E tests, when the user asks for test IDs, Playwright selectors, automation-friendly markup, or stable selectors, or when tests fail due to brittle locators.
---

# Playwright test IDs on interactive elements

## When to use

Apply when the goal is **reliable automation**: buttons, links, inputs, toggles, menu triggers, tabs, dialog actions, and other elements a test must click, fill, or assert on.

Pair with [webapp-testing](../webapp-testing/SKILL.md) for running Playwright scripts against the app.

## Workflow

1. **Read structure** — Open the page entry or leaf component. Note layout regions (header, sidebar, modal, form sections) and which elements receive user input or fire navigation.
2. **List interactives** — For each actionable control, decide whether a test must target it **without** depending on visible copy (i18n, dynamic text, icons-only).
3. **Assign IDs** — Add `data-testid` on the **single node** a test should use (usually the clickable root: `button`, `a`, or a wrapper that forwards clicks).
4. **Verify uniqueness** — Within a logical scope (page, modal, or drawer), the same `data-testid` must not appear twice. For lists/tables, use a **pattern**: static prefix + stable row key, e.g. `item-row-${id}` passed from data (see existing grid patterns in the repo).
5. **Spot-check** — Mentally run `page.getByTestId('...')` — one ID, one unambiguous element.

## Naming convention (this repo)

- **Format**: `kebab-case`, left-to-right from **feature → sub-area → role/element**.
- **Examples**: `goal-save-button`, `active-goal-select`, `learner-open-modal`.
- **Stable over dynamic**: Do not encode user-generated titles, counts, or timestamps into the ID unless they are **stable keys** from the domain (e.g. row id). Prefer semantic role: `milestone-save-button` not `milestone-save-${title}`.
- **Suffix hints**: `-button`, `-input`, `-link`, `-trigger`, `-menu`, `-dialog`, `-submit` when it clarifies intent.

## What to tag

| Priority | Elements |
|----------|----------|
| High | Primary/secondary actions, form submits, destructive actions, auth flows, navigation that gates tests |
| Medium | Text fields, selects, checkboxes, switches, search boxes, tab triggers, dropdown triggers |
| Lower | Purely decorative or redundant if a parent already has a testid and the child adds no new action |

## What to avoid

- **Duplication** — Multiple identical testids in one DOM subtree tests care about; scope under a parent testid or use per-item IDs.
- **Implementation detail IDs** — Avoid coupling to internal component class names or library internals; prefer product/feature vocabulary.
- **Every node** — Do not blanket-wrap static text; interactors and containers that tests open/close are enough.
- **Breaking changes** — Renaming a testid is an API change for tests; only rename when updating tests in the same change.

## Stability of existing testids

Treat any `data-testid` already referenced by node tests, Playwright, or docs as a **stable contract**. Prefer keeping the string unchanged over “cleaner” naming. Unit tests run via `node --experimental-strip-types`（`tests/*.test.ts`）；browser-level Playwright runs against `npm run dev` at `http://localhost:1420`.

**When refactoring UI**

- **Keep the same value** on the element tests target (usually the click/focus root). If markup moves (wrapper swap, component split), **re-hoist** the same `data-testid` onto the new interaction root—do not drop it or rename for style.
- **Search before rename**: `grep` / ripgrep the repo for the literal string (tests, scripts, docs). If anything references it, either **do not rename** or change **all** call sites in the **same commit/PR**.
- **Avoid drive-by renames** in unrelated PRs (typo fixes, file moves, design tweaks). Renames belong in a dedicated change with test updates.

**When behavior or structure changes**

- If one control becomes two (e.g. split button), **add** new testids for the new affordance; keep the old id on the primary path tests already use, or migrate tests explicitly—do not silently move meaning to a new string.
- **Conditional UI**: ensure the testid remains on the mounted node in every branch where the control exists; do not attach it only in one variant so tests flap.

**Renames**

- If a string must change, ship **app + every consumer** (E2E, scripts) in the **same change**. Same element cannot carry two `data-testid` values; phased renames need a team-approved sequence (e.g. add new id on a wrapper + migrate tests, then remove old)—default is one atomic PR.

## Playwright usage

```ts
page.getByTestId('search-input').fill('query');
page.getByTestId('search-close-button').click();
```

Prefer `getByTestId` for elements tagged by this skill; combine with `getByRole` when accessibility already guarantees stable roles/names.

## Code review checklist

Use when a PR adds or touches `data-testid`:

- [ ] **New IDs**: `kebab-case`, feature-scoped, stable (not derived from volatile visible text unless it is a domain key).
- [ ] **Placement**: ID sits on the interaction root Playwright should use (click/focus), not on inner-only wrappers unless intentional.
- [ ] **Uniqueness**: No duplicate values in the same modal/page scope; list rows use a stable per-row suffix.
- [ ] **Existing IDs preserved**: Refactors did not drop or rename strings without repo-wide `grep` and matching E2E/script updates in the same PR.
- [ ] **Conditional UI**: Controls that exist in multiple branches still expose the testid where the control is mounted.
- [ ] **Renames**: If any string changed, every consumer (app tests, external automation, docs) updated in this change—or rename reverted.

## Optional: prop indirection

For reusable atoms, accept `data-testid` or `testId` as a prop and pass it to the root DOM node so callers can scope IDs (`<Foo testId="settings-save" />` → `data-testid="settings-save"`).
