# Stereogram algorithms

Three variants, each with different failure modes on photo content.

## 1. Random-dot (classic Magic Eye)

`scripts/worker.js:generateAutostereogram`

**Approach:** union-find pixel linking. For each pixel, compute the shift at that depth, link it to the pixel at `x + shift` — forcing them to share a color. Then fill with random RGB per union.

**Why it works:** random noise has no texture, so duplicate-at-shift is invisible. The eye's only job is to find the pattern period — depth falls out automatically when you cross focus.

**Depth strength:** `maxShift = outW * 0.05`. More → stronger 3D pop, harder to fuse.

## 2. Color (photo-textured) stereogram

`src/lib/server-anaglyph.ts:generateColorStereogram`

**Approach:** strip-based feedback. Seed the leftmost strip from the original image. For each x beyond the strip width, copy from `x - stripWidth + shift`, where shift is the depth at that pixel.

```
strip 0: copy from original
strip 1+: copy from (prev strip) + depth shift
```

**Why not union-find here:** tried it first. Union-find forces duplicate colors across the shift — fine for random dots, **catastrophic for natural textures**. You get ghosting, tearing, and the original image becomes unrecognizable.

Strip-feedback preserves texture coherence within each depth band. The result looks like a tiled photograph that holds Magic Eye depth.

**Parameters:**
- Strip width: `outW / 7` (~14% of image)
- Max shift: 5% of strip width (0.7% of image)
- Depth pre-smoothing: Gaussian blur with `radius = max(3, min(dW,dH)/100)`

## 3. Temporal stereogram (video)

`scripts/temporal-stereogram.js`

**Problem:** a per-frame random-dot stereogram flickers — each frame has a different random pattern, viewer loses focus every 1/15s.

**Fix:** generate **one** base random-dot pattern for the whole video. Each frame reuses that pattern; only the depth shift varies.

The eye locks in once, stays locked through the whole clip.

## What breaks

- **Flat/graphic depth maps** (e.g., 2D logos, synthetic designs): binary depth = no gradient = Magic Eye looks flat or broken
- **Very high intensity**: shifts exceed strip width, viewer can't fuse
- **Sky backgrounds**: uniform depth = no interesting pattern

See [depth-model](depth-model.md) for why synthetic content struggles.
