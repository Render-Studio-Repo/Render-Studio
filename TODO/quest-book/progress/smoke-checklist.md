# Smoke checklist — Architect PRs

**Quest 0.2:** Use this on every PR that touches yellow/red zones (or any Architect UI).  
**Waiver:** If skipped, note why in `progress/log.md`.

## A. Design mode (must not regress)

- [ ] App loads; WebGL viewport shows (or known fallback)
- [ ] Workspace mode **Design** works
- [ ] Orbit / pan / zoom (left-drag behavior as currently configured)
- [ ] Select an object (if project has geometry)
- [ ] AI / prompt panel visible on the right
- [ ] SOLID ribbon still shows normal CAD tools (not stuck on Architect catalog)

## B. Architect mode (legacy still boots until replaced)

- [ ] Switch workspace (or design tab) to **Architect**
- [ ] Body/app gets architect styling (`architect-design-tab` or equivalent)
- [ ] Existing place-wall / library still opens **or** new 3 ft segment tool works (whichever is current primary)
- [ ] Switch **back** to Design — prompt panel + orbit still OK

## C. After segment builder ships (add these)

- [ ] Place a blank **3 ft** wall segment on the lattice
- [ ] Chain a second bay from an endpoint
- [ ] Corner: two segments share a vertex with no gap
- [ ] `architect/building.json` appears / updates under the project
- [ ] Reload project → segments restore
- [ ] Window/Door step stamps feature on a bay (when Ch 4 done)
- [ ] Domino: can return Walls ← Window without losing the plan

## D. Explicit non-goals for smoke

- Do not require connector generation
- Do not require kit room placement for a pass
- Do not require AI for a pass

## Sign-off

| PR / session | Date | A | B | C | Notes |
|--------------|------|---|---|---|-------|
| Quest 0.2 authored | 2026-07-09 | n/a | n/a | n/a | Checklist created; no code change |
