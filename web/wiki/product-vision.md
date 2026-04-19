# Product vision

**Turn any photo or video into a 3D experience in one upload.**

## What we ship

A web tool that takes a photo or short video, runs AI depth estimation, and produces six 3D formats viewable without special hardware (or with $2 red/cyan glasses):

- **Anaglyph** — red/cyan glasses, works on any screen
- **Stereogram** — "Magic Eye" cross-eye, no glasses
- **Color stereogram** — photograph-textured Magic Eye
- **SBS** (side-by-side) — VR headsets, Looking Glass
- **Wiggle 3D** — 2-frame GIF, no glasses, works on any phone
- **Video** — any of the above, per-frame

The original photo is never replaced; users get back all formats and pick.

## Who it's for

- Kids / hobbyists playing with red-cyan glasses
- Social media creators wanting a novelty effect
- Headset owners with Looking Glass / VR who need SBS inputs
- Pro: short video content creators (Pro plan unlocks video)

Not for: professional VFX, photogrammetry, or metric depth. A generic monocular depth model has limits — see [depth-model](depth-model.md).

## Why it works

Depth Anything V2 Large is good enough for "entertainment-grade" 3D on almost any natural photo. Running it server-side means users can upload a 60-second video, close the tab, and come back later — no client-side compute burden.

## What we deliberately don't do

- **No account required for first taste.** 20 free credits with just a session cookie. Reduces signup friction; converts the user after they see a result.
- **No customer-facing refund UI.** Credits are cheap enough that asking for a refund is more friction than it's worth. Admin can refund manually if they ask.
- **No return-to-render queue.** Once a job starts processing, it finishes — no pause/resume.
