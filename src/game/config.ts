// Pure game rules: no React, no three.js.
export type DifficultyId = "easy" | "normal" | "hardcore";

export interface Difficulty {
  id: DifficultyId;
  name: string;
  desc: string;
  checkMin: number; // seconds between room checks
  checkMax: number;
  warn: number; // seconds of warning before a check
  visionRange: number; // metres
  visionFovDeg: number; // half-angle
  hearingMul: number;
  silentParentSteps: boolean;
  hideCheckChance: number; // chance parent looks into wardrobe / under bed
}

export const DIFFICULTIES: Record<DifficultyId, Difficulty> = {
  easy: {
    id: "easy",
    name: "Лёгкий",
    desc: "Проверка каждые 60 сек, предупреждение за 10 сек, родители плохо видят.",
    checkMin: 60,
    checkMax: 60,
    warn: 10,
    visionRange: 7,
    visionFovDeg: 45,
    hearingMul: 0.6,
    silentParentSteps: false,
    hideCheckChance: 0,
  },
  normal: {
    id: "normal",
    name: "Нормальный",
    desc: "Проверка каждые 35–40 сек, предупреждение за 5 сек.",
    checkMin: 35,
    checkMax: 40,
    warn: 5,
    visionRange: 11,
    visionFovDeg: 60,
    hearingMul: 1,
    silentParentSteps: false,
    hideCheckChance: 0,
  },
  hardcore: {
    id: "hardcore",
    name: "Хардкор",
    desc: "Случайные проверки каждые 15–30 сек, бесшумные шаги, 35% — заглянут в шкаф или под кровать.",
    checkMin: 15,
    checkMax: 30,
    warn: 3,
    visionRange: 14,
    visionFovDeg: 70,
    hearingMul: 1.3,
    silentParentSteps: true,
    hideCheckChance: 0.35,
  },
};

export function nextCheckDelay(d: Difficulty, rand: () => number = Math.random): number {
  return d.checkMin + (d.checkMax - d.checkMin) * rand();
}

export type Movement = "idle" | "crouch" | "walk" | "run";

/** Radius (m) at which a parent hears the player. Crouching is silent. */
export function noiseRadius(m: Movement, hearingMul: number): number {
  const base = { idle: 0, crouch: 0, walk: 4, run: 11 }[m];
  return base * hearingMul;
}
