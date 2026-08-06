import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calendar, Infinity as InfinityIcon, Info, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { COLOR_GROUPS, type ColorGroup } from "@/lib/toppings";

type GameMode = "classic" | "blitz" | "endurance";

const GAME_MODES: { id: GameMode; label: string; directive: string }[] = [
  { id: "classic", label: "Classic", directive: "Guess which topping appears most" },
  {
    id: "blitz",
    label: "Blitz",
    directive: "Answer within 5 seconds. The game continues until your first mistake",
  },
  { id: "endurance", label: "Endurance", directive: "Solve as many puzzles within 60 seconds" },
];

function parseGameMode(value: unknown): GameMode {
  return value === "blitz" || value === "endurance" ? value : "classic";
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => ({
    mode: parseGameMode(search["mode"]),
  }),
  head: () => ({
    meta: [
      { title: "Waffle Baffle: Which Topping Covers More?" },
      {
        name: "description",
        content:
          "Waffle Baffle is a quick perception puzzle: study the waffle and guess which topping covers more pieces. Classic, Blitz and Endurance modes on square, triangle and honeycomb waffles.",
      },
      { property: "og:title", content: "Waffle Baffle: Which Topping Covers More?" },
      {
        property: "og:description",
        content:
          "Waffle Baffle is a quick perception puzzle: study the waffle and guess which topping covers more pieces. Classic, Blitz and Endurance modes on square, triangle and honeycomb waffles.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WaffleBaffle,
});

type Shape = "square" | "triangle" | "honeycomb";
type Mode = "daily" | "unlimited";
type Difficulty = 2 | 3;
type Cell = { points: string };
type Entry = { group: ColorGroup; topping: string; count: number };
type Round = { cells: number[]; entries: Entry[]; winner: number };
type Result = { seconds: number; correct: boolean };
type DailyRecord = {
  results?: Partial<Record<Shape, Result>>;
  streak?: number;
  correct?: number;
  wrong?: number;
};

const SHAPES: { id: Shape; label: string }[] = [
  { id: "square", label: "Square" },
  { id: "triangle", label: "Triangle" },
  { id: "honeycomb", label: "Honeycomb" },
];

const BLITZ_MS = 5000;
const ENDURANCE_MS = 60000;

/* ---------- rng ---------- */

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

const EPOCH = Date.UTC(2026, 7, 3);

function dailyNumber(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return Math.floor((Date.UTC(y!, m! - 1, d!) - EPOCH) / 86400000) + 1;
}

function prettyDate(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function msUntilMidnight() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

/* ---------- geometry ---------- */

const GAP = 0.06;

type Pt = [number, number];

function shrink(pts: Pt[], factor = 1 - GAP): Pt[] {
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  return pts.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor]);
}

function toPoints(pts: Pt[]): string {
  return pts.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(" ");
}

function squareCells(size: number): Cell[] {
  const cells: Cell[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      cells.push({
        points: toPoints(
          shrink([
            [c, r],
            [c + 1, r],
            [c + 1, r + 1],
            [c, r + 1],
          ]),
        ),
      });
    }
  }
  return cells;
}

/** Centered hexagonal number layout: radius 6 => 127 hexagons. */
function honeycombPolys(radius: number): Pt[][] {
  const s = 1;
  const polys: Pt[][] = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      const cx = s * Math.sqrt(3) * (q + r / 2);
      const cy = s * 1.5 * r;
      const pts: Pt[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 180) * (60 * i - 30);
        pts.push([cx + s * Math.cos(a), cy + s * Math.sin(a)]);
      }
      polys.push(pts);
    }
  }
  return polys;
}

const key = (p: Pt) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;

/**
 * Boundary of a union of edge-sharing polygons: keep edges used by exactly one
 * cell and chain them into a single ring. Produces the zig-zag hex perimeter.
 */
