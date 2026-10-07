---
name: ui-design-system
description: Layout and components for apps/web. shadcn/ui on Base UI (render prop, never Radix), the phone-first rules, and the screenshot check at desktop and 375 px. Use when planning, building or reviewing a screen or component.
disable-model-invocation: true
---

# UI design system

How `apps/web` lays out and builds its components. How it looks belongs to [visual-style](../visual-style/SKILL.md). Component behavior and the five remote states belong to [frontend-react](../frontend-react/SKILL.md). Every screen works at phone width from the first version, because engineers approve and triage from a phone browser and a mobile app follows.

## Plan mode

For any step that adds or changes a screen, the plan states:

- The phone layout first, as one column, and what desktop adds beside it.
- Each decision as a card, with its two or three buttons named.
- The states the screen shows: loading, empty, failed, stale.
- The screenshot checks in the test plan, one at desktop and one at 375 px, under Agent check.

A step that says only "responsive" or "mobile friendly" is vague. Ask for the layout.

## Implement mode

### Components

- Add primitives with `pnpm dlx shadcn@latest add <name>` into `src/components/ui/`. `components.json` keeps the `base-nova` style, so the CLI pulls Base UI versions. Never hand-write a primitive the registry has.
- Base UI comes from `@base-ui/react`. Never install `@radix-ui/*`, `radix-ui`, `vaul` or the old `@base-ui-components/react`, and port any copied component that imports them.
- Compose with the `render` prop, never `asChild`: `<DialogTrigger render={<Button variant="outline" />}>`. A `Button` that renders a `Link` also takes `nativeButton={false}`.
- Style state with Base UI attributes: `data-open`, `data-checked`, `data-disabled`, `data-highlighted`, and `data-starting-style` and `data-ending-style` for enter and exit. Radix `data-[state=open]` never matches.
- Placement props such as `side`, `align` and `sideOffset` go on the `Positioner`. Cap popup height with `max-h-(--available-height)` so menus and selects fit a phone screen.
- Build from the registry before writing markup: `Field` for labelled inputs, `Empty` for empty states, `Skeleton` for loading, `Item` for list rows, `Drawer` for bottom sheets.
- Add a variant with `cva` to a primitive before writing a one-off style. Merge classes with the one `cn` helper. No inline `style` except for runtime values, such as a drag transform.
- An icon-only button has an `aria-label`.

### Phone-first rules

| Rule | In practice |
| --- | --- |
| One column first | Unprefixed classes are the 375 px layout. `md:` and `lg:` add side panels. Never write desktop first and override down. A component reused at several widths uses `@container` and `@md:`, not the viewport |
| One decision per card | Triage, approval and clarifying questions are a card with two or three buttons. On phone, findings rise one at a time in a `Drawer` with `swipeDirection="down"`. On desktop they sit beside the plan |
| Blocks, not long pages | Plan sections and steps are cards the engineer expands, reorders and acts on one at a time |
| Every action is a button | Nothing depends on hover, right-click, long press, swipe or a keyboard shortcut. A shortcut or gesture may exist as an extra |
| Nothing on hover alone | A tooltip never holds the only copy of information |
| Thumb-sized targets | Every control is at least 44 by 44 px on phone, with a gap between neighbours |
| No horizontal scroll | Tables become card lists on phone. Flex and grid children that hold text get `min-w-0`, and long paths and ids use `break-all` or `truncate` with the full value reachable |
| Full-screen detail | Screenshots, diffs and editors open full screen on phone, sized with `h-dvh`, never `h-screen` |

### Screenshot check

UI work is not done until it is checked at both widths, with `playwright-cli` against `pnpm dev` seed data.

1. Open the changed screen at 1280 px wide and take a screenshot.
2. Resize to 375 px wide and take another.
3. Inspect both for horizontal scroll, clipped text, overlapping or sub-44 px targets, missing states and hover-only controls.
4. Check the empty, failed and stale states too, by seeding them or forcing the request to fail.
5. Fix what is wrong and shoot again. Report the screenshots taken, and any state not checked.

## Plan review mode

Raise findings in the [finding format](../orchestrator-references/finding-format.md) with `ui-design-system` as the source skill, as `defect` only.

| Check | Severity |
| --- | --- |
| An action planned to depend on hover, right-click, long press, swipe or a shortcut | `blocker` |
| A component planned on Radix or vaul | `blocker` |
| A screen step with no phone layout, or only "responsive" or "mobile friendly" | `should fix` |
| A decision planned as anything but a card with named buttons | `should fix` |
| A screen with no loading, empty, failed or stale state named | `should fix` |
| No desktop and 375 px screenshot checks in the test plan | `should fix` |

## Implementation review mode

Raise findings in the [finding format](../orchestrator-references/finding-format.md) with `ui-design-system` as the source skill. Ask for the screenshots if the diff changes a screen and none are reported.

| Rule | Severity if broken |
| --- | --- |
| Radix, `radix-ui` or vaul imported or installed, or a copied component not ported to Base UI | `blocker` |
| An action reachable only by hover, right-click, long press, swipe or shortcut | `blocker` |
| `asChild`, or `data-[state=...]` selectors on a Base UI component | `should fix` |
| A screen written desktop first, or broken at 375 px | `should fix` |
| A decision that is not a card with buttons, or several decisions on one card | `should fix` |
| Information held only in a tooltip | `should fix` |
| A control smaller than 44 px on phone, or neighbours with no gap | `should fix` |
| `h-screen` on a full-screen view, or a popup with no height cap | `should fix` |
| A UI change with no desktop and 375 px screenshots reported | `should fix` |
| Hand-written markup where a registry primitive fits, or a one-off style where a primitive variant belongs | `nit` |
