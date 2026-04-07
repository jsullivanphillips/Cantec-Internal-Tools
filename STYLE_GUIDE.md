# Schedule Assist Style Guide

## Goal
Create a clean, professional product experience with an Apple-like visual standard and an IKEA-like brand voice: crafted quality that still feels practical, approachable, and budget-conscious.

## Brand Positioning
- **Visual character:** calm, polished, minimal, and intentional.
- **Voice character:** plainspoken, useful, and cost-aware.
- **Experience promise:** high trust and high clarity without premium-only complexity.

## Core Brand Colors
- **Primary colors:** Orange and Navy Blue.
- **Orange (`brand-orange`)** is the action and emphasis color:
  - Primary CTAs and high-priority highlights
  - Active accents that need attention without alarm
- **Navy (`brand-navy`)** is the trust and structure color (`#164b7c`; use CSS `var(--brand-navy)` in `index.css`):
  - Navigation emphasis, key headings, and anchor UI elements
  - Secondary CTAs and strong text accents
- **Usage balance:** Navy should be the dominant brand color; Orange should be used as the focused accent.
- **Accessibility rule:** Any orange/navy foreground usage must meet contrast requirements against its background.

## Core Principles
- **Clarity first:** every screen should be understandable in seconds.
- **Card-first composition:** group related content into clearly bounded surfaces.
- **Progressive disclosure:** show what matters now; tuck away secondary details.
- **Consistency over novelty:** patterns repeat across pages.
- **Efficient by default:** fewer clicks, fewer surprises, fast perceived load.

## Layout Conventions
- Use the shared app shell with sidebar navigation and top bar.
- Keep content inside `app-main` with existing padding rhythm.
- Preferred page stack:
  1. **Page intro / primary controls card**
  2. **Primary content card** (table, list, or key actions)
  3. Optional secondary cards for related sections

## Card System
- Use `app-surface-card` as the default container.
- Headers should be concise and functional (noun-based titles).
- Avoid decorative card effects; use subtle elevation and neutral borders.
- Keep card spacing consistent (`gap-3`/`gap-4` between major cards).

## Filters and Forms
- Filters live in a dedicated top card.
- Use short, explicit labels: `Quoted`, `Job Complete`, `Sort`.
- Prefer `All / Yes / No` for boolean filter sets.
- Inputs should wrap gracefully on smaller widths.
- Placeholder text should explain purpose, not format trivia.

## Tables
- Place tables inside a card body; do not float tables directly on page background.
- Use a rounded table container for visual containment.
- Header style:
  - small uppercase labels
  - muted gray color
  - slight letter spacing
- Always include an empty state row/message when no results match.
- Keep row density readable; avoid cramped vertical spacing.

## Feedback States
- **Loading:** spinner or skeleton based on expected load time.
- **Action progress:** button-level loading states (`Signing out...`, `Returning...`).
- **Empty:** clear, neutral message with no blame language.
- **Error:** short, actionable, and non-technical for end users.

## Content Style (IKEA-Inspired Voice)
- Write in plain English with practical wording.
- Keep labels short and literal (`Deficiencies`, `Keys`, `Refresh`).
- Prefer direct verbs for actions (`Find`, `Hide`, `Return`).
- Avoid hype words (`revolutionary`, `best-in-class`).
- Keep tone supportive and matter-of-fact.

## Naming and UI Copy Rules
- Use title case for page names and nav labels.
- Keep nav labels aligned with page titles when possible.
- Use singular/plural intentionally:
  - Collection pages use plural (`Deficiencies`, `Keys`).
  - Detail pages use entity name (`Key Detail`).

## Visual Tokens (Current Baseline)
- **Canvas:** light neutral background (`app-canvas`).
- **Card radius:** generally `0.75rem`.
- **Borders:** low-contrast grays for separation.
- **Shadows:** subtle (`0 1px 2px` to `0 1px 3px` range).
- **Accent color:** brand orange for priority emphasis.
- **Structural color:** brand navy for navigation and hierarchy.
- **Status colors:** semantic green/red for state cues, used sparingly.

## Accessibility and Usability
- Preserve sufficient contrast for text and controls.
- Keep keyboard focus visible.
- Do not encode meaning by color alone; pair with text/icon.
- Maintain touch-friendly target sizes for primary actions.

## Implementation Guidance
- Reuse existing shared classes before adding page-specific styling.
- Add page-specific classes only when the pattern is truly local.
- If a pattern appears in 2+ pages, promote it to shared styles.
- Keep CSS selectors scoped to avoid cross-page regressions.

## Page Update Checklist
- [ ] Is the page organized into clear cards?
- [ ] Is there a dedicated filters/controls card (if applicable)?
- [ ] Is the main table/list inside its own card?
- [ ] Do loading, empty, and action states feel consistent?
- [ ] Are labels concise, plainspoken, and consistent with nav/page naming?
- [ ] Does styling match existing radius, border, and spacing conventions?
- [ ] Did we avoid adding one-off styles that should be shared?

## Reference Files
- `frontend/src/index.css`
- `frontend/src/layout/AppLayout.tsx`
- `frontend/src/pages/HomePage.tsx`
- `frontend/src/pages/DeficiencyTrackerPage.tsx`
- `frontend/src/pages/KeysHomePage.tsx`
- `frontend/src/pages/KeyDetailPage.tsx`