function unionOutline(polys: Pt[][]): Pt[] {
  const counts = new Map<string, number>();
  const edges: { a: Pt; b: Pt; k: string }[] = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const ka = key(a);
      const kb = key(b);
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
      edges.push({ a, b, k });
    }
  }
  const border = edges.filter((e) => counts.get(e.k) === 1);
  const next = new Map<string, Pt[]>();
  for (const e of border) {
    const list = next.get(key(e.a)) ?? [];
    list.push(e.b);
    next.set(key(e.a), list);
  }
  const start = border[0]!.a;
  const ring: Pt[] = [start];
  const used = new Set<string>();
  let cur = start;
  for (let i = 0; i < border.length; i++) {
    const options = next.get(key(cur)) ?? [];
    const step = options.find((p) => !used.has(`${key(cur)}>${key(p)}`));
    if (!step) break;
    used.add(`${key(cur)}>${key(step)}`);
    if (key(step) === key(start)) break;
    ring.push(step);
    cur = step;
  }
  return ring;
}

/** Big equilateral triangle: row i has 2i+1 small triangles (rows = 10 => 100). */
function triangleCells(rows: number): Cell[] {
  const s = 1;
  const h = (Math.sqrt(3) / 2) * s;
  const cells: Cell[] = [];
  for (let r = 0; r < rows; r++) {
    const y = r * h;
    const x0 = -((r + 1) * s) / 2;
    for (let k = 0; k < 2 * r + 1; k++) {
      const j = Math.floor(k / 2);
      const x = x0 + j * s;
      const pts: Pt[] =
        k % 2 === 0
          ? [
              [x + s / 2, y],
              [x + s, y + h],
              [x, y + h],
            ]
          : [
              [x + s / 2, y],
              [x + 1.5 * s, y],
              [x + s, y + h],
            ];
      cells.push({ points: toPoints(shrink(pts, 1 - GAP * 1.6)) });
    }
  }
  return cells;
}

/** Outline that encloses the waffle, following the true shape of each layout. */
function outlineFor(shape: Shape): Pt[] {
  if (shape === "square") {
    const p = 0.16;
    return [
      [-p, -p],
      [10 + p, -p],
      [10 + p, 10 + p],
      [-p, 10 + p],
    ];
  }
  if (shape === "honeycomb") {
    return unionOutline(honeycombPolys(6)).map(([x, y]) => [x * 1.018, y * 1.018]);
  }
  const h = (Math.sqrt(3) / 2) * 10;
  const pts: Pt[] = [
    [0, 0],
    [5, h],
    [-5, h],
  ];
  return shrink(pts, 1.06);
}

function useGeometry(shape: Shape) {
  return useMemo(() => {
    const cells =
      shape === "square"
        ? squareCells(10)
        : shape === "honeycomb"
          ? honeycombPolys(6).map((p) => ({ points: toPoints(shrink(p)) }))
          : triangleCells(10);

    const outline = outlineFor(shape);

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const [x, y] of outline) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const pad = 0.6;
    // every shape renders into an identically sized square region
    const side = Math.max(maxX - minX, maxY - minY) + pad * 2;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    return {
      cells,
      outline: toPoints(outline),
      viewBox: `${cx - side / 2} ${cy - side / 2} ${side} ${side}`,
    };
  }, [shape]);

}

/* ---------- round generation ---------- */

function pickCounts(total: number, difficulty: Difficulty, rng: Rng): number[] {
  if (difficulty === 2) {
    const lo = Math.ceil(total * 0.52);
    const hi = Math.floor(total * 0.56);
    const majority = lo + Math.floor(rng() * (hi - lo + 1));
    // randomise which option holds the majority
    return rng() < 0.5 ? [majority, total - majority] : [total - majority, majority];
  }

  for (let guard = 0; guard < 5000; guard++) {
    let a = 0,
      b = 0,
      c = 0;
    for (let inner = 0; inner < 5000; inner++) {
      a = 0.27 + rng() * 0.11;
      b = 0.27 + rng() * 0.11;
      c = 1 - a - b;
      if (Math.max(a, b, c) - Math.min(a, b, c) <= 0.07) break;
    }
    const counts = [Math.round(a * total), Math.round(b * total), Math.round(c * total)];
    const sum = counts[0]! + counts[1]! + counts[2]!;
    if (sum !== total) continue;
    if (new Set(counts).size !== 3) continue;
    const sorted = [...counts].sort((x, y) => x - y);
    // largest must clear the runner-up by more than 3 pieces
    if (sorted[2]! - sorted[1]! <= 3) continue;
    if (Math.max(...counts) - Math.min(...counts) > 4) return counts;
  }
  const base = Math.floor(total / 3);
  return [base + 5, base, total - (base + 5) - base];
}

