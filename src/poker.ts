// Poker domain logic: hand notation, the 13x13 grid, and preflop range expansion.
// Ranges below are standard ~GTO 6-max 100bb RFI (raise-first-in) opening ranges,
// authored for the trial. The schema stores per-hand action + frequency, so real
// solver output (mixed strategies) drops in without any code change.

export const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;
export type Rank = (typeof RANKS)[number];

const idx = (r: string) => RANKS.indexOf(r as Rank);

/** All 169 canonical starting hands: pairs, suited (high card first), offsuit. */
export function allHands(): string[] {
  const hands: string[] = [];
  for (let i = 0; i < RANKS.length; i++) {
    for (let j = 0; j < RANKS.length; j++) {
      if (i === j) hands.push(RANKS[i] + RANKS[j]); // pair
      else if (i < j) hands.push(RANKS[i] + RANKS[j] + "s"); // suited, higher first
      else hands.push(RANKS[j] + RANKS[i] + "o"); // offsuit, higher first
    }
  }
  return hands;
}

/** Normalize any hand string (e.g. "kqs", "QKo") to canonical form ("KQs"). */
export function canonical(hand: string): string {
  const h = hand.trim();
  if (h.length === 2) {
    const [a, b] = [h[0].toUpperCase(), h[1].toUpperCase()];
    if (a === b) return a + b; // pair
    return idx(a) < idx(b) ? a + b + "s" : b + a + "s"; // default suited if no suffix
  }
  const [a, b] = [h[0].toUpperCase(), h[1].toUpperCase()];
  const suffix = h[2].toLowerCase() === "s" ? "s" : "o";
  return idx(a) < idx(b) ? a + b + suffix : b + a + suffix;
}

// Expand a single range token into concrete hands.
function expandToken(token: string): string[] {
  const t = token.trim();

  // explicit span, e.g. "A5s-A2s"
  if (t.includes("-")) {
    const [start, end] = t.split("-").map((x) => x.trim());
    const suited = start.endsWith("s");
    const high = start[0];
    const kLo = idx(end[1]);
    const kHi = idx(start[1]);
    const out: string[] = [];
    for (let k = Math.min(kHi, kLo); k <= Math.max(kHi, kLo); k++) {
      out.push(high + RANKS[k] + (suited ? "s" : "o"));
    }
    return out;
  }

  // pairs "55+" or single pair "77"
  if (t.length >= 2 && t[0] === t[1]) {
    if (t.endsWith("+")) {
      const from = idx(t[0]);
      const out: string[] = [];
      for (let r = from; r >= 0; r--) out.push(RANKS[r] + RANKS[r]);
      return out;
    }
    return [t[0] + t[1]];
  }

  // "ATs+" / "K9s+" / "AQo+": fix high card, walk kicker up to just below it
  if (t.endsWith("+")) {
    const body = t.slice(0, -1);
    const high = body[0];
    const kick = body[1];
    const suffix = body[2] === "s" ? "s" : "o";
    const out: string[] = [];
    for (let k = idx(kick); k > idx(high); k--) out.push(high + RANKS[k] + suffix);
    return out;
  }

  // single hand, e.g. "76s", "AKo"
  return [canonical(t)];
}

export function expandRange(tokens: string[]): Set<string> {
  const set = new Set<string>();
  for (const token of tokens) for (const h of expandToken(token)) set.add(h);
  return set;
}

// ------- Preflop RFI opening ranges by hero position (6-max, 100bb) -------
export const RFI_RANGES: Record<string, string[]> = {
  UTG: ["55+", "ATs+", "A5s-A4s", "KTs+", "QTs+", "JTs", "T9s", "98s", "AJo+", "KQo"],
  CO: ["22+", "A2s+", "K9s+", "Q9s+", "J9s+", "T8s+", "97s+", "86s+", "76s", "65s", "54s", "ATo+", "KTo+", "QTo+", "JTo"],
  BTN: ["22+", "A2s+", "K5s+", "Q7s+", "J7s+", "T7s+", "96s+", "85s+", "75s+", "64s+", "54s", "53s", "43s", "A2o+", "K8o+", "Q9o+", "J9o+", "T9o", "98o", "87o"],
};

export const SPOTS = [
  { key: "rfi-utg", name: "RFI — Under the Gun", heroPosition: "UTG", scenario: "RFI",
    description: "First to act. Should you open-raise or fold this hand from UTG?" },
  { key: "rfi-co", name: "RFI — Cutoff", heroPosition: "CO", scenario: "RFI",
    description: "Folded to you in the Cutoff. Open-raise or fold?" },
  { key: "rfi-btn", name: "RFI — Button", heroPosition: "BTN", scenario: "RFI",
    description: "Folded to you on the Button, the widest opening range. Raise or fold?" },
];

/** For a position, return the correct action for every one of the 169 hands. */
export function rangeEntriesFor(position: string): { hand: string; action: string; frequency: number }[] {
  const raises = expandRange(RFI_RANGES[position] || []);
  return allHands().map((hand) => ({
    hand,
    action: raises.has(hand) ? "raise" : "fold",
    frequency: 1,
  }));
}
