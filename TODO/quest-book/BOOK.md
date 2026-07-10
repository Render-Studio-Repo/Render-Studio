# North Star — Architect Mode

## The fantasy

You draft on a **3 ft bay** lattice, one level at a time. Walls are chains of **3 ft segments**. Windows and doors are **features snapped onto a whole bay**. The 3D view is a plan extruded up — no looking under the floor.

UI is a **domino** you can reverse: lay walls first, then stamp window/door features, jump back to walls anytime. Only current-step controls. **Connectors stay out of design** (standardized on export).

## Locked decisions

See [DECISIONS.md](./DECISIONS.md).

| # | Choice |
|---|--------|
| Grid / atom | **3 ft segments** |
| Walls | Centerline **bays**; chain for longer runs |
| Openings | `feature` on a segment (`wall` \| `window` \| `door`) |
| Persist | `architect/building.json` |
| UI | Domino: Level → Walls ⇄ Window ⇄ Door → Review |
| Connectors | Export-time only |

## Target delta

| Today | Target |
|-------|--------|
| Free / mm modules + kits | **3 ft** blank segments, then features |
| Connector generation in design | Never in design steps |
| Dense CAD chrome | Domino · one step’s tools only |
| AI room kits | AI sets segment features / places bays |

## Success snapshot

Architect → Level → chain blank 3 ft walls into a room → Window step stamps glazed bays → Door step stamps entries → bounce back to Walls to add a wing → Review — Design mode untouched.