const words = (t: string) => t.toLowerCase().split(/\s+/);

/** Pick one topping per group so that no word is repeated across toppings. */
function pickToppings(groups: ColorGroup[], rng: Rng): string[] | null {
  const used = new Set<string>();
  const out: string[] = [];
  for (const g of groups) {
    const options = g.toppings.filter((t) => words(t).every((w) => !used.has(w)));
    if (options.length === 0) return null;
    const topping = options[Math.floor(rng() * options.length)]!;
    out.push(topping);
    words(topping).forEach((w) => used.add(w));
  }
  return out;
}

function makeRound(total: number, difficulty: Difficulty, rng: Rng): Round {
  let groups: ColorGroup[] = [];
  let toppings: string[] | null = null;
  for (let attempt = 0; attempt < 50 && !toppings; attempt++) {
    const pool = [...COLOR_GROUPS];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = pool[i]!;
      pool[i] = pool[j]!;
      pool[j] = tmp;
    }
    groups = pool.slice(0, difficulty);
    toppings = pickToppings(groups, rng);
  }
  if (!toppings) toppings = groups.map((g) => g.toppings[0]!);

  const counts = pickCounts(total, difficulty, rng);

  const entries: Entry[] = groups.map((group, i) => ({
    group,
    topping: toppings![i]!,
    count: counts[i]!,
  }));

  const cells: number[] = [];
  entries.forEach((e, i) => {
    for (let k = 0; k < e.count; k++) cells.push(i);
  });
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = cells[i]!;
    cells[i] = cells[j]!;
    cells[j] = tmp;
  }

  let winner = 0;
  entries.forEach((e, i) => {
    if (e.count > entries[winner]!.count) winner = i;
  });

  return { cells, entries, winner };
}

