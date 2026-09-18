// アートバケットの生成処理（企画書 v1.3 §3.6, §14.2）。
// art_buckets/{id} が pending で作られたら 1 回だけ画像を生成して Storage に保存し ready にする。
// 失敗は artMaxAttempts 回まで再試行（トリガーの再実行 or retryArtBucket）。コストは art_stats/summary に累積。
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { Element, Family } from "../generate/classify";
import { loadConfig } from "../shared/config";
import type { ImageGenerator } from "./generator";
import { buildArtPrompt, bucketToHex, paletteFromHex } from "./prompt";

export interface ArtDeps {
  db: Firestore;
  generator: ImageGenerator;
  /** PNG を保存してパスを返す */
  saveImage: (path: string, png: Buffer) => Promise<string>;
  now?: () => Date;
}

export type ArtOutcome = "generated" | "already_ready" | "in_progress" | "failed" | "not_found";

export interface ArtResult {
  outcome: ArtOutcome;
  bucketId: string;
  imagePath?: string;
  costUsd?: number;
  attempts?: number;
  error?: string;
}

export const STATS_DOC = "art_stats/summary";

/**
 * 1 バケットを処理する。同時実行は「pending → generating」の遷移をトランザクションで取ることで排他する。
 */
export async function processArtBucket(deps: ArtDeps, bucketId: string): Promise<ArtResult> {
  const { constants: C } = loadConfig();
  const now = deps.now ?? (() => new Date());
  const ref = deps.db.collection("art_buckets").doc(bucketId);
  const maxAttempts = C.artMaxAttempts as number;

  // ① 占有
  const claim = await deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false as const, outcome: "not_found" as const };
    const status = snap.get("status") as string;
    const attempts = (snap.get("attempts") as number | undefined) ?? 0;
    if (status === "ready") return { ok: false as const, outcome: "already_ready" as const };
    if (status === "generating") return { ok: false as const, outcome: "in_progress" as const };
    if (status === "failed" && attempts >= maxAttempts) return { ok: false as const, outcome: "failed" as const, attempts };
    tx.update(ref, { status: "generating", attempts: attempts + 1, generatingAt: now().getTime() });
    return {
      ok: true as const,
      attempts: attempts + 1,
      family: snap.get("family") as Family,
      subFamily: (snap.get("subFamily") as Family | null) ?? null,
      element: snap.get("element") as Element,
      colorBucket: snap.get("colorBucket") as string,
    };
  });
  if (!claim.ok) return { outcome: claim.outcome, bucketId, attempts: "attempts" in claim ? claim.attempts : undefined };

  // ② 生成
  const hex = bucketToHex(claim.colorBucket);
  const prompt = buildArtPrompt({
    family: claim.family,
    subFamily: claim.subFamily,
    element: claim.element,
    colors: paletteFromHex(hex),
    sourceLabel: claim.subFamily ? `${claim.family} and ${claim.subFamily}` : claim.family,
  });
  try {
    const img = await deps.generator.generate(prompt, { size: C.artImageSize as string, quality: C.artQuality as "low" | "medium" | "high" });
    const path = await deps.saveImage(`art/${bucketId}.png`, img.png);
    const batch = deps.db.batch();
    batch.update(ref, {
      status: "ready",
      imagePath: path,
      model: img.model,
      costUsd: img.costUsd,
      generatedAt: FieldValue.serverTimestamp(),
      error: FieldValue.delete(),
    });
    batch.set(
      deps.db.doc(STATS_DOC),
      { generatedCount: FieldValue.increment(1), costUsd: FieldValue.increment(img.costUsd), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    await batch.commit();
    return { outcome: "generated", bucketId, imagePath: path, costUsd: img.costUsd, attempts: claim.attempts };
  } catch (e) {
    const message = (e as Error).message.slice(0, 500);
    await ref.update({ status: "failed", error: message, failedAt: now().getTime() });
    await deps.db.doc(STATS_DOC).set({ failedCount: FieldValue.increment(1) }, { merge: true });
    return { outcome: "failed", bucketId, error: message, attempts: claim.attempts };
  }
}

/** 事前生成（§3.6）: 12 ファミリー × 7 属性 × 明度 3 = 252 バケットを pending で作る（存在するものは触らない） */
export function pregenerationBucketIds(): { id: string; family: Family; element: Element; colorBucket: string }[] {
  const { constants: C } = loadConfig();
  const families: Family[] = ["beast", "plant", "metal", "aqua", "rock", "spark", "ghost", "food", "paper", "cloth", "toy", "enigma"];
  // 属性ごとの代表色相バケット（12 分割: 0=赤 … 4=緑 … 7=青 … 9=紫）
  const hueOf: Record<Element, number> = { fire: 0, water: 7, grass: 4, thunder: 2, light: 1, dark: 9, neutral: 1 };
  const lightBuckets = (C.artColorLightnessBuckets as number) ?? 3;
  const out: { id: string; family: Family; element: Element; colorBucket: string }[] = [];
  for (const family of families) {
    for (const element of Object.keys(hueOf) as Element[]) {
      for (let l = 0; l < lightBuckets; l++) {
        const colorBucket = `h${hueOf[element]}l${l}`;
        out.push({ id: `${family}_none_${element}_${colorBucket}`, family, element, colorBucket });
      }
    }
  }
  return out;
}

export async function enqueuePregeneration(db: Firestore, limit = 300): Promise<{ created: number; existing: number }> {
  const targets = pregenerationBucketIds().slice(0, limit);
  let created = 0;
  let existing = 0;
  for (const t of targets) {
    const ref = db.collection("art_buckets").doc(t.id);
    const snap = await ref.get();
    if (snap.exists) {
      existing++;
      continue;
    }
    await ref.set({
      family: t.family,
      subFamily: null,
      element: t.element,
      colorBucket: t.colorBucket,
      imagePath: null,
      status: "pending",
      requestedAt: FieldValue.serverTimestamp(),
      hitCount: 0,
      pregenerated: true,
    });
    created++;
  }
  return { created, existing };
}

/** キャッシュ命中率など（P3 完了条件の実測用） */
export async function artStats(db: Firestore): Promise<Record<string, number>> {
  const summary = (await db.doc(STATS_DOC).get()).data() ?? {};
  const buckets = await db.collection("art_buckets").get();
  let hits = 0;
  let ready = 0;
  let pending = 0;
  let failed = 0;
  for (const d of buckets.docs) {
    hits += (d.get("hitCount") as number | undefined) ?? 0;
    const s = d.get("status") as string;
    if (s === "ready") ready++;
    else if (s === "failed") failed++;
    else pending++;
  }
  const generated = (summary.generatedCount as number | undefined) ?? 0;
  return {
    buckets: buckets.size,
    ready,
    pending,
    failed,
    generatedCount: generated,
    costUsd: (summary.costUsd as number | undefined) ?? 0,
    totalHits: hits,
    cacheHitRate: hits > 0 ? Math.max(0, hits - generated) / hits : 0,
  };
}
