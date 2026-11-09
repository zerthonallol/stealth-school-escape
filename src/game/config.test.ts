import { describe, it, expect } from "vitest";
import { DIFFICULTIES, nextCheckDelay, noiseRadius } from "./config";

describe("difficulty rules", () => {
  it("easy checks every 60s with 10s warning", () => {
    expect(nextCheckDelay(DIFFICULTIES.easy, () => 0.7)).toBe(60);
    expect(DIFFICULTIES.easy.warn).toBe(10);
  });
  it("normal checks within 35–40s with 5s warning", () => {
    expect(nextCheckDelay(DIFFICULTIES.normal, () => 0)).toBe(35);
    expect(nextCheckDelay(DIFFICULTIES.normal, () => 1)).toBe(40);
    expect(DIFFICULTIES.normal.warn).toBe(5);
  });
  it("hardcore checks within 15–30s, 35% hide check, silent steps", () => {
    expect(nextCheckDelay(DIFFICULTIES.hardcore, () => 0)).toBe(15);
    expect(nextCheckDelay(DIFFICULTIES.hardcore, () => 1)).toBe(30);
    expect(DIFFICULTIES.hardcore.hideCheckChance).toBe(0.35);
    expect(DIFFICULTIES.hardcore.silentParentSteps).toBe(true);
  });
  it("crouching is silent, running is louder than walking", () => {
    expect(noiseRadius("crouch", 1)).toBe(0);
    expect(noiseRadius("run", 1)).toBeGreaterThan(noiseRadius("walk", 1));
  });
});
