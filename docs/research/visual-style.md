# Visual style research

Oct 7, 2026

## Question

How do we get a consistent, clean, modern look out of coding agents, dark by default, with room for user-chosen palettes later? The answer is in the [visual-style](../../.agents/skills/visual-style/SKILL.md) skill. This note records what was compared.

## Finding

Consistency comes from three things together: concrete token values in one file, semantic roles that components must use, and a skill that routes every UI task to both. Tools help pick the values. None of them keeps an agent consistent on their own.

## Options compared

| Tool | What it does | Verdict |
| --- | --- | --- |
| [shadcn create](https://ui.shadcn.com/docs/changelog/2025-12-shadcn-create) | Scaffolds shadcn/ui with Base UI or Radix, one of five styles (Vega, Nova, Maia, Lyra, Mira), an icon library, a font, base colour and radius. It rewrites component code to match, not just colours | **Used** to create `apps/web`: Base UI, Nova, Lucide, Geist |
| [tweakcn](https://github.com/jnsahaj/tweakcn) | Open-source (Apache-2.0) visual editor for shadcn themes, with live preview, presets and AI generation from an image. Exports the CSS variables shadcn expects | **Used** to tune or add palettes. It is the palette-picking site, and the output pastes straight into the token file |
| [DESIGN.md](https://cdn.jsdelivr.net/gh/google-labs-code/design.md@main/README.md) | Google Labs' spec for describing a design system to agents: YAML tokens plus prose sections, with a CLI that lints WCAG contrast and exports to Tailwind v4 | **Not adopted.** It is alpha, has no light and dark modes, and would be a second source of truth beside the token file. Revisit when it supports modes |
| [Anthropic frontend-design skill](https://github.com/anthropics/skills) | Pushes agents away from generic output toward a bold, distinctive look per project | **Not adopted.** It explores a new aesthetic each time, the opposite of keeping one product consistent |
| [Linear UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui) | Themes generated in LCH from three inputs: base colour, accent and contrast | **Model for later.** User palettes can be generated the same way, since our tokens are already OKLCH roles |

## Decisions

- **Nova over Mira.** Mira is the densest style, but phone controls must stay 44 px. Nova trims padding without fighting that.
- **Geist and Geist Mono.** Clean and neutral, with a matching mono for paths, commits and diffs. Both are offered by `shadcn create`.
- **Dark-first, indigo accent.** Neutral cool-grey surfaces with one indigo accent, as in Linear and Vercel. In dark mode, white text on a fill that also works as link text on the page cannot reach 4.5:1 both ways, so `primary` (fills) and `link` (text) are separate tokens.
- **Contrast checked numerically.** Every text pair in the seed was converted from OKLCH to sRGB and measured. All pass 4.5:1 in both modes. The closest are white on dark `primary` at 4.97 and light `warning` on the page at 4.87.
