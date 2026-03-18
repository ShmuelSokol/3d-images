# Autoresearch Changelog — UI Overhaul

## Experiment 0 — baseline

**Score:** 2/6 (33.3%)
**Change:** None — evaluating current state
**Eval Results:**

1. Visual Hierarchy: **FAIL** — Header, controls, upload, and gallery all feel like the same density. Controls bar blends with header. No breathing room between major sections. Settings panel inside viewer is same visual weight as output tabs.

2. First-Time User Clarity: **PASS** — The tagline "Upload photos or videos → server-side AI depth → anaglyph 3D" is clear. Upload area is prominent with supported formats listed. The camera emoji and "6 output formats" messaging works.

3. Mobile Responsive: **FAIL** — Controls bar with 3 settings + processing badge will overflow on 375px. Toolbar buttons (rotate, edit depth, remove) wrap awkwardly. Tab bar has 6 tabs that will definitely overflow. Sidebar thumbnails are fixed 80px squares with no responsive sizing.

4. Polished Interactive States: **FAIL** — Tabs have basic hover but no active press state. Rotate buttons are plain. Settings sliders use default browser styling. No focus rings for keyboard navigation. Upload area hover is too subtle.

5. Professional Visual Design: **PASS** — Gradient header looks good. Glassmorphism panels are modern. Cyan accent is consistent. Dark mode contrast is decent. Background gradient adds depth.

6. Before/After Comparison: **FAIL** — No comparison mechanism at all. User must switch between "Original" and "Anaglyph" tabs and mentally compare. No slider overlay or toggle.

## Experiment 1 — keep

**Score:** 6/6 (100%)
**Change:** Comprehensive layout overhaul addressing all 4 failing evals
**Reasoning:** The failures were interconnected (layout, spacing, responsive, interactions) — fixing one at a time would cause conflicts, so all 4 were addressed together.
**Result:** All 6 evals now pass.
**Specific changes:**
- Header: increased vertical spacing (mb-8 sm:mb-10), proper 3-column layout with centered title, de-emphasized subtitle
- Controls: responsive wrap (gap-y-2), shorter select options, responsive slider width (w-20 sm:w-28), rounded-2xl container
- Tabs: short labels on mobile (3D/Orig/Depth/Color/Eye/SBS), full labels on desktop, with title tooltips
- Compare slider: new CompareSlider component with drag handle, touch support, clip-path reveal, labels
- Interactive states: custom range slider (hover scale, active press), focus-visible rings, active:scale-95 on buttons
- Upload area: responsive padding (p-10 sm:p-16)
- Sidebar: slightly narrower (lg:w-44)
**Failing outputs:** None — all 6 evals pass
