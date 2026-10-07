---
name: visual-style
description: Plangineer's look and feel. Dark-first, clean and quiet, built on shadcn/ui's Nova style with Geist and Lucide, colour by semantic role only, and themes swapped by tokens. Used to plan, build and review anything visible in apps/web, including diffs and code views.
disable-model-invocation: true
---

# Visual style

What `apps/web` looks like, so every screen reads as the same product. Layout, sizes and touch targets belong to [ui-design-system](../ui-design-system/SKILL.md), and component behavior to [frontend-react](../frontend-react/SKILL.md).

## Identity

A calm tool for engineers who read plans and diffs for hours. Dark by default, neutral surfaces, one indigo accent used sparingly, borders instead of shadows, small even type. Linear and the Vercel dashboard set the feel, not a template to copy.

- Colour carries meaning, never decoration. Most of a screen is neutral.
- One primary action per view. Everything else is secondary, outline or ghost.
- No gradients, glows, glass blur, shadowed cards, emoji as icons, illustrations or a second accent colour.

## Foundation

| Choice | Value |
| --- | --- |
| Components | shadcn/ui on Base UI, style **Nova** (`base-nova`) |
| Icons | Lucide, `size-4` inline and `size-5` alone, stroke width as shipped |
| Fonts | Geist Sans for UI text, Geist Mono for code, paths, ids, commands and diffs, from `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` |
| Mode | Dark by default, light available. The mode is the `dark` class on `<html>` |
| Radius | `--radius: 0.5rem`, and the shadcn steps derived from it |
| Tokens | One file, `apps/web/src/styles/theme.css`, started from [the seed](assets/theme.css) |

## Colour roles

Components use roles through Tailwind utilities (`bg-card`, `text-muted-foreground`, `border-border`). Colour values live only in the token file.

| Role | Use |
| --- | --- |
| `background` | The page |
| `card` | Cards, panels and the plan's blocks, one step lighter than the page |
| `popover` | Menus, dialogs and sheets, one step lighter again |
| `muted`, `muted-foreground` | Quiet fills, secondary text, timestamps, hints |
| `primary`, `primary-foreground` | The one main action, selection and focus. Never body text |
| `link` | Inline links and brand-coloured text. Lighter than `primary` in dark mode, so it passes contrast on the page |
| `secondary` | Secondary buttons |
| `accent` | Hover and selected backgrounds in menus and lists. In shadcn, accent is not the brand colour |
| `border`, `input`, `ring` | Hairlines, field borders and the focus ring |
| `destructive`, `success`, `warning`, `info` | Status only, each with a `-foreground` for text on a solid fill |
| `sidebar-*` | Aliases of the roles above, set once in the seed's `:root`. Never given their own values |

Status mapping, the same everywhere:

| Meaning | Role |
| --- | --- |
| Run failed, `blocker` finding, revert | `destructive` |
| Run running or queued, informational notice | `info` |
| Run passed, verified, accepted | `success` |
| Stale plan, `should fix` finding, waiting on the engineer | `warning` |
| `nit` finding, cancelled, skipped | `muted-foreground` |

- Status is always an icon or a label with the colour, never colour alone.
- A status badge is the role at 15% behind text in the full role, such as `bg-warning/15 text-warning`.
- Diff lines: added is `bg-success/15`, removed is `bg-destructive/15`, with the `+` and `-` markers kept. Word-level changes use 30%.
- CodeMirror and react-diff-view take their colours from these tokens. Never ship a bundled editor or syntax theme's own colours.

## Type, space and depth

- **Type.** Body and controls are `text-sm`. Inputs are `text-base` below `md`, so phones do not zoom on focus. A page title is `text-xl font-semibold`, a section title `text-base font-semibold`. Weights 400, 500 and 600 only. Numbers in tables and counters use `tabular-nums`.
- **Mono.** `font-mono text-xs` for code, file paths, branch names, commit ids, commands and diffs.
- **Space.** Cards pad `p-4`. Stacks use `gap-2`, `gap-3` or `gap-4`.
- **Depth.** Surfaces step up from `background` to `card` to `popover`, each with a `border`. Shadows appear only on popovers, dialogs and sheets.

