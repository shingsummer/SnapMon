import { describe, expect, it } from "vitest";
import { artBucketId, artTint, classifyLabels, colorBucket, elementFromColor, hexToHsl } from "../src/generate/classify";
import { jstDateKey, msUntilJstMidnight } from "../src/shared/jst";

describe("classifyLabels", () => {
  it("maps top label to family", () => {
    const c = classifyLabels([{ name: "Mug", score: 0.95 }, { name: "Tableware", score: 0.8 }]);
    expect(c.family).toBe("aqua");
    expect(c.subFamily).toBeNull();
    expect(c.sourceLabel).toBe("mug");
    expect(c.forcedEnigma).toBe(false);
  });

  it("assigns subFamily when second matching label differs (猫のぬいぐるみ)", () => {
    const c = classifyLabels([{ name: "Stuffed toy", score: 0.9 }, { name: "Cat", score: 0.85 }, { name: "Toy", score: 0.8 }]);
    expect(c.family).toBe("beast"); // stuffed toy → beast
    expect(c.subFamily).toBe("toy");
  });

  it("does not assign subFamily for the same family", () => {
    const c = classifyLabels([{ name: "Dog", score: 0.9 }, { name: "Cat", score: 0.85 }]);
    expect(c.family).toBe("beast");
    expect(c.subFamily).toBeNull();
  });

  it("forces enigma on screen labels", () => {
    const c = classifyLabels([{ name: "Dog", score: 0.9 }, { name: "Screen", score: 0.88 }]);
    expect(c.family).toBe("enigma");
    expect(c.forcedEnigma).toBe(true);
  });

  it("enigma when low confidence", () => {
    const c = classifyLabels([{ name: "Dog", score: 0.2 }]);
    expect(c.family).toBe("enigma");
    expect(c.forcedEnigma).toBe(true);
  });

  it("enigma when nothing matches (not forced)", () => {
    const c = classifyLabels([{ name: "Zzz", score: 0.9 }, { name: "Qqq", score: 0.8 }]);
    expect(c.family).toBe("enigma");
    expect(c.forcedEnigma).toBe(false);
    expect(c.sourceLabel).toBe("zzz");
  });

  it("enigma on empty labels", () => {
    expect(classifyLabels([]).family).toBe("enigma");
  });
});

describe("hexToHsl / elementFromColor", () => {
  it("parses basic colors", () => {
    expect(hexToHsl("ff0000")).toEqual({ h: 0, s: 1, l: 0.5 });
    expect(hexToHsl("#00ff00").h).toBe(120);
    expect(hexToHsl("0000ff").h).toBe(240);
    expect(hexToHsl("808080").s).toBe(0);
  });
  it("rejects invalid hex", () => {
    expect(() => hexToHsl("12345")).toThrow();
  });
  it("maps colors to elements per §3.3", () => {
    expect(elementFromColor("e53935")).toBe("fire"); // 赤
    expect(elementFromColor("fb8c00")).toBe("fire"); // 橙
    expect(elementFromColor("fdd835")).toBe("thunder"); // 黄
    expect(elementFromColor("43a047")).toBe("grass"); // 緑
    expect(elementFromColor("1e88e5")).toBe("water"); // 青
    expect(elementFromColor("fafafa")).toBe("light"); // 白
    expect(elementFromColor("111111")).toBe("dark"); // 黒
    expect(elementFromColor("9e9e9e")).toBe("neutral"); // 灰
    expect(elementFromColor("795548")).toBe("neutral"); // 茶
    expect(elementFromColor("8e24aa")).toBe("dark"); // 紫
  });
});

describe("colorBucket / artBucketId / artTint", () => {
  it("buckets hue into 12 and lightness into 3", () => {
    expect(colorBucket("ff0000")).toBe("h0l1");
    expect(colorBucket("00ff00")).toBe("h4l1");
    expect(colorBucket("0000ff")).toBe("h8l1");
    expect(colorBucket("ffffff")).toBe("h0l2");
    expect(colorBucket("000000")).toBe("h0l0");
  });
  it("builds a stable bucket id", () => {
    expect(artBucketId("aqua", null, "water", "1e88e5")).toBe("aqua_none_water_h6l1");
    expect(artBucketId("beast", "toy", "fire", "e53935")).toBe("beast_toy_fire_h0l1");
  });
  it("tint is small and clamped", () => {
    const t = artTint([{ hex: "ff0000", score: 0.6 }, { hex: "00ff00", score: 0.3 }]);
    expect(Math.abs(t.hueShift)).toBeLessThanOrEqual(8);
    expect(Math.abs(t.satShift)).toBeLessThanOrEqual(0.1);
    expect(artTint([{ hex: "ff0000", score: 1 }])).toEqual({ hueShift: 0, satShift: 0 });
  });
});

describe("jst", () => {
  it("date key resets at JST midnight", () => {
    // 2026-09-18T14:59:59Z = 09-18 23:59:59 JST
    expect(jstDateKey(new Date("2026-09-18T14:59:59Z"))).toBe("20260918");
    // 2026-09-18T15:00:00Z = 09-19 00:00:00 JST
    expect(jstDateKey(new Date("2026-09-18T15:00:00Z"))).toBe("20260919");
  });
  it("ms until midnight", () => {
    expect(msUntilJstMidnight(new Date("2026-09-18T14:59:59Z"))).toBe(1000);
    expect(msUntilJstMidnight(new Date("2026-09-18T15:00:00Z"))).toBe(24 * 60 * 60 * 1000);
  });
});
