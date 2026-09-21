// 個体アート: 撮った写真を参照して、その個体だけの絵を生成する（しぴさんの方針: 「撮ったものがモンスターになる」）。
// 共有バケット（artBucket.ts）は、写真が無い／生成に失敗したときの保険として残す。
//
// monsters.artStatus の遷移:
//   awaiting_source（誕生直後、写真の保存待ち）→ pending（写真保存済み）→ generating → ready
//                                                                         └→ failed（artIndividualMaxAttempts まで再試行）→ fallback（バケット絵を使う）
//   fallback（写真の保存に失敗）
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { Element, Family } from "../generate/classify";
import { loadConfig } from "../shared/config";
import { STATS_DOC } from "./artBucket";
import type { ArtQuality, ImageGenerator } from "./generator";
import { ELEMENT_DESCRIPTION, FAMILY_DESCRIPTION } from "./prompt";

export interface IndividualDeps {
  db: Firestore;
  generator: ImageGenerator;
  loadImage: (path: string) => Promise<Buffer>;
  saveImage: (path: string, png: Buffer) => Promise<string>;
  now?: () => Date;
}

export type IndividualOutcome = "generated" | "already_ready" | "in_progress" | "no_source" | "failed" | "fallback" | "not_found" | "disabled";

export interface IndividualResult {
  outcome: IndividualOutcome;
  monsterId: string;
  imagePath?: string;
  costUsd?: number;
  attempts?: number;
  error?: string;
}

export interface IndividualPromptInput {
  family: Family;
  subFamily: Family | null;
  element: Element;
  colors: string[];
  sourceLabel: string;
  /** 性格（0..7）。表情・ポーズに反映する（§16.3 Personality vibe）。名前は非開示のままで、絵でうっすら伝わる程度 */
  personality?: number;
}

export function personalityVibe(personality: number | undefined): string | null {
  if (personality === undefined) return null;
  const { personalities } = loadConfig();
  const p = personalities[personality] as { artVibe?: string } | undefined;
  return p?.artVibe ?? null;
}

/** 写真参照用プロンプト。否定文は使わない（安全フィルタ対策） */
export function buildIndividualPrompt(input: IndividualPromptInput): string {
  const familyLine = input.subFamily
    ? `${FAMILY_DESCRIPTION[input.family]}, with traits of ${input.subFamily} (${FAMILY_DESCRIPTION[input.subFamily]})`
    : FAMILY_DESCRIPTION[input.family];
  const colors = input.colors.slice(0, 3).map((c) => `#${c}`).join(", ");
  const vibe = personalityVibe(input.personality);
  return [
    "Transform the object in the reference photo into a single original fantasy creature for a mobile monster-raising game.",
    `Keep the object's silhouette, colors, texture and distinctive parts recognizable in the creature's design (the object is: ${input.sourceLabel}).`,
    `The creature is ${familyLine}.`,
    `Element: ${input.element} (${ELEMENT_DESCRIPTION[input.element]}).`,
    `Primary colors: ${colors}.`,
    "Style: clean cel-shaded illustration, soft outline, full body, centered, facing slightly left, isolated on a fully transparent background with no backdrop, no ground, no shadow, no text, no watermark.",
    ...(vibe ? [`Expression and pose: ${vibe}.`] : []),
    "The creature is a cute, non-human mascot design created for this game, an animal-like fantasy being with simple expressive eyes.",
  ].join("\n");
}

