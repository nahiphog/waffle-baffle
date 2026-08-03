import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Waffle Baffle — Peanut Butter or Jam?" },
      {
        name: "description",
        content:
          "Waffle Baffle is a quick perception puzzle: study the waffle grid and guess whether peanut butter or strawberry jam covers more squares.",
      },
      { property: "og:title", content: "Waffle Baffle — Peanut Butter or Jam?" },
      {
        property: "og:description",
        content:
          "Study the waffle grid and guess which topping covers more squares. Play unlimited rounds at 10x10 up to 25x25.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WaffleBaffle,
});

type Topping = "pb" | "jam";
type Round = { cells: Topping[]; winner: Topping; pb: number; jam: number };

const SIZES = [10, 15, 20, 25] as const;

function makeRound(size: number): Round {
  const total = size * size;
  const lo = Math.ceil(total * 0.53);
  const hi = Math.floor(total * 0.58);
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

const LABEL: Record<Topping, string> = {
  pb: "Peanut Butter",
  jam: "Strawberry Jam",
};

function WaffleBaffle() {
  const [size, setSize] = useState<number>(10);
  const [round, setRound] = useState<Round | null>(null);
  const [guess, setGuess] = useState<Topping | null>(null);
  const [score, setScore] = useState({ played: 0, correct: 0 });

  const deal = useCallback((s: number) => {
    setGuess(null);
    setRound(makeRound(s));
  }, []);

  useEffect(() => {
    deal(size);
  }, [size, deal]);

  const answer = (t: Topping) => {
    if (!round || guess) return;
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
          One waffle, two toppings, one tiny difference. Which one covers more squares?
        </p>
      </header>

      <div className="flex flex-wrap items-center justify-center gap-2 rounded-full border border-border bg-card px-2 py-2 shadow-sm">
        <span className="px-2 text-sm font-semibold text-muted-foreground">Waffle size</span>
        {SIZES.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={s === size ? "default" : "ghost"}
            className="rounded-full font-bold"
            onClick={() => setSize(s)}
          >
            {s}×{s}
          </Button>
        ))}
      </div>

      <section className="w-full max-w-xl">
        <div className="waffle-board p-2 sm:p-3">
          <div
            className="grid w-full gap-[2px] sm:gap-[3px]"
            style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
            aria-label="Waffle grid"
          >
            {(round?.cells ?? Array.from({ length: size * size }, () => null)).map((c, i) => (
              <div
                key={i}
                className={`waffle-cell aspect-square ${
                  c === "pb" ? "cell-pb" : c === "jam" ? "cell-jam" : "bg-waffle-batter"
                }`}
              />
            ))}
          </div>
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
              <span className="text-xs font-semibold opacity-70">the tan squares</span>
            </Button>
            <Button
              size="lg"
              className="h-auto flex-col gap-1 rounded-2xl bg-jam py-5 text-lg font-extrabold text-primary-foreground hover:bg-jam/85"
              onClick={() => answer("jam")}
            >
              Strawberry Jam
              <span className="text-xs font-semibold opacity-80">the red squares</span>
            </Button>
          </div>
        ) : (
          round && (
            <div className="w-full rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
              <h2 className="text-2xl font-extrabold text-foreground">
                {isCorrect ? "Deliciously right!" : "Baffled!"}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                You picked {LABEL[guess]}. {LABEL[round.winner]} covered more of the waffle.
              </p>
              <div className="mt-4 flex justify-center gap-6 text-sm font-bold">
                <span className="text-waffle-crust">Peanut Butter · {round.pb}</span>
                <span className="text-jam">Strawberry Jam · {round.jam}</span>
              </div>
              <Button className="mt-5 rounded-full px-8 font-bold" onClick={() => deal(size)}>
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
