import { describe, expect, it } from "vitest";
import { FakeImageGenerator } from "../src/art/generator";
import { buildArtPrompt, bucketToHex, hslToHex, paletteFromHex } from "../src/art/prompt";
import { pregenerationBucketIds } from "../src/art/artBucket";
import { buildIndividualPrompt } from "../src/art/individual";
import { Jimp } from "jimp";
import { hexToHsl } from "../src/generate/classify";

describe("art prompt", () => {
  it("follows the §16.3 template with positive phrasing", () => {
    const p = buildArtPrompt({ family: "aqua", subFamily: null, element: "water", colors: ["1e88e5", "8fc3f2", "124f89"], sourceLabel: "aqua" });
    expect(p).toContain("A single original fantasy creature");
    expect(p).toContain("Family: aqua (");
    expect(p).toContain("Element: water (");
    expect(p).toContain("#1e88e5");
    expect(p).toContain("plain white background");
    expect(p).toContain("non-human mascot");
    expect(p).not.toMatch(/Do not/); // 否定文は安全フィルタに弾かれるため使わない
  });
  it("mentions the sub family when present", () => {
    const p = buildArtPrompt({ family: "beast", subFamily: "toy", element: "fire", colors: ["e53935", "f29c9a", "891f1f"], sourceLabel: "beast and toy" });
    expect(p).toContain("with traits of toy");
  });
});

describe("bucket colors", () => {
  it("bucketToHex maps hue/lightness buckets to a representative color", () => {
    const red = hexToHsl(bucketToHex("h0l1"));
    expect(red.h).toBeLessThan(30);
    expect(red.l).toBeCloseTo(0.5, 1);
    const blueDark = hexToHsl(bucketToHex("h7l0"));
    expect(blueDark.h).toBeGreaterThan(200);
    expect(blueDark.l).toBeLessThan(0.3);
    expect(bucketToHex("garbage")).toBe("808080");
  });
  it("hslToHex round-trips primary hues", () => {
    expect(hexToHsl(hslToHex(120, 1, 0.5)).h).toBe(120);
    expect(hexToHsl(hslToHex(240, 1, 0.5)).h).toBe(240);
  });
  it("palette has lighter and darker variants", () => {
    const [a, b, c] = paletteFromHex("1e88e5");
    expect(a).toBe("1e88e5");
    expect(hexToHsl(b).l).toBeGreaterThan(hexToHsl(a).l);
    expect(hexToHsl(c).l).toBeLessThan(hexToHsl(a).l);
  });
});

describe("pregeneration", () => {
  it("lists 12 families × 7 elements × 3 lightness = 252 unique buckets", () => {
    const ids = pregenerationBucketIds();
    expect(ids).toHaveLength(252);
    expect(new Set(ids.map((b) => b.id)).size).toBe(252);
    expect(ids[0].id).toMatch(/^beast_none_fire_h0l0$/);
  });
});

describe("FakeImageGenerator", () => {
  it("returns a PNG of the requested size at zero cost", async () => {
    const g = new FakeImageGenerator();
    const r = await g.generate("Primary colors: #1e88e5, #000000, #ffffff", { size: "64x64", quality: "low" });
    expect(r.png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(r.costUsd).toBe(0);
    expect(r.model).toBe("fake");
  });
});

describe("individual art", () => {
  it("prompt references the photo and keeps positive phrasing", () => {
    const p = buildIndividualPrompt({ family: "aqua", subFamily: null, element: "water", colors: ["1e88e5", "ffffff", "37474f"], sourceLabel: "mug" });
    expect(p).toContain("reference photo");
    expect(p).toContain("the object is: mug");
    expect(p).toContain("#1e88e5, #ffffff, #37474f");
    expect(p).not.toMatch(/Do not/);
  });
  it("FakeImageGenerator.generateFromImage tints by the photo's average color", async () => {
    const src = await new Jimp({ width: 16, height: 16, color: 0x2040ffff }).getBuffer("image/png");
    const r = await new FakeImageGenerator().generateFromImage("x", src, { size: "32x32", quality: "low" });
    const out = await Jimp.read(r.png);
    const c = out.getPixelColor(16, 16);
    expect((c >>> 8) & 0xff).toBeGreaterThan(200); // 青が強い
    expect(r.costUsd).toBe(0);
  });
});
