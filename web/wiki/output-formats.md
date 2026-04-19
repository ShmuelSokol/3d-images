# Output formats

Every image job produces 3 formats by default (anaglyph, stereogram, SBS). Videos let the user pick which to render.

## Anaglyph (red/cyan)

Standard depth-shifted red channel vs cyan channels. Requires red/cyan glasses. Best quality for photo content.

Color modes: `dubois` (default, balanced), `true` (desaturated grey base for pure stereo depth), `optimized` (saturation trade-off).

`src/lib/server-anaglyph.ts` — `generateAnaglyph()`

## Stereogram (Magic Eye)

Classic random-dot autostereogram. Cross your eyes or relax focus to see depth. No glasses needed.

`scripts/worker.js:generateAutostereogram` (union-find pixel-linking approach). Works well because random dots have no structure to conflict with the depth shift.

## Color stereogram

Photograph-textured Magic Eye. **Algorithm: strip-based feedback** — seed leftmost strip from original image, each subsequent strip copies from prior strip + depth shift.

Previously tried union-find here — produced ghosting/tearing on natural photo textures. Research-backed fix: strip-feedback preserves texture coherence within each depth band. Strip width = `outW / 7`, max shift = 5% of strip width.

`src/lib/server-anaglyph.ts` — `generateColorStereogram()`

## SBS (side-by-side)

Left eye / right eye images concatenated. VR headsets, Looking Glass displays, or cross-eye viewing without a stereogram.

Half-width each (so output is same aspect ratio as input). Right eye shifted by depth.

## Wiggle 3D

2-frame alternating GIF (left eye → right eye → repeat). No glasses, no eye crossing — just looks 3D because your brain integrates the parallax over time. Works on any phone.

Not yet wired into the worker — currently demo-only in `server-anaglyph.ts`.

## Video

Any format above, frame-by-frame via ffmpeg. Max 60s @ 15fps = 900 frames. Each frame costs 1 credit.

- Frame extraction: `ffmpeg -vf fps=15`
- Per-frame depth + generation
- Reassembly: `ffmpeg -framerate 15 -i frame-%04d.png output.mp4`

**Temporal stereogram** (video-specific): uses a fixed base pattern across all frames so the Magic Eye "locks in" once and stays consistent — otherwise each frame generates a different random-dot pattern and the viewer loses focus every frame. `scripts/temporal-stereogram.js`.
