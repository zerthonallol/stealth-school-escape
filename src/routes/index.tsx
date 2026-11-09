import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { DIFFICULTIES, type DifficultyId } from "@/game/config";
import type { Game, HudState } from "@/game/Game";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Побег пацана: Стелс школьник" },
      { name: "description", content: "3D стелс-игра от первого лица: сбеги из дома, пока родители проверяют уроки." },
      { property: "og:title", content: "Побег пацана: Стелс школьник" },
      { property: "og:description", content: "Прячься, собирай вещи и сбеги из дома незамеченным." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: App,
});

const MODE_LABEL: Record<HudState["mode"], string> = {
  patrol: "Мама ходит по дому",
  investigate: "Мама что-то услышала…",
  check: "Мама идёт проверять!",
  alarm: "ТРЕВОГА! Тебя ищут!",
};

function App() {
  const [diff, setDiff] = useState<DifficultyId | null>(null);
  const [runId, setRunId] = useState(0);
  if (!diff) return <Menu onStart={setDiff} />;
  return <GameView key={runId} diff={diff} onRestart={() => setRunId((n) => n + 1)} onMenu={() => setDiff(null)} />;
}

function Menu({ onStart }: { onStart: (d: DifficultyId) => void }) {
  return (
    <main className="notebook min-h-screen px-6 py-12">
      <div className="mx-auto max-w-4xl pl-10">
        <p className="font-display text-sm tracking-widest text-accent">ДНЕВНИК · ДВОЙКА ПО МАТЕМАТИКЕ</p>
        <h1 className="mt-3 font-display text-5xl leading-tight text-primary md:text-7xl">Побег пацана</h1>
        <p className="font-display text-2xl text-foreground">Стелс школьник</p>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Тебя заперли дома за плохие оценки. Найди ключи, телефон и кроссовки — и сбеги через входную дверь. Когда мама идёт проверять, успей сесть за стол.
        </p>
        <h2 className="mt-10 font-display text-xl text-foreground">Выбери сложность</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {(Object.keys(DIFFICULTIES) as DifficultyId[]).map((id) => (
            <button key={id} onClick={() => onStart(id)} className="sticker text-left">
              <span className="font-display text-2xl text-primary">{DIFFICULTIES[id].name}</span>
              <span className="mt-2 block text-sm text-muted-foreground">{DIFFICULTIES[id].desc}</span>
            </button>
          ))}
        </div>
        <div className="mt-10 grid gap-x-8 gap-y-1 text-sm text-foreground md:grid-cols-2">
          <p><b>WASD</b> — ходьба · <b>Shift</b> — бег (громко)</p>
          <p><b>C</b> — присесть (бесшумно) · <b>Space</b> — прыжок</p>
          <p><b>E</b> — действие / выйти · <b>F</b> — под кровать</p>
          <p><b>Esc</b> — пауза</p>
        </div>
      </div>
    </main>
  );
}

function GameView({ diff, onRestart, onMenu }: { diff: DifficultyId; onRestart: () => void; onMenu: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);

  useEffect(() => {
    let disposed = false;
    import("@/game/Game").then(({ Game }) => {
      if (disposed || !ref.current) return;
      game.current = new Game(ref.current, diff, setHud);
    });
    return () => { disposed = true; game.current?.dispose(); game.current = null; };
  }, [diff]);

  return (
    <div className="fixed inset-0 bg-background">
      <div ref={ref} className="absolute inset-0" />
      {hud && hud.pose === "hidden" && <div className="hide-vignette pointer-events-none absolute inset-0" />}
      {hud && hud.status === "playing" && (
        <div className="pointer-events-none absolute inset-0 font-body">
          <div className="crosshair" />
          <div className="hud-panel absolute left-4 top-4">
            <div className="font-display text-xs tracking-widest text-muted-foreground">ПРОВЕРКА ЧЕРЕЗ</div>
            <div className={`font-display text-3xl ${hud.warning ? "text-accent" : "text-primary"}`}>{hud.mode === "alarm" || hud.mode === "check" ? "—" : Math.ceil(hud.checkIn)}</div>
            <div className={`mt-1 text-sm ${hud.mode === "alarm" ? "text-destructive font-bold" : "text-foreground"}`}>{MODE_LABEL[hud.mode]}</div>
            {hud.parentNear && <div className="mt-1 text-xs text-muted-foreground">👣 шаги рядом</div>}
          </div>
          <div className="hud-panel absolute right-4 top-4 w-48">
            <div className="font-display text-xs tracking-widest text-muted-foreground">ШУМ</div>
            <div className="noise-track mt-1"><div className="noise-fill" style={{ width: `${hud.noise * 100}%` }} /></div>
            <div className="mt-3 font-display text-xs tracking-widest text-muted-foreground">ВЕЩИ {hud.items.length}/{hud.itemsTotal}</div>
            <div className="text-sm text-foreground">{hud.items.join(", ") || "пока ничего"}</div>
          </div>
          {hud.mode === "alarm" && <div className="alarm-frame absolute inset-0" />}
          {hud.prompt && <div className="hud-panel absolute bottom-24 left-1/2 -translate-x-1/2 text-foreground">{hud.prompt}</div>}
          {hud.message && <div className="speech absolute left-1/2 top-24 -translate-x-1/2">{hud.message}</div>}
        </div>
      )}
      {hud && hud.status === "playing" && !hud.locked && (
        <button onClick={() => game.current?.lock()} className="overlay absolute inset-0 flex flex-col items-center justify-center gap-3">
          <span className="font-display text-4xl text-primary">Пауза</span>
          <span className="text-foreground">Нажми, чтобы играть</span>
          <span onClick={(e) => { e.stopPropagation(); onMenu(); }} className="mt-4 text-sm text-muted-foreground underline">в меню</span>
        </button>
      )}
      {hud && hud.status !== "playing" && (
        <div className="overlay absolute inset-0 flex flex-col items-center justify-center gap-4 text-center">
          <span className={`font-display text-5xl ${hud.status === "won" ? "text-primary" : "text-destructive"}`}>{hud.status === "won" ? "СВОБОДА!" : "ПОПАЛСЯ"}</span>
          <span className="text-lg text-foreground">{hud.endReason}</span>
          <div className="flex gap-3">
            <button onClick={onRestart} className="sticker">Ещё раз</button>
            <button onClick={onMenu} className="sticker">Меню</button>
          </div>
        </div>
      )}
    </div>
  );
}
