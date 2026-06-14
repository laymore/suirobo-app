# Design

## Theme

Dark trading-terminal. Deep navy surfaces, one blue accent. Flat — no gradients on new work (legacy gradients being phased out).

## Color palette

| Token | Value | Use |
|---|---|---|
| `--bg-base` | `#060e1e` | page background |
| `--bg-card` | `#0a1628` | cards/panels |
| `--bg-surface` | `#16293F` | raised surfaces, inputs |
| `--border` | `#334155` | hairlines |
| `--sui-blue` | `#4DA2FF` | PRIMARY accent: CTAs, active nav, links, brand |
| `--accent-cyan` | `#00D4FF` | secondary signal accent (sparingly: live indicators) |
| `--accent-green` / profit | `#2BD9A7` | profit numbers, positive status only |
| `--accent-red` / loss | `#FF5A65` | loss numbers, errors only |
| `--text-primary` | `#e2e8f0` | body |
| `--text-secondary` | `#94a3b8` | muted |

Ratio 60/30/10: navy 60%, text+surface 30%, Sui Blue ≤10%. Green/red are data colors, never decoration. No purple/pink accents on new work.

## Typography

- Display/headings: Space Grotesk 500–700 (hero, section titles)
- UI & body: Inter 400/500/600
- Data (prices, addresses, PnL): monospace (`Share Tech Mono` legacy / `ui-monospace`)
- Scale ratio ~1.2; hero ≤ 3rem.

## Logo

"Droplet bot": Sui water-drop shaped robot head, visor + two aqua eyes + antenna. Component: `src/components/Logo.tsx` (mark / lockup variants). Favicon `public/favicon.svg`. Never use the 🤖 emoji as brand.

## Components

- Buttons: primary = solid `--sui-blue`, dark navy text `#04284F`, radius 10–12px; secondary = 1px `--sui-blue` outline, blue text. Verb+object labels.
- Status pills: dot + label, green=connected/live, gray=off.
- Cards: `--bg-card`, 1px `--border`, radius 12–16px. No nested cards, no left-stripe accents.
- Numbers shown to users are always rounded/`toFixed`.

## Motion

150–250ms ease-out state transitions only. No page-load choreography. `prefers-reduced-motion` honored.
