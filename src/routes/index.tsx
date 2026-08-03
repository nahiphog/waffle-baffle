import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Waffle Baffle — Peanut Butter or Jam?" },
      {
        name: "description",
        content:
          "Waffle Baffle is a quick perception puzzle: study the waffle and guess whether peanut butter or strawberry jam covers more pieces. Square, honeycomb and triangle waffles.",
      },
      { property: "og:title", content: "Waffle Baffle — Peanut Butter or Jam?" },
      {
        property: "og:description",
        content:
          "Study the waffle and guess which topping covers more pieces. Square, honeycomb and triangle waffles, against the clock.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WaffleBaffle,
});

type Topping = "pb" | "jam";
type Shape = "square" | "honeycomb" | "triangle";
type Cell = { points: string };
type Round = { cells: Topping[]; winner: Topping; pb: number; jam: number };

const SHAPES: { id: Shape; label: string }[] = [
  { id: "square", label: "Square" },
  { id: "honeycomb", label: "Honeycomb" },
  { id: "triangle", label: "Triangle" },
];

const LABEL: Record<Topping, string> = {
  pb: "Peanut Butter",
  jam: "Strawberry Jam",
};

/* ---------- geometry ---------- */

const GAP = 0.06; // relative shrink of each piece so pieces read separately

function shrink(pts: [number, number][], factor = 1 - GAP): [number, number][] {
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  return pts.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor]);
}

function toPoints(pts: [number, number][]): string {
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
function honeycombCells(radius: number): Cell[] {
  const s = 1; // hex circumradius
  const cells: Cell[] = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      const cx = s * Math.sqrt(3) * (q + r / 2);
      const cy = s * 1.5 * r;
      const pts: [number, number][] = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 180) * (60 * i - 30);
        pts.push([cx + s * Math.cos(a), cy + s * Math.sin(a)]);
      }
      cells.push({ points: toPoints(shrink(pts)) });
    }
  }
  return cells;
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
      const pts: [number, number][] =
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

function useGeometry(shape: Shape) {
  return useMemo(() => {
    const cells =
      shape === "square"
        ? squareCells(10)
        : shape === "honeycomb"
          ? honeycombCells(6)
          : triangleCells(10);

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const c of cells) {
      for (const pair of c.points.split(" ")) {
        const [x, y] = pair.split(",").map(Number) as [number, number];
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    const pad = 0.15;
    return {
      cells,
      viewBox: `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`,
    };
  }, [shape]);
}

/* ---------- round generation ---------- */

function makeRound(total: number): Round {
  const lo = Math.ceil(total * 0.52);
  const hi = Math.floor(total * 0.56);
  const majority = lo + Math.floor(Math.random() * (hi - lo + 1));
  const winner: Topping = Math.random() < 0.5 ? "pb" : "jam";
  const loser: Topping = winner === "pb" ? "jam" : "pb";

  const cells: Topping[] = Array.from({ length: total }, (_, i) =>
    i < majority ? winner : loser,
  );
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = cells[i]!;
    cells[i] = cells[j]!;
    cells[j] = tmp;
  }

  return {
    cells,
    winner,
    pb: winner === "pb" ? majority : total - majority,
    jam: winner === "jam" ? majority : total - majority,
  };
}

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}s`;
}

/* ---------- component ---------- */

function WaffleBaffle() {
  const [shape, setShape] = useState<Shape>("square");
  const { cells, viewBox } = useGeometry(shape);
  const [round, setRound] = useState<Round | null>(null);
  const [guess, setGuess] = useState<Topping | null>(null);
  const [score, setScore] = useState({ played: 0, correct: 0 });

  const startedAt = useRef<number>(0);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);

  const deal = useCallback((total: number) => {
    setGuess(null);
    setRound(makeRound(total));
    startedAt.current = Date.now();
    setElapsed(0);
    setRunning(true);
  }, []);

  useEffect(() => {
    deal(cells.length);
  }, [cells.length, shape, deal]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setElapsed(Date.now() - startedAt.current), 50);
    return () => window.clearInterval(id);
  }, [running]);

  const answer = (t: Topping) => {
    if (!round || guess) return;
    setRunning(false);
    setElapsed(Date.now() - startedAt.current);
    setGuess(t);
    setScore((s) => ({
      played: s.played + 1,
      correct: s.correct + (t === round.winner ? 1 : 0),
    }));
  };

  const isCorrect = guess !== null && round !== null && guess === round.winner;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center gap-8 px-4 py-10">
      <header className="text-center">
        <h1 className="text-5xl font-black tracking-tight text-foreground sm:text-6xl">
          Waffle Baffle
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-base text-muted-foreground">
          One waffle, two toppings, one tiny difference. Which one covers more pieces?
        </p>
      </header>

      <div className="flex flex-wrap items-center justify-center gap-4">
        <div className="flex flex-wrap items-center justify-center gap-2 rounded-full border border-border bg-card px-2 py-2 shadow-sm">
          <span className="px-2 text-sm font-semibold text-muted-foreground">Waffle shape</span>
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

        <div className="rounded-full border border-border bg-card px-5 py-2 shadow-sm">
          <span className="text-sm font-semibold text-muted-foreground">Time </span>
          <span className="font-display text-lg font-bold tabular-nums text-foreground">
            {formatTime(elapsed)}
          </span>
        </div>
      </div>

      <section className="w-full max-w-xl">
        <div className="waffle-board p-3 sm:p-4">
          <svg
            viewBox={viewBox}
            className="h-auto w-full"
            role="img"
            aria-label={`${shape} waffle with ${cells.length} pieces`}
          >
            {cells.map((c, i) => {
              const t = round?.cells[i];
              return (
                <polygon
                  key={i}
                  points={c.points}
                  className={
                    t === "pb" ? "fill-pb" : t === "jam" ? "fill-jam-piece" : "fill-batter"
                  }
                />
              );
            })}
          </svg>
        </div>
      </section>

      <section className="flex w-full max-w-xl flex-col items-center gap-4">
        {guess === null ? (
          <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
            <Button
              size="lg"
              className="h-auto flex-col gap-1 rounded-2xl bg-peanut-butter py-5 text-lg font-extrabold text-waffle-crust hover:bg-peanut-butter/85"
              onClick={() => answer("pb")}
            >
              Peanut Butter
              <span className="text-xs font-semibold opacity-70">the tan pieces</span>
            </Button>
            <Button
              size="lg"
              className="h-auto flex-col gap-1 rounded-2xl bg-jam py-5 text-lg font-extrabold text-primary-foreground hover:bg-jam/85"
              onClick={() => answer("jam")}
            >
              Strawberry Jam
              <span className="text-xs font-semibold opacity-80">the red pieces</span>
            </Button>
          </div>
        ) : (
          round && (
            <div className="w-full rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
              <h2 className="text-2xl font-extrabold text-foreground">
                {isCorrect ? "Deliciously right!" : "Baffled!"}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                You picked {LABEL[guess]} in {formatTime(elapsed)}. {LABEL[round.winner]} covered
                more of the waffle.
              </p>
              <div className="mt-4 flex justify-center gap-6 text-sm font-bold">
                <span className="text-waffle-crust">Peanut Butter · {round.pb}</span>
                <span className="text-jam">Strawberry Jam · {round.jam}</span>
              </div>
              <Button
                className="mt-5 rounded-full px-8 font-bold"
                onClick={() => deal(cells.length)}
              >
                Serve another waffle
              </Button>
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
