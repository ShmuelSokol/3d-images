# 3D Images wiki

Short pages. Updated as things change. If a fact here disagrees with the code, the code wins and this page is stale — fix it.

Site: **3d.kbrlive.com** · Repo: **github.com/ShmuelSokol/3d-images**

## Product

- [Product vision](product-vision.md) — what we're building, for whom, why
- [Pricing](pricing.md) — Free, Pro ($9.99/mo), Credits Pack ($20)
- [Output formats](output-formats.md) — anaglyph, stereogram, SBS, color stereo, wiggle, videos

## Engineering

- [Architecture](architecture.md) — upload → queue → depth → generate → upload results
- [Depth model](depth-model.md) — V2 Large, why not V3, caching
- [Job queue](job-queue.md) — DB-backed, one at a time, worker child process
- [Stereogram algorithms](stereogram-algorithms.md) — random-dot, color strip-feedback, temporal
- [Safety & data protection](safety.md) — post-2026-04-19 rules, backups, health-check, runbook
- [Deployment](deployment.md) — git push only, Railway env, Docker quirks
- [Supabase migration](migration/README.md) — 2026-04-19 move off shared project

## Process

- [Roadmap](roadmap.md) — priority order, what's blocked on what
- [Decisions](decisions.md) — rolling log: what we decided and why

---

**Conventions for this wiki**

- Every page ≤ 1 screen if possible. Link out instead of padding.
- Lead with the conclusion. Reasoning goes below.
- Numbers with units ($9.99/mo, not "cheap"). Dates absolute (2026-04-19, not "last week").
- When in doubt, delete. Stale docs are worse than missing docs.