export async function processMonsterArt(deps: IndividualDeps, monsterId: string, qualityOverride?: ArtQuality): Promise<IndividualResult> {
  const { constants: C } = loadConfig();
  if (!(C.artIndividualEnabled as boolean)) return { outcome: "disabled", monsterId };
  const now = deps.now ?? (() => new Date());
  const ref = deps.db.collection("monsters").doc(monsterId);
  const maxAttempts = C.artIndividualMaxAttempts as number;

  const claim = await deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false as const, outcome: "not_found" as const };
    const status = (snap.get("artStatus") as string | undefined) ?? "fallback";
    const attempts = (snap.get("artAttempts") as number | undefined) ?? 0;
    const source = snap.get("sourceImagePath") as string | null | undefined;
    if (status === "ready") return { ok: false as const, outcome: "already_ready" as const };
    if (status === "generating") return { ok: false as const, outcome: "in_progress" as const };
    if (!source) return { ok: false as const, outcome: "no_source" as const };
    if (status === "failed" && attempts >= maxAttempts) {
      tx.update(ref, { artStatus: "fallback" });
      return { ok: false as const, outcome: "fallback" as const, attempts };
    }
    tx.update(ref, { artStatus: "generating", artAttempts: attempts + 1, artGeneratingAt: now().getTime() });
    return {
      ok: true as const,
      attempts: attempts + 1,
      source,
      family: snap.get("family") as Family,
      subFamily: (snap.get("subFamily") as Family | null) ?? null,
      element: snap.get("element") as Element,
      colors: (snap.get("sourceColors") as string[] | undefined) ?? ["808080"],
      sourceLabel: (snap.get("sourceLabel") as string | undefined) ?? "object",
      personality: snap.get("personality") as number | undefined,
    };
  });
  if (!claim.ok) return { outcome: claim.outcome, monsterId, attempts: "attempts" in claim ? claim.attempts : undefined };

  const prompt = buildIndividualPrompt(claim);
  const quality = qualityOverride ?? (C.artIndividualQuality as ArtQuality);
  try {
    const image = await deps.loadImage(claim.source);
    const img = await deps.generator.generateFromImage(prompt, image, {
      size: C.artImageSize as string,
      quality,
      inputFidelity: C.artIndividualInputFidelity as "low" | "high",
    });
    const path = await deps.saveImage(`art/monsters/${monsterId}.png`, img.png);
    const batch = deps.db.batch();
    batch.update(ref, {
      artStatus: "ready",
      artImagePath: path,
      artModel: img.model,
      artQuality: quality,
      artCostUsd: img.costUsd,
      artGeneratedAt: FieldValue.serverTimestamp(),
      artError: FieldValue.delete(),
    });
    batch.set(
      deps.db.doc(STATS_DOC),
      { individualCount: FieldValue.increment(1), individualCostUsd: FieldValue.increment(img.costUsd), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    await batch.commit();
    return { outcome: "generated", monsterId, imagePath: path, costUsd: img.costUsd, attempts: claim.attempts };
  } catch (e) {
    const message = (e as Error).message.slice(0, 500);
    const final = claim.attempts >= maxAttempts;
    await ref.update({ artStatus: final ? "fallback" : "failed", artError: message, artFailedAt: now().getTime() });
    await deps.db.doc(STATS_DOC).set({ individualFailedCount: FieldValue.increment(1) }, { merge: true });
    return { outcome: final ? "fallback" : "failed", monsterId, error: message, attempts: claim.attempts };
  }
}

/** 絵柄比較用サンプル（管理者）: 同じ写真から品質違いで生成し art_samples/{monsterId} に記録する */
export async function generateArtSamples(deps: IndividualDeps, monsterId: string, qualities: ArtQuality[]): Promise<Record<string, { path: string; costUsd: number }>> {
  const { constants: C } = loadConfig();
  const snap = await deps.db.collection("monsters").doc(monsterId).get();
  if (!snap.exists) throw new Error("monster not found");
  const source = snap.get("sourceImagePath") as string | null | undefined;
  if (!source) throw new Error("この個体には出自写真がありません");
  const prompt = buildIndividualPrompt({
    family: snap.get("family") as Family,
    subFamily: (snap.get("subFamily") as Family | null) ?? null,
    element: snap.get("element") as Element,
    colors: (snap.get("sourceColors") as string[] | undefined) ?? ["808080"],
    sourceLabel: (snap.get("sourceLabel") as string | undefined) ?? "object",
    personality: snap.get("personality") as number | undefined,
  });
  const image = await deps.loadImage(source);
  const out: Record<string, { path: string; costUsd: number }> = {};
  for (const q of qualities) {
    const img = await deps.generator.generateFromImage(prompt, image, {
      size: C.artImageSize as string,
      quality: q,
      inputFidelity: C.artIndividualInputFidelity as "low" | "high",
    });
    const path = await deps.saveImage(`art/samples/${monsterId}_${q}.png`, img.png);
    out[q] = { path, costUsd: img.costUsd };
  }
  await deps.db.collection("art_samples").doc(monsterId).set(
    { monsterId, sourceLabel: snap.get("sourceLabel") ?? null, samples: out, createdAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  await deps.db.doc(STATS_DOC).set(
    { sampleCostUsd: FieldValue.increment(Object.values(out).reduce((a, s) => a + s.costUsd, 0)) },
    { merge: true },
  );
  return out;
}