function formatTime(ms: number) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function shortTime(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function countdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function NextDaily() {
  const [ms, setMs] = useState(() => msUntilMidnight());
  useEffect(() => {
    const id = window.setInterval(() => setMs(msUntilMidnight()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="font-display tabular-nums">{countdown(ms)}</span>;
}

/* ---------- component ---------- */

function WaffleBaffle() {
  const { mode: gameMode } = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const setGameMode = (m: GameMode) =>
    navigate({ search: { mode: m }, replace: true });

  const [classicIdx, setClassicIdx] = useState(0);
  const [roundIdx, setRoundIdx] = useState(0);
  const shapeIdx = gameMode === "classic" ? classicIdx : roundIdx % SHAPES.length;
  const shape = SHAPES[shapeIdx]!.id;

  const [mode, setMode] = useState<Mode>("unlimited");
  const [difficulty, setDifficulty] = useState<Difficulty>(2);
  const [dark, setDark] = useState(true);
  const { cells, outline, viewBox } = useGeometry(shape);

  const [round, setRound] = useState<Round | null>(null);
  const [guess, setGuess] = useState<number | null>(null);
  const [started, setStarted] = useState(false);
  const [dayKey, setDayKey] = useState(todayKey());
  const [results, setResults] = useState<Partial<Record<Shape, Result>>>({});
  const [streak, setStreak] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);
  const [over, setOver] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [unlimitedNo, setUnlimitedNo] = useState(1);
  const [copied, setCopied] = useState(false);
  const [dailyDone, setDailyDone] = useState<DailyRecord | null>(null);

  const startedAt = useRef<number>(0);
  const runStartedAt = useRef<number>(0);
  const startedRef = useRef(false);
  const [elapsed, setElapsed] = useState(0);
  const [runElapsed, setRunElapsed] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    startedRef.current = started;
  }, [started]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`waffle-baffle-daily-${dayKey}-${gameMode}`);
      setDailyDone(raw ? (JSON.parse(raw) as DailyRecord) : null);
    } catch {
      setDailyDone(null);
    }
  }, [dayKey, gameMode]);

  const seedFor = useCallback(
    (s: Shape, idx: number) =>
      mode === "daily"
        ? `${dayKey}|${gameMode}|${s}|${idx}|${difficulty}`
        : `u${unlimitedNo}|${gameMode}|${s}|${idx}|${difficulty}|${dayKey}`,
    [mode, dayKey, difficulty, unlimitedNo, gameMode],
  );

  const puzzleIdx = gameMode === "classic" ? classicIdx : roundIdx;

  // deal a fresh waffle whenever the board changes; keep the run going once started
  useEffect(() => {
    setGuess(null);
    setCopied(false);
    setElapsed(0);
    if (startedRef.current) {
      startedAt.current = Date.now();
      setRunning(true);
    } else {
      setRunning(false);
    }
    setRound(makeRound(cells.length, difficulty, mulberry32(hash(seedFor(shape, puzzleIdx)))));
  }, [cells.length, shape, difficulty, seedFor, puzzleIdx]);

  const resetRun = useCallback(() => {
    setResults({});
    setClassicIdx(0);
    setRoundIdx(0);
    setStreak(0);
    setCorrectCount(0);
    setWrongCount(0);
    setOver(false);
    setShowSummary(false);
    startedRef.current = false;
    setStarted(false);
    setRunning(false);
    setElapsed(0);
    setRunElapsed(0);
  }, []);

  // a change of mode / level / day / game mode starts a fresh scorecard
  useEffect(() => {
    resetRun();
  }, [mode, difficulty, dayKey, gameMode, resetRun]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setElapsed(Date.now() - startedAt.current);
      setRunElapsed(Date.now() - runStartedAt.current);
    }, 100);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    const id = window.setTimeout(() => setDayKey(todayKey()), msUntilMidnight() + 500);
    return () => window.clearTimeout(id);
  }, [dayKey]);

  const persistDaily = useCallback(
    (record: DailyRecord) => {
      if (mode !== "daily") return;
      try {
        window.localStorage.setItem(
          `waffle-baffle-daily-${dayKey}-${gameMode}`,
          JSON.stringify(record),
        );
      } catch {
        /* storage unavailable */
      }
    },
    [mode, dayKey, gameMode],
  );

  const start = () => {
    startedAt.current = Date.now();
    runStartedAt.current = Date.now();
    setElapsed(0);
    setRunElapsed(0);
    setRunning(true);
    setStarted(true);
  };

  const finishBlitz = useCallback(
    (finalStreak: number) => {
      setRunning(false);
      setOver(true);
      setShowSummary(true);
      persistDaily({ streak: finalStreak });
    },
    [persistDaily],
  );

  const finishEndurance = useCallback(
    (right: number, wrong: number) => {
      setRunning(false);
      setOver(true);
      setShowSummary(true);
      persistDaily({ correct: right, wrong });
    },
    [persistDaily],
  );

  // timed-mode expiry
  useEffect(() => {
    if (!running || over) return;
    if (gameMode === "blitz" && elapsed >= BLITZ_MS) finishBlitz(streak);
    if (gameMode === "endurance" && runElapsed >= ENDURANCE_MS)
      finishEndurance(correctCount, wrongCount);
  }, [
    running,
    over,
    gameMode,
    elapsed,
    runElapsed,
    streak,
    correctCount,
    wrongCount,
    finishBlitz,
    finishEndurance,
  ]);

  const answer = (i: number) => {
    if (!round || !started || over) return;
    const correct = i === round.winner;

    if (gameMode === "blitz") {
      if (!correct) {
        finishBlitz(streak);
        return;
      }
      setStreak((s) => s + 1);
      setRoundIdx((n) => n + 1);
      return;
    }

    if (gameMode === "endurance") {
      if (correct) setCorrectCount((c) => c + 1);
      else setWrongCount((w) => w + 1);
      setRoundIdx((n) => n + 1);
      return;
    }

    if (guess !== null) return;
    const ms = Date.now() - startedAt.current;
    setRunning(false);
    setElapsed(ms);
    setGuess(i);
    const next = { ...results, [shape]: { seconds: Math.floor(ms / 1000), correct } };
    setResults(next);
    if (SHAPES.every((s) => next[s.id])) {
      setShowSummary(true);
      persistDaily({ results: next });
    }
  };

  const locked = mode === "daily" && dailyDone !== null;
  const isCorrect = guess !== null && round !== null && guess === round.winner;
  const puzzleNo = mode === "daily" ? dailyNumber(dayKey) : unlimitedNo;
  const allDone = SHAPES.every((s) => results[s.id]);
  const modeInfo = GAME_MODES.find((m) => m.id === gameMode)!;

  const record: DailyRecord = locked
    ? dailyDone!
    : { results, streak, correct: correctCount, wrong: wrongCount };

  const shareText = useMemo(() => {
    const link =
      typeof window === "undefined" ? "" : `${window.location.origin}${window.location.pathname}`;
    const header = `Waffle Baffle ${mode === "daily" ? `#${puzzleNo}` : "∞"} (${
      difficulty === 2 ? "Normal" : "Hard"
    }, ${modeInfo.label})`;

    if (gameMode === "blitz") {
      const s = record.streak ?? 0;
      return [
        header,
        `I won ${s} consecutive game${s === 1 ? "" : "s"}, each within 5 seconds.`,
        "",
        link,
      ].join("\n");
    }
    if (gameMode === "endurance") {
      const c = record.correct ?? 0;
      return [
        header,
        `I won ${c} game${c === 1 ? "" : "s"} within 60 seconds.`,
        "",
        link,
      ].join("\n");
    }
    const scores = record.results ?? {};
    return [
      header,
      ...SHAPES.filter((s) => scores[s.id]).map((s) => {
        const r = scores[s.id]!;
        return `${s.label}: ${shortTime(r.seconds)} ${r.correct ? "✅" : "❌"}`;
      }),
      "",
      link,
    ].join("\n");
  }, [puzzleNo, difficulty, mode, gameMode, modeInfo.label, record]);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const nextWaffle = () => {
    if (classicIdx < SHAPES.length - 1) setClassicIdx((i) => i + 1);
  };

  const playAgain = () => {
    setUnlimitedNo((n) => n + 1);
    resetRun();
  };

  const timerMs =
    gameMode === "blitz"
      ? Math.max(0, BLITZ_MS - elapsed)
      : gameMode === "endurance"
        ? Math.max(0, ENDURANCE_MS - runElapsed)
        : elapsed;

  const summaryBody = (
    <div className="text-center">
      {gameMode === "classic" && (
        <ul className="mx-auto flex w-fit flex-col gap-2 text-sm font-bold">
          {SHAPES.filter((s) => (record.results ?? {})[s.id]).map((s) => {
            const r = (record.results ?? {})[s.id]!;
            return (
              <li key={s.id} className="flex items-center gap-4 text-left">
                <span className="flex-1">{s.label}</span>
                <span className="w-14 text-right tabular-nums">{shortTime(r.seconds)}</span>
                <span>{r.correct ? "✅" : "❌"}</span>
              </li>
            );
          })}
        </ul>
      )}
      {gameMode === "blitz" && (
        <p className="text-base font-bold text-foreground">
          {record.streak ?? 0} consecutive win{(record.streak ?? 0) === 1 ? "" : "s"}, each
          within 5 seconds.
        </p>
      )}
      {gameMode === "endurance" && (
        <p className="text-base font-bold text-foreground">
          {record.correct ?? 0} correct · {record.wrong ?? 0} wrong in 60 seconds.
        </p>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button className="rounded-full px-8 font-bold" onClick={share}>
          {copied ? "Copied!" : "Share"}
        </Button>
        {mode === "unlimited" && (
          <Button variant="outline" className="rounded-full px-8 font-bold" onClick={playAgain}>
            Play again
          </Button>
        )}
      </div>
      {mode === "daily" && (
        <p className="mt-4 text-sm font-semibold text-muted-foreground">
          Next daily waffle in <NextDaily />.
        </p>
      )}
    </div>
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center gap-6 px-4 py-6">
      <header className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-border pb-4">
        <div className="flex items-center gap-1 justify-self-start">
          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full border-0"
                aria-label="How to play"
                title="How to play"
              >
                <Info className="size-5" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>How to play</DialogTitle>
                <DialogDescription>
                  Study the waffle and pick the topping that covers the most pieces. Classic
                  serves three waffles with no time limit, Blitz gives you 5 seconds per waffle
                  until your first mistake, and Endurance packs as many waffles as you can solve
                  into 60 seconds.
                </DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>

          <Button
            variant="ghost"
            size="icon"
            className="rounded-full border-0"
            aria-label={mode === "daily" ? "Daily mode" : "Unlimited mode"}
            title={mode === "daily" ? "Daily mode" : "Unlimited mode"}
            onClick={() => setMode((m) => (m === "daily" ? "unlimited" : "daily"))}
          >
            {mode === "daily" ? (
              <Calendar className="size-5" />
            ) : (
              <InfinityIcon className="size-5" />
            )}
          </Button>
        </div>

        <div className="flex flex-col items-center">
          <h1 className="text-2xl font-black tracking-tight text-foreground sm:text-4xl">
            Waffle Baffle
          </h1>
          <p className="text-center text-sm font-semibold text-muted-foreground">
            {mode === "daily" ? `#${puzzleNo}: ${prettyDate(dayKey)}` : "Unlimited mode"}
          </p>
        </div>

        <div className="flex items-center justify-self-end">
          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full border-0"
                aria-label="Settings"
                title="Settings"
              >
                <Settings className="size-5" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Settings</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-bold text-foreground">Difficulty</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full font-bold"
                    onClick={() => setDifficulty((d) => (d === 2 ? 3 : 2))}
                  >
                    {difficulty === 2 ? "Normal" : "Hard"}
                  </Button>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-bold text-foreground">Theme</span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="rounded-full text-lg leading-none font-bold"
                    aria-label="Toggle dark mode"
                    onClick={() => setDark((v) => !v)}
                  >
                    {dark ? "☼" : "☾"}
                  </Button>
                </div>
                <div className="border-t border-border pt-4 text-sm">
                  <p className="font-bold text-foreground">See the other games I've made</p>
                  <a
                    href="https://yellowyellow.xyz/"
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-primary underline underline-offset-4"
                  >
                    Yellow Yellow
                  </a>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-1 rounded-full bg-muted p-1">
          {GAME_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setGameMode(m.id)}
              className={`rounded-full px-4 py-1.5 text-sm font-bold transition-colors ${
                m.id === gameMode
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-center text-sm font-semibold text-muted-foreground">
          {modeInfo.directive}
        </p>
      </div>


      {locked ? (
        <section className="w-full max-w-xl rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <h2 className="text-2xl font-extrabold text-foreground">
            Today's daily {modeInfo.label.toLowerCase()} waffle is done
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            You've already served up daily #{puzzleNo}. Come back for a fresh plate.
          </p>
          <div className="mt-5">{summaryBody}</div>
          <Button
            variant="outline"
            className="mt-4 rounded-full px-8 font-bold"
            onClick={() => setMode("unlimited")}
          >
            Play unlimited
          </Button>
        </section>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <div className="font-display text-2xl font-bold tabular-nums text-foreground">
              {formatTime(timerMs)}
            </div>
            {gameMode === "blitz" && (
              <div className="font-display text-2xl font-bold text-foreground">✅ {streak}</div>
            )}
            {gameMode === "endurance" && (
              <div className="font-display text-2xl font-bold text-foreground">
                ✅ {correctCount} ❌ {wrongCount}
              </div>
            )}
          </div>

          <section className="relative w-full max-w-xl">
            <div className="waffle-plate p-3 sm:p-4">
              <svg
                viewBox={viewBox}
                className={`h-auto w-full transition-all duration-300 ${
                  started && !over ? "" : "blur-[28px]"
                }`}
                role="img"
                aria-label={`${shape} waffle with ${cells.length} pieces`}
              >
                <polygon points={outline} className="waffle-outline" />
                {cells.map((c, i) => {
                  const idx = round?.cells[i];
                  const entry = idx === undefined ? undefined : round?.entries[idx];
                  return (
                    <polygon
                      key={i}
                      points={c.points}
                      className={entry ? "waffle-piece" : "fill-batter"}
                      style={
                        entry
                          ? { fill: entry.group.fill, stroke: entry.group.stroke }
                          : undefined
                      }
                    />
                  );
                })}
              </svg>
            </div>

            {!started && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Button
                  size="lg"
                  className="rounded-full px-8 text-base font-extrabold shadow-lg"
                  onClick={start}
                >
                  Click here to start
                </Button>
              </div>
            )}
          </section>

          <section className="flex w-full max-w-xl flex-col items-center gap-4">
            {started && !over && guess === null ? (
              <>
                <p className="text-base font-bold text-foreground">
                  Which topping appears the most?
                </p>
                <div
                  className={`grid w-full gap-3 ${
                    difficulty === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"
                  }`}
                >
                  {round?.entries.map((e, i) => (
                    <Button
                      key={i}
                      size="lg"
                      className="h-auto flex-col gap-1 rounded-2xl py-5 text-base font-extrabold hover:opacity-85"
                      style={{ backgroundColor: e.group.fill, color: e.group.on }}
                      onClick={() => answer(i)}
                    >
                      {e.topping}
                      <span className="text-xs font-semibold opacity-75">
                        the {e.group.label} pieces
                      </span>
                    </Button>
                  ))}
                </div>
              </>
            ) : null}

            {gameMode === "classic" && guess !== null && round && (
              <div className="w-full rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
                <h2 className="text-2xl font-extrabold text-foreground">
                  {isCorrect ? "Smooth as butter!" : "Butter luck next time!"}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  You picked {round.entries[guess]!.topping} in {formatTime(elapsed)}.{" "}
                  {round.entries[round.winner]!.topping} covered more of the waffle.
                </p>
                <ul className="mx-auto mt-4 flex w-fit flex-col gap-2 text-sm font-bold">
                  {[...round.entries]
                    .sort((a, b) => b.count - a.count)
                    .map((e, i) => (
                      <li key={i} className="flex items-center gap-3 text-left">
                        <span
                          className="inline-block size-3 shrink-0 rounded-full"
                          style={{ backgroundColor: e.group.fill }}
                        />
                        <span className="flex-1">{e.topping}:</span>
                        <span className="w-10 text-right tabular-nums">{e.count}</span>
                      </li>
                    ))}
                </ul>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  {!allDone ? (
                    <Button className="rounded-full px-8 font-bold" onClick={nextWaffle}>
                      Go to the next waffle
                    </Button>
                  ) : (
                    <Button
                      className="rounded-full px-8 font-bold"
                      onClick={() => setShowSummary(true)}
                    >
                      See your results
                    </Button>
                  )}
                </div>
              </div>
            )}

            {over && gameMode !== "classic" && (
              <Button
                className="rounded-full px-8 font-bold"
                onClick={() => setShowSummary(true)}
              >
                See your results
              </Button>
            )}
          </section>
        </>
      )}

      <Dialog open={showSummary} onOpenChange={setShowSummary}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {gameMode === "classic"
                ? "Plate cleared!"
                : gameMode === "blitz"
                  ? "Blitz over!"
                  : "Time's up!"}
            </DialogTitle>
            <DialogDescription>
              Waffle Baffle {mode === "daily" ? `#${puzzleNo}` : "∞"} ·{" "}
              {difficulty === 2 ? "Normal" : "Hard"} · {modeInfo.label}
            </DialogDescription>
          </DialogHeader>
          {summaryBody}
        </DialogContent>
      </Dialog>
    </main>
  );
}
