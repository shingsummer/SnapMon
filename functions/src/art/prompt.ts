// 画像生成プロンプト（企画書 v1.3 §16.3）。バケット単位の共有アート用。
import type { Element, Family } from "../generate/classify";
import { loadConfig } from "../shared/config";

export const FAMILY_DESCRIPTION: Record<Family, string> = {
  beast: "a furry beast-like creature, agile and playful, with ears and a tail",
  plant: "a plant-like creature with leaves, buds or petals growing from its body",
  metal: "a sturdy metallic creature with smooth plates, rivets and a compact build",
  aqua: "a round water-drop-like creature, glossy and translucent",
  rock: "a chunky stone creature with mossy edges and a heavy stance",
  spark: "a quick electric creature with antennae and small glowing parts",
  ghost: "a wispy floating creature with a faded hem and mysterious eyes",
  food: "a soft, plump creature that looks like a sweet snack or bread",
  paper: "a flat, folded creature made of paper with creases and torn edges",
  cloth: "a stitched fabric creature with patches, buttons and loose threads",
  toy: "a chunky toy-like creature with rounded joints and bright parts",
  enigma: "a strange creature of ambiguous shape with a question-mark-like silhouette",
};

export const ELEMENT_DESCRIPTION: Record<Element, string> = {
  fire: "fire, warm red and orange accents, small flames",
  water: "water, cool blue tones, droplets",
  grass: "grass, fresh green tones, leaves",
  thunder: "thunder, bright yellow tones, tiny sparks",
  light: "light, pale and white tones, soft glow",
  dark: "darkness, deep purple and black tones, subtle shadows",
  neutral: "neutral, earthy gray and brown tones",
};

export interface PromptInput {
  family: Family;
  subFamily: Family | null;
  element: Element;
  colors: [string, string, string]; // hex
  sourceLabel: string; // バケット用はファミリー名、専用アートでは出自ラベル
}

export function buildArtPrompt(input: PromptInput): string {
  const familyLine = input.subFamily
    ? `Family: ${input.family} (${FAMILY_DESCRIPTION[input.family]}), with traits of ${input.subFamily} (${FAMILY_DESCRIPTION[input.subFamily]}).`
    : `Family: ${input.family} (${FAMILY_DESCRIPTION[input.family]}).`;
  return [
    "A single original fantasy creature for a mobile monster-raising game.",
    familyLine,
    `Element: ${input.element} (${ELEMENT_DESCRIPTION[input.element]}).`,
    `Inspired by the shape and texture of: ${input.sourceLabel}.`,
    `Primary colors: #${input.colors[0]}, #${input.colors[1]}, #${input.colors[2]}.`,
    "Style: clean cel-shaded illustration, soft outline, full body, centered, facing slightly left, plain white background, no text, no watermark.",
    // 否定文（Do not depict ...）は画像 API の安全フィルタに弾かれやすいので肯定表現にする（§16.3 の意図は同じ）
    "The creature is an original, cute, non-human mascot design created for this game, an animal-like fantasy being with simple friendly eyes.",
  ].join("\n");
}

/** colorBucket "h{0..11}l{0..2}" → 代表色 hex（バケット共有アートの色指定用） */
export function bucketToHex(colorBucket: string): string {
  const { constants: C } = loadConfig();
  const m = /^h(\d+)l(\d+)$/.exec(colorBucket);
  if (!m) return "808080";
  const hueBuckets = (C.artColorHueBuckets as number) ?? 12;
  const lightBuckets = (C.artColorLightnessBuckets as number) ?? 3;
  const h = ((Number(m[1]) + 0.5) / hueBuckets) * 360;
  const l = (Number(m[2]) + 0.5) / lightBuckets;
  return hslToHex(h, 0.6, l);
}

export function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `${to(r)}${to(g)}${to(b)}`;
}

/** 代表色から 2 色目・3 色目（明暗）を作る */
export function paletteFromHex(hex: string): [string, string, string] {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const mix = (v: number, t: number, k: number) => Math.round(v + (t - v) * k).toString(16).padStart(2, "0");
  const lighter = `${mix(r, 255, 0.5)}${mix(g, 255, 0.5)}${mix(b, 255, 0.5)}`;
  const darker = `${mix(r, 0, 0.4)}${mix(g, 0, 0.4)}${mix(b, 0, 0.4)}`;
  return [hex, lighter, darker];
}