## Motion

Hover and press take 150 ms, overlays open in 200 ms, all ease-out. Nothing moves on its own, nothing loops except the indicator of a running job, and `motion-reduce:` turns transitions off.

## Modes and palettes

The look is swappable by tokens alone, so user-chosen palettes later need no component change.

- An inline script in `index.html` applies the stored mode before first paint, never a React effect, so the page never flashes the wrong mode. With nothing stored, the mode is `dark`.
- `color-scheme` follows the mode, so native scrollbars, date pickers and autofill match.
- A palette is a `[data-palette="<name>"]` block on `<html>` that overrides only `primary`, `primary-foreground`, `ring` and `link`, for both modes.
- Components never name a mode or a palette. A `dark:` utility is allowed only inside the shadcn primitives in `src/components/ui/`.
- To make or change a palette, tune it in [tweakcn](https://tweakcn.com), copy the role values into the token file, and check every contrast pair below.

Contrast pairs that must pass 4.5:1 in both modes: `foreground` and `muted-foreground` on `background`, `card` and `muted`; `primary-foreground` on `primary`; `link` on `background` and `card`; each status role on `background` and `card`, and its `-foreground` on the role. Control borders and the focus ring need 3:1 against their background.

## Plan mode

A step that adds or changes a screen names the roles it uses beyond the defaults: its primary action, its status colours and any new token. A new token or palette is a decision, with its contrast checked. "Make it look nice" or "modern styling" is vague.

## Implement mode

- **First UI work.** Create `apps/web` with `pnpm dlx shadcn@latest create`, choosing Vite, Base UI, Nova, Lucide and Geist. Replace every generated colour variable with [the seed](assets/theme.css), keep the generated `@custom-variant dark` and `@theme inline` mappings, delete the `chart-*` variables and their mappings, and set `class="dark"` on `<html>`.
- **Later work.** Use the existing tokens and primitives. Add a variant to a primitive before a one-off style, and a token before a raw value. A new token gets a value in both modes and a `--color-*` mapping in `@theme inline`.
- Check the result in both modes during the [ui-design-system](../ui-design-system/SKILL.md) screenshot check. Judge dark first.

## Plan review mode

Raise findings in the [finding format](../orchestrator-references/finding-format.md) with `visual-style` as the source skill, as `defect` only.

| Check | Severity |
| --- | --- |
| A new colour, font, radius or icon set outside the foundation, with no decision recorded | `should fix` |
| Status shown by colour alone, or mapped differently from the status table | `should fix` |
| A screen step with no named primary action, or two | `nit` |

## Implementation review mode

Raise findings in the [finding format](../orchestrator-references/finding-format.md) with `visual-style` as the source skill.

| Rule | Severity if broken |
| --- | --- |
| Text or a control below its contrast minimum in either mode | `blocker` |
| A colour, font, radius or shadow given as a raw or arbitrary value in a component, or a hue utility such as `text-red-500` | `should fix` |
| A component that names a mode or palette outside `src/components/ui/` | `should fix` |
| A token with a value in only one mode, or without its `@theme inline` mapping | `should fix` |
| The mode applied after first paint, or `color-scheme` not following it | `should fix` |
| Colour-only status, or a status mapped differently from the status table | `should fix` |
| An editor, diff or syntax theme with colours not taken from the tokens | `should fix` |
| A second accent colour, a gradient, a glow, glass blur or a shadow on a card | `should fix` |
| A font, weight or icon set outside the foundation | `should fix` |
| `primary` used for body text, or more than one primary action in a view | `nit` |
| Motion longer than 200 ms, or motion that ignores reduced motion | `nit` |
