import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Waffle Baffle — Which Topping Covers More?" },
      {
        name: "description",
        content:
          "Waffle Baffle is a quick perception puzzle: study the waffle and guess which topping covers more pieces. Square, triangle and honeycomb waffles, daily and unlimited modes.",
      },
      { property: "og:title", content: "Waffle Baffle — Which Topping Covers More?" },
      {
        property: "og:description",
        content:
          "Study the waffle and guess which topping covers the most pieces. Three waffle shapes, normal and hard modes, daily puzzle or unlimited play.",
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

const SHAPES: { id: Shape; label: string }[] = [
  { id: "square", label: "Square" },
  { id: "triangle", label: "Triangle" },
  { id: "honeycomb", label: "Honeycomb" },
];

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

const EPOCH = Date.UTC(2026, 0, 1);

function dailyNumber(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return Math.floor((Date.UTC(y!, m! - 1, d!) - EPOCH) / 86400000) + 1;
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
    // zig-zag perimeter hugging every outer hexagon edge
    return unionOutline(honeycombPolys(6)).map(([x, y]) => [x * 1.075, y * 1.075]);
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
    return {
      cells,
      outline: toPoints(outline),
      viewBox: `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`,
    };
  }, [shape]);
}

/* ---------- round generation ---------- */

function pickCounts(total: number, difficulty: Difficulty, rng: Rng): number[] {
  if (difficulty === 2) {
    const lo = Math.ceil(total * 0.52);
    const hi = Math.floor(total * 0.56);
    const majority = lo + Math.floor(rng() * (hi - lo + 1));
    return [majority, total - majority];
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
    if (Math.max(...counts) - Math.min(...counts) > 4) return counts;
  }
  const base = Math.floor(total / 3);
  return [base + 2, base, total - (base + 2) - base];
}

