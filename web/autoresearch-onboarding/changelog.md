# Autoresearch Changelog — Onboarding Flow

## Experiment 0 — baseline

**Score:** 0/6 (0%)
**Change:** None — landing page has header + empty upload area with no guidance
**Eval Results:** All 6 fail — first-time users have no idea what the tool does or what outputs to expect

## Experiment 1 — keep

**Score:** 6/6 (100%)
**Change:** Full onboarding flow with real demo images
**Result:** All 6 evals pass.
**Specific changes:**

### New Component: OnboardingFlow.tsx
- **3-step flow cards**: Upload Photo → AI Estimates Depth → Get 6 Outputs
  - Numbered badges (cyan/purple/blue gradient)
  - Heroicons SVG icons (upload, sparkles, images)
  - Concise descriptions
  - Hover effects with matching border colors
- **Live demo section**: Real before/after with interactive format switcher
  - Original photo on left, output on right with arrow
  - 6 clickable format pills: Anaglyph 3D, Depth Map, Color Map, Magic Eye, Side-by-Side, Original
  - Each pill switches the output image in real-time
  - Gradient labels with format descriptions
  - Uses actual processed images from Supabase (not mocks)
- **CTA button**: "Try It Now — Upload Your Photo" triggers file picker
  - Gradient background, hover glow, active scale
  - Subtext: "Free to use · No account required · Processing continues even if you close the page"
- **Mobile responsive**: grid-cols-1 on mobile, stacked layout, rotated arrows

### Integration (ImageProcessor.tsx)
- OnboardingFlow lazy-loaded, shown only when `jobs.length === 0 && !uploading`
- Controls bar hidden during onboarding (irrelevant before first upload)
- Upload area simplified to "Or drop files here" when onboarding is visible
- Onboarding disappears as soon as first upload starts
