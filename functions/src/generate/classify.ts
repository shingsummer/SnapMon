// 画像認識結果 → ファミリー／サブファミリー／属性／色バケット（企画書 v1.3 §3.2, §3.3, §3.5, §3.6）。
// 純ロジック。Vision API や Firestore に依存しない。
import * as fs from "node:fs";
import * as path from "node:path";
import { configDir, loadConfig } from "../shared/config";

export type Family =
  | "beast" | "plant" | "metal" | "aqua" | "rock" | "spark"
  | "ghost" | "food" | "paper" | "cloth" | "toy" | "enigma";

export type Element = "fire" | "water" | "grass" | "thunder" | "light" | "dark" | "neutral";

export interface VisionLabel {
  name: string; // 英語ラベル（大文字小文字は問わない）
  score: number; // 0..1
}

export interface VisionColor {
  hex: string; // "rrggbb"
  score: number; // 0..1（面積比）
}

interface LabelMap {
  families: Family[];
  forceEnigmaLabels: string[];
  minConfidence: number;
  labels: Record<string, Family>;
}

let labelMapCache: LabelMap | null = null;
export function loadLabelMap(): LabelMap {
  if (!labelMapCache) {
    labelMapCache = JSON.parse(fs.readFileSync(path.join(configDir(), "label_map.json"), "utf-8")) as LabelMap;
  }
  return labelMapCache;
}

export interface Classification {
  family: Family;
  subFamily: Family | null;
  sourceLabel: string; // シードに使う代表ラベル
  forcedEnigma: boolean;
}

/**
 * ラベル上位5件からファミリーを決める。
 * - screen/monitor 系が上位にあれば enigma に強制（§3.5）
 * - 最上位ラベルの信頼度が minConfidence 未満なら enigma
 * - 辞書に当たる最初のラベルが family、それと別 family に当たる次のラベルが subFamily
 * - どのラベルも辞書に無ければ enigma
 */
export function classifyLabels(labels: VisionLabel[]): Classification {
  const map = loadLabelMap();
  const top = labels.slice(0, 5).map((l) => ({ name: l.name.trim().toLowerCase(), score: l.score }));
  const sourceLabel = top[0]?.name ?? "unknown";

  if (top.length === 0 || top[0].score < map.minConfidence) {
    return { family: "enigma", subFamily: null, sourceLabel, forcedEnigma: true };
  }
  if (top.slice(0, 3).some((l) => map.forceEnigmaLabels.includes(l.name))) {
    return { family: "enigma", subFamily: null, sourceLabel, forcedEnigma: true };
  }

  let family: Family | null = null;
  let subFamily: Family | null = null;
  let matchedLabel = sourceLabel;
  for (const l of top) {
    const f = map.labels[l.name];
    if (!f) continue;
    if (family === null) {
      family = f;
      matchedLabel = l.name;
    } else if (f !== family && subFamily === null) {
      subFamily = f;
      break;
    }
  }
  if (family === null) {
    return { family: "enigma", subFamily: null, sourceLabel, forcedEnigma: false };
  }
  return { family, subFamily, sourceLabel: matchedLabel, forcedEnigma: false };
}

export interface Hsl {
  h: number; // 0..360
  s: number; // 0..1
  l: number; // 0..1
}

export function hexToHsl(hex: string): Hsl {
  const clean = hex.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) throw new Error(`invalid hex color: ${hex}`);
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  return { h, s, l };
}

/**
 * 主要色1位 → 属性（§3.3）。
 * 火（赤・橙）、水（青）、草（緑）、雷（黄）、光（白・淡色）、闇（黒・濃色）、無（灰・茶・複合）
 */
export function elementFromColor(hex: string): Element {
  const { h, s, l } = hexToHsl(hex);
  if (l >= 0.85) return "light";
  if (l <= 0.15) return "dark";
  if (s < 0.2) return "neutral"; // 灰
  // 茶: 橙〜黄の色相で暗め・くすみ
  if (h >= 15 && h < 50 && l < 0.4) return "neutral";
  if (h < 15 || h >= 345) return "fire"; // 赤
  if (h < 45) return "fire"; // 橙
  if (h < 70) return "thunder"; // 黄
  if (h < 170) return "grass"; // 緑
  if (h < 260) return "water"; // 青
  if (h < 345) return "dark"; // 紫〜マゼンタは闇寄り
  return "fire";
}

/** アートのキャッシュ用色バケット（§3.6）: 色相12段階 × 明度3段階 → "h{0..11}l{0..2}" */
export function colorBucket(hex: string): string {
  const { constants: C } = loadConfig();
  const hueBuckets = (C.artColorHueBuckets as number) ?? 12;
  const lightBuckets = (C.artColorLightnessBuckets as number) ?? 3;
  const { h, l } = hexToHsl(hex);
  const hi = Math.min(hueBuckets - 1, Math.floor((h / 360) * hueBuckets));
  const li = Math.min(lightBuckets - 1, Math.floor(l * lightBuckets));
  return `h${hi}l${li}`;
}

export function artBucketId(family: Family, subFamily: Family | null, element: Element, hex: string): string {
  return [family, subFamily ?? "none", element, colorBucket(hex)].join("_");
}

/** 主要色2位・3位から端末側で適用する微小な色相・彩度シフト（§3.6）。 */
export function artTint(colors: VisionColor[]): { hueShift: number; satShift: number } {
  const { constants: C } = loadConfig();
  const maxHue = (C.artTintHueShiftMaxDeg as number) ?? 8;
  const maxSat = (C.artTintSatShiftMax as number) ?? 0.1;
  if (colors.length < 2) return { hueShift: 0, satShift: 0 };
  const a = hexToHsl(colors[0].hex);
  const b = hexToHsl(colors[1].hex);
  let dh = b.h - a.h;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  const hueShift = Math.max(-maxHue, Math.min(maxHue, Math.round(dh / 10)));
  const satShift = Math.max(-maxSat, Math.min(maxSat, Math.round((b.s - a.s) * 100) / 1000));
  return { hueShift, satShift };
}