function makeRound(total: number, difficulty: Difficulty, rng: Rng): Round {
  const pool = [...COLOR_GROUPS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  const groups = pool.slice(0, difficulty);
  const counts = pickCounts(total, difficulty, rng);

  const entries: Entry[] = groups.map((group, i) => ({
    group,
    topping: group.toppings[Math.floor(rng() * group.toppings.length)]!,
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

/* ---------- component ---------- */

function WaffleBaffle() {
  const [shape, setShape] = useState<Shape>("square");
  const [mode, setMode] = useState<Mode>("unlimited");
  const [difficulty, setDifficulty] = useState<Difficulty>(2);
  const [dark, setDark] = useState(true);
  const { cells, outline, viewBox } = useGeometry(shape);

  const [round, setRound] = useState<Round | null>(null);
  const [guess, setGuess] = useState<number | null>(null);
  const [score, setScore] = useState({ played: 0, correct: 0 });
  const [dayKey, setDayKey] = useState(todayKey());
  const [results, setResults] = useState<Partial<Record<Shape, Result>>>({});
  const [unlimitedNo, setUnlimitedNo] = useState(1);
  const [copied, setCopied] = useState(false);

  const startedAt = useRef<number>(0);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const deal = useCallback(
    (total: number, seed?: string) => {
      const rng = seed ? mulberry32(hash(seed)) : Math.random;
      setGuess(null);
      setRound(makeRound(total, difficulty, rng));
      startedAt.current = Date.now();
      setElapsed(0);
      setRunning(true);
      setCopied(false);
    },
    [difficulty],
  );

  useEffect(() => {
    deal(
      cells.length,
      mode === "daily" ? `${dayKey}|${shape}|${difficulty}` : undefined,
    );
  }, [cells.length, shape, mode, difficulty, dayKey, deal]);

  // a change of mode / level / day starts a fresh scorecard
  useEffect(() => {
    setResults({});
  }, [mode, difficulty, dayKey]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setElapsed(Date.now() - startedAt.current), 250);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    const id = window.setTimeout(() => setDayKey(todayKey()), msUntilMidnight() + 500);
    return () => window.clearTimeout(id);
  }, [dayKey]);

  const answer = (i: number) => {
    if (!round || guess !== null) return;
    const ms = Date.now() - startedAt.current;
    const correct = i === round.winner;
    setRunning(false);
    setElapsed(ms);
    setGuess(i);
    setScore((s) => ({ played: s.played + 1, correct: s.correct + (correct ? 1 : 0) }));
    setResults((r) => ({ ...r, [shape]: { seconds: Math.floor(ms / 1000), correct } }));
  };

  const isCorrect = guess !== null && round !== null && guess === round.winner;
  const puzzleNo = mode === "daily" ? dailyNumber(dayKey) : unlimitedNo;

  const shareText = useMemo(() => {
    const lines = [
      `Waffle Baffle #${puzzleNo} (${difficulty === 2 ? "Normal" : "Hard"})`,
      ...SHAPES.filter((s) => results[s.id]).map((s) => {
        const r = results[s.id]!;
        return `${s.label}: ${shortTime(r.seconds)} ${r.correct ? "✅" : "❌"}`;
      }),
    ];
    return lines.join("\n");
  }, [puzzleNo, difficulty, results]);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center gap-7 px-4 py-6">
      <header className="flex w-full flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="rounded-full font-bold">
                How to play
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>How to play</DialogTitle>
                <DialogDescription>
                  Study the waffle and pick the topping that covers the most pieces. The
                  shares are close, so trust your eyes — and the clock is running.
                </DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>

          <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1">
            {(["daily", "unlimited"] as Mode[]).map((m) => (
              <Button
                key={m}
                size="sm"
                variant={m === mode ? "default" : "ghost"}
                className="rounded-full font-bold capitalize"
                onClick={() => setMode(m)}
              >
                {m}
              </Button>
            ))}
          </div>
        </div>

        <h1 className="order-first w-full text-center text-3xl font-black tracking-tight text-foreground sm:order-none sm:w-auto sm:text-4xl">
          Waffle Baffle
        </h1>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1">
            <span className="px-2 text-xs font-semibold text-muted-foreground">Level</span>
            {([2, 3] as Difficulty[]).map((d) => (
              <Button
                key={d}
                size="sm"
                variant={d === difficulty ? "default" : "ghost"}
                className="rounded-full font-bold"
                onClick={() => setDifficulty(d)}
              >
                {d === 2 ? "Normal" : "Hard"}
              </Button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="rounded-full font-bold"
            aria-label="Toggle dark mode"
            onClick={() => setDark((v) => !v)}
          >
            {dark ? "☀️ Light" : "🌙 Dark"}
          </Button>
        </div>
      </header>

      <p className="-mt-3 max-w-lg text-center text-base text-muted-foreground">
        One waffle, a few toppings, one tiny difference. Which one covers more pieces?
      </p>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <div className="flex flex-wrap items-center justify-center gap-2 rounded-full border border-border bg-card px-2 py-2 shadow-sm">
          <span className="px-2 text-sm font-semibold text-muted-foreground">Shape</span>
          {SHAPES.map((s) => (
            <Button
              key={s.id}
              size="sm"
              variant={s.id === shape ? "default" : "ghost"}
              className="rounded-full font-bold"
              onClick={() => setShape(s.id)}
            >
              {s.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="rounded-full border border-border bg-card px-6 py-2 shadow-sm">
        <span className="text-sm font-semibold text-muted-foreground">Time </span>
        <span className="font-display text-lg font-bold tabular-nums text-foreground">
          {formatTime(elapsed)}
        </span>
      </div>

      <section className="w-full max-w-xl">
        <div className="waffle-plate p-3 sm:p-4">
          <svg
            viewBox={viewBox}
            className="h-auto w-full"
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
      </section>

      <section className="flex w-full max-w-xl flex-col items-center gap-4">
        {guess === null ? (
          <div
            className={`grid w-full gap-3 ${difficulty === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
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
        ) : (
          round && (
            <div className="w-full rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
              <h2 className="text-2xl font-extrabold text-foreground">
                {isCorrect ? "Deliciously right!" : "Baffled!"}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                You picked {round.entries[guess]!.topping} in {formatTime(elapsed)}.{" "}
                {round.entries[round.winner]!.topping} covered more of the waffle.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-4 text-sm font-bold">
                {round.entries.map((e, i) => (
                  <span key={i} className="flex items-center gap-2">
                    <span
                      className="inline-block size-3 rounded-full"
                      style={{ backgroundColor: e.group.fill }}
                    />
                    {e.topping} · {e.count}
                  </span>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <Button
                  variant="outline"
                  className="rounded-full px-8 font-bold"
                  onClick={share}
                >
                  {copied ? "Copied!" : "Share"}
                </Button>
                {mode === "unlimited" && (
                  <Button
                    className="rounded-full px-8 font-bold"
                    onClick={() => {
                      setUnlimitedNo((n) => n + 1);
                      setResults({});
                      deal(cells.length);
                    }}
                  >
                    Serve another waffle
                  </Button>
                )}
              </div>
              {mode === "daily" && (
                <p className="mt-4 text-sm font-semibold text-muted-foreground">
                  That's today's daily waffle — a fresh one is served at midnight. Try the
                  other shapes, or switch to Unlimited to keep playing.
                </p>
              )}
            </div>
          )
        )}

        <p className="text-sm font-semibold text-muted-foreground">
          Score: {score.correct} / {score.played}
        </p>
      </section>
    </main>
  );
}
