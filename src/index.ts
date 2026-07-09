import express, { Request, Response, NextFunction } from "express";
import { prisma } from "./db";
import { cache } from "./cache";
import { canonical } from "./poker";

const app = express();
app.use(express.json());

// tiny async wrapper so route errors return JSON instead of hanging
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

// Resolve a user by handle, creating on first sight (keeps the demo frictionless).
async function resolveUser(handle: string) {
  const h = (handle || "demo").toLowerCase().trim();
  return prisma.user.upsert({ where: { handle: h }, update: {}, create: { handle: h } });
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
app.get("/", (_req, res) => {
  res.json({
    service: "poker-trainer-api",
    ok: true,
    endpoints: [
      "GET  /api/spots",
      "GET  /api/spots/:key/range   (full 13x13 range chart, cached)",
      "GET  /api/quiz/next?handle=demo",
      "POST /api/quiz/answer  { handle, spotKey, hand, action }",
      "GET  /api/progress/:handle",
    ],
  });
});

// ---------------------------------------------------------------------------
// Spots + range charts
// ---------------------------------------------------------------------------
app.get("/api/spots", wrap(async (_req, res) => {
  const spots = await prisma.spot.findMany({
    orderBy: { key: "asc" },
    select: { key: true, name: true, heroPosition: true, scenario: true, description: true, actions: true },
  });
  res.json({ spots });
}));

// Full range chart for a spot. Read-heavy and static, so it is cached.
app.get("/api/spots/:key/range", wrap(async (req, res) => {
  const key = req.params.key;
  const cacheKey = `range:${key}`;
  const cached = await cache.get(cacheKey);
  if (cached) return res.json({ ...(cached as object), cached: true });

  const spot = await prisma.spot.findUnique({
    where: { key },
    include: { entries: { select: { hand: true, action: true, frequency: true } } },
  });
  if (!spot) return res.status(404).json({ error: "Spot not found" });

  const payload = {
    spot: { key: spot.key, name: spot.name, heroPosition: spot.heroPosition, scenario: spot.scenario },
    chart: spot.entries, // 169 hands with the GTO-correct action
  };
  await cache.set(cacheKey, payload, 3600);
  res.json({ ...payload, cached: false });
}));

// ---------------------------------------------------------------------------
// Quiz engine
// ---------------------------------------------------------------------------
// Serve a random spot + a random hand from the grid. The answer is NOT revealed.
app.get("/api/quiz/next", wrap(async (req, res) => {
  const spots = await prisma.spot.findMany({ select: { id: true, key: true } });
  if (spots.length === 0) return res.status(404).json({ error: "No spots seeded" });
  const spot = spots[Math.floor(Math.random() * spots.length)];

  const entries = await prisma.rangeEntry.findMany({ where: { spotId: spot.id }, select: { hand: true } });
  const hand = entries[Math.floor(Math.random() * entries.length)].hand;

  const full = await prisma.spot.findUnique({
    where: { id: spot.id },
    select: { key: true, name: true, heroPosition: true, scenario: true, actions: true, description: true },
  });

  res.json({
    question: {
      spotKey: full!.key,
      spot: full!.name,
      heroPosition: full!.heroPosition,
      scenario: full!.scenario,
      prompt: `${full!.description} Your hand: ${hand}.`,
      hand,
      actions: full!.actions, // the choices the user picks from
    },
  });
}));

// Check an answer against the GTO-correct action, record the attempt, return feedback.
app.post("/api/quiz/answer", wrap(async (req, res) => {
  const { handle, spotKey, hand: rawHand, action } = req.body || {};
  if (!spotKey || !rawHand || !action) {
    return res.status(400).json({ error: "spotKey, hand and action are required" });
  }
  const hand = canonical(String(rawHand));
  const spot = await prisma.spot.findUnique({ where: { key: spotKey } });
  if (!spot) return res.status(404).json({ error: "Spot not found" });

  const entry = await prisma.rangeEntry.findUnique({ where: { spotId_hand: { spotId: spot.id, hand } } });
  if (!entry) return res.status(400).json({ error: `Unknown hand "${rawHand}"` });

  const chosen = String(action).toLowerCase();
  const correctAction = entry.action;
  const isCorrect = chosen === correctAction;

  const user = await resolveUser(handle);
  await prisma.attempt.create({
    data: { userId: user.id, spotId: spot.id, hand, chosenAction: chosen, correctAction, isCorrect },
  });

  res.json({
    correct: isCorrect,
    yourAction: chosen,
    correctAction,
    frequency: entry.frequency,
    explanation: isCorrect
      ? `Correct. ${hand} is a ${correctAction} in the ${spot.heroPosition} ${spot.scenario} range.`
      : `Not quite. The GTO play with ${hand} from ${spot.heroPosition} (${spot.scenario}) is to ${correctAction}, not ${chosen}.`,
  });
}));

// ---------------------------------------------------------------------------
// Progress + mistake tracking
// ---------------------------------------------------------------------------
app.get("/api/progress/:handle", wrap(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { handle: req.params.handle.toLowerCase() } });
  if (!user) return res.json({ handle: req.params.handle, attempts: 0, accuracy: 0, bySpot: [], topMistakes: [] });

  const attempts = await prisma.attempt.findMany({
    where: { userId: user.id },
    include: { spot: { select: { name: true, key: true } } },
    orderBy: { createdAt: "desc" },
  });

  const total = attempts.length;
  const correct = attempts.filter((a) => a.isCorrect).length;

  // Accuracy per spot
  const bySpotMap = new Map<string, { spot: string; total: number; correct: number }>();
  for (const a of attempts) {
    const cur = bySpotMap.get(a.spot.key) || { spot: a.spot.name, total: 0, correct: 0 };
    cur.total += 1;
    if (a.isCorrect) cur.correct += 1;
    bySpotMap.set(a.spot.key, cur);
  }
  const bySpot = [...bySpotMap.values()].map((s) => ({
    ...s, accuracy: s.total ? Math.round((s.correct / s.total) * 100) : 0,
  }));

  // Most common mistakes (hand + spot where the user erred)
  const mistakeMap = new Map<string, { spot: string; hand: string; correctAction: string; count: number }>();
  for (const a of attempts.filter((x) => !x.isCorrect)) {
    const k = `${a.spot.key}:${a.hand}`;
    const cur = mistakeMap.get(k) || { spot: a.spot.name, hand: a.hand, correctAction: a.correctAction, count: 0 };
    cur.count += 1;
    mistakeMap.set(k, cur);
  }
  const topMistakes = [...mistakeMap.values()].sort((a, b) => b.count - a.count).slice(0, 10);

  res.json({
    handle: user.handle,
    attempts: total,
    correct,
    accuracy: total ? Math.round((correct / total) * 100) : 0,
    bySpot,
    topMistakes,
  });
}));

// JSON error handler (never leave a request hanging)
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("api error:", err);
  res.status(500).json({ error: "Server error", detail: String((err as Error)?.message ?? err) });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`poker-trainer-api listening on :${port}`));
