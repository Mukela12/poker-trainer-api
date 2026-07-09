# Poker Trainer API

A lightweight backend for a Texas Hold'em **preflop range-training and quiz** platform.
Built for the paid-trial scope: a clean data model, a small REST API, a quiz +
answer-checking flow, and per-user mistake / progress tracking. Not a solver, and not
a gambling product, a training tool in the spirit of GTO Wizard's drill mode.

**Stack:** TypeScript · Node.js (Express) · PostgreSQL (Prisma) · a Redis-ready cache layer.

---

## Technical approach (the short version)

The core idea: a poker range chart is just **the correct action for each of the 169
starting hands in a given spot**. Model that cleanly and the quiz, answer-checking, and
progress features all fall out of it.

### Data model (`prisma/schema.prisma`)
- **`Spot`** — a training scenario: hero position + scenario, e.g. *RFI (raise-first-in)
  from the Cutoff*. Carries the list of `actions` a player may choose. Extensible to
  `vs-3bet`, `vs-limp`, etc. without schema changes.
- **`RangeEntry`** — one row per hand in a spot's chart (169 per spot): `hand`
  (canonical notation `AA`, `AKs`, `72o`), the GTO-correct `action`, and a `frequency`
  (0–1). Frequency means the model already supports **mixed strategies**: dropping in
  real solver output (e.g. "raise 65% / call 35%") needs no code change, just data.
- **`Attempt`** — every quiz answer: the user's action, the correct action, and whether
  it matched. This single append-only table powers all progress and mistake analytics.
- **`User`** — minimal, keyed by handle.

Correctness lives in Postgres and code, never guessed by a model, so answer-checking is
deterministic and auditable.

### API (`src/index.ts`)
| Method | Route | Purpose |
|---|---|---|
| GET | `/api/spots` | List training spots |
| GET | `/api/spots/:key/range` | Full 13×13 range chart for a spot (cached) |
| GET | `/api/quiz/next?handle=demo` | Serve a random spot + hand; the answer is **not** revealed |
| POST | `/api/quiz/answer` | Check `{ handle, spotKey, hand, action }` vs the correct range, record the attempt, return feedback |
| GET | `/api/progress/:handle` | Accuracy overall, accuracy per spot, and the top repeated mistakes |

Answer-checking normalizes input (`aks` → `AKs`, `QKo` → `KQo`) via `src/poker.ts` so
the client can be forgiving.

### Poker logic (`src/poker.ts`)
- Generates all 169 canonical hands.
- A compact **range-notation expander**: `"55+"`, `"ATs+"`, `"A5s-A2s"`, `"AQo+"`,
  singletons — the shorthand real charts are written in.
- Seeded 6-max 100bb **RFI opening ranges** for UTG / CO / BTN, which come out to
  realistic opening frequencies (≈17% / 31% / 49%).

### Caching (`src/cache.ts`)
Range charts are read on every quiz render but change rarely, so they are cached behind
a small `Cache` interface. An in-memory TTL cache ships by default; the same interface is
a **drop-in for Redis** (ioredis) in production, the file documents the two-line swap.
Redis sorted sets are the natural next step for streaks / leaderboards.

---

## Run it locally

```bash
npm install
cp .env.example .env          # set DATABASE_URL to a Postgres instance
npm run db:push               # create the schema
npm run db:seed               # load spots + real RFI range charts
npm run dev                   # http://localhost:3000
```

## Try the live API

Base URL: **see the link shared with this submission.**

```bash
# a quiz question
curl "$BASE/api/quiz/next?handle=demo"

# answer it (AA from the button is a raise)
curl -X POST "$BASE/api/quiz/answer" -H "content-type: application/json" \
  -d '{"handle":"demo","spotKey":"rfi-btn","hand":"AA","action":"raise"}'

# your progress and repeated mistakes
curl "$BASE/api/progress/demo"

# the full range chart for a spot
curl "$BASE/api/spots/rfi-utg/range"
```

---

## What I would build next (beyond the trial)
- More spot types (vs-3bet, vs-open flat/3bet, blind defense) — the schema already fits.
- Real solver charts with mixed frequencies (the `frequency` field is ready).
- Redis for the chart cache and for streak/leaderboard sorted sets.
- Spaced-repetition weighting so the quiz surfaces a player's weak spots more often
  (the `Attempt` history already contains everything needed to compute this).

Built by Mukela Katungu — backend developer, and an actual poker player (WPTGlobal / GTO Wizard).
