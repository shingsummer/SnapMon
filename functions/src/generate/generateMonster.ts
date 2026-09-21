// 写真→モンスター生成パイプラインの本体（企画書 v1.3 §3.1, §3.5, §7.1, §7.2, §10, §11）。
// Firestore / Vision / ハッシュ / 時刻 / nonce はすべて注入し、エミュレータとテストで差し替える。
import { randomBytes } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { fillStats, STATS, type StatsInt, loadConfig } from "../shared/config";
import { rollIndividual } from "../shared/growth";
import { jstDateKey } from "../shared/jst";
import { XorShift128, seedFromParts } from "../shared/rng";
import { artBucketId, artTint, classifyLabels, elementFromColor, type Element, type Family } from "./classify";
import { pickInitialMoves, rollBirthItems, type ItemGrant } from "./loadout";
import type { VisionClient } from "./vision";
import { freeSnapAllowance } from "../shop/shop";

export class GenerateError extends Error {
  constructor(
    public readonly code:
      | "face_detected"
      | "duplicate_photo"
      | "daily_limit"
      | "no_ticket"
      | "rate_limited"
      | "vision_failed",
    message: string,
  ) {
    super(message);
  }
}

export interface GenerateDeps {
  db: Firestore;
  vision: VisionClient;
  /** 画像の知覚ハッシュ（16 進 16 桁 = 64bit） */
  phash: (image: Buffer) => Promise<string>;
  now?: () => Date;
  nonce?: () => string;
  /** 出自写真の保存。失敗しても誕生は成立させる */
  saveSource?: (uid: string, monsterId: string, image: Buffer) => Promise<string>;
  /** エミュレータ専用: 1 日の枚数とレート制限を無視する（バトルの動作確認で 4 体以上要るため） */
  skipLimits?: boolean;
}

export interface GenerateResult {
  monsterId: string;
  family: Family;
  subFamily: Family | null;
  element: Element;
  sourceLabel: string;
  base: StatsInt;
  moves: string[];
  inheritedMove: { moveId: string; generation: number } | null;
  artBucketId: string;
  artTint: { hueShift: number; satShift: number };
  artReady: boolean;
  artStatus: string; // awaiting_source | pending | fallback
  items: ItemGrant[];
  snapsUsed: number;
  /** 今日の無料枠（プレミアムなら +1） */
  snapsPerDay: number;
  /** 1 日の合計上限（無料枠＋チケット） */
  snapsMaxPerDay: number;
  /** この誕生で撮影チケットを 1 枚使ったか */
  ticketUsed: boolean;
  ticketsLeft: number;
  mentorId: string | null;
}

const RATE_LIMIT_MS = 60_000; // §11: generateMonster は 1分1回
const RECENT_PHASH_KEEP = 200;

export function hammingSimilarity(aHex: string, bHex: string): number {
  if (aHex.length !== bHex.length) return 0;
  let dist = 0;
  for (let i = 0; i < aHex.length; i++) {
    let x = parseInt(aHex[i], 16) ^ parseInt(bHex[i], 16);
    while (x) {
      dist += x & 1;
      x >>= 1;
    }
  }
  return 1 - dist / (aHex.length * 4);
}

export async function generateMonsterCore(deps: GenerateDeps, uid: string, image: Buffer): Promise<GenerateResult> {
  const { constants: C } = loadConfig();
  const now = deps.now ?? (() => new Date());
  const nonce = deps.nonce ?? (() => randomBytes(8).toString("hex"));
  const db = deps.db;

  // ① 認識（枠は消費しない段階）
  let vision;
  try {
    vision = await deps.vision.annotate(image);
  } catch (e) {
    throw new GenerateError("vision_failed", (e as Error).message);
  }
  if (vision.faceCount > 0 && (C.faceDetectReject as boolean)) {
    throw new GenerateError("face_detected", "人物の顔が写っています。撮り直してください");
  }

  // ② 分類
  const cls = classifyLabels(vision.labels);
  const colors = vision.colors.length > 0 ? vision.colors : [{ hex: "808080", score: 1 }];
  const dominantHex = colors[0].hex;
  const element: Element = cls.family === "enigma" && cls.forcedEnigma ? elementFromColor(dominantHex) : elementFromColor(dominantHex);
  const phash = await deps.phash(image);

  const userRef = db.collection("users").doc(uid);
  const monsterRef = db.collection("monsters").doc();
  const privateRef = db.collection("monsters_private").doc(monsterRef.id);
  const today = jstDateKey(now());
  const nowMs = now().getTime();

  const result = await db.runTransaction(async (tx: Transaction) => {
    const userSnap = await tx.get(userRef);
    const user = userSnap.exists ? (userSnap.data() as Record<string, unknown>) : {};
    const daily = (user.dailyState as Record<string, unknown> | undefined) ?? {};
    const sameDay = daily.date === today;
    const snapsUsed = sameDay ? ((daily.snapsUsed as number) ?? 0) : 0;
    // 無料枠（プレミアムなら +1）。無料枠を超えたら撮影チケットを 1 枚消費。1 日の合計は snapsMaxPerDay まで（§7.1、P6 改訂）
    const snapsPerDay = freeSnapAllowance(user, now());
    const snapsMaxPerDay = C.snapsMaxPerDay as number;
    const ticketRef = userRef.collection("inventory").doc("snap_ticket");
    const ticketSnap = await tx.get(ticketRef);
    const tickets = ticketSnap.exists ? ((ticketSnap.get("count") as number | undefined) ?? 0) : 0;
    let useTicket = false;

    // ③ 使い回し（同一ユーザーの過去写真と 90% 以上一致）: 枠は消費しない
    const recent = (user.recentPhashes as string[] | undefined) ?? [];
    const threshold = C.phashRejectSimilarity as number;
    if (recent.some((h) => hammingSimilarity(h, phash) >= threshold)) {
      throw new GenerateError("duplicate_photo", "同じ写真は使えません。別のものを撮ってください");
    }

    // ④ レート制限と日次上限
    const lastSnapAt = (user.lastSnapAt as number | undefined) ?? 0;
    if (!deps.skipLimits && nowMs - lastSnapAt < RATE_LIMIT_MS) {
      throw new GenerateError("rate_limited", "少し待ってからもう一度撮ってください");
    }
    if (!deps.skipLimits && snapsUsed >= snapsPerDay) {
      if (snapsUsed >= snapsMaxPerDay) throw new GenerateError("daily_limit", `今日はもう ${snapsMaxPerDay} 枚撮りました。明日また撮ろう`);
      if (tickets <= 0) throw new GenerateError("no_ticket", "今日の無料枠は使いました。撮影チケットがあればもう 1 枚撮れます");
      useTicket = true;
    }

    // ⑤ 師匠の継承予約（§5.5）
    const pending = user.pendingDisciple as { mentorId: string; useCapsule: boolean } | undefined;
    let mentorTalent: StatsInt | null = null;
    let mentorId: string | null = null;
    let inheritedMove: { moveId: string; generation: number } | null = null;
    if (pending?.mentorId) {
      const mentorPriv = await tx.get(db.collection("monsters_private").doc(pending.mentorId));
      const mentorPub = await tx.get(db.collection("monsters").doc(pending.mentorId));
      if (mentorPriv.exists && mentorPub.exists && mentorPub.get("ownerId") === uid) {
        mentorTalent = fillStats(mentorPriv.get("talent") as Record<string, unknown>) as StatsInt;
        mentorId = pending.mentorId;
        const moveId = mentorPub.get("mentorMoveId") as string | undefined;
        if (moveId) {
          const prev = mentorPub.get("inheritedMove") as { moveId: string; generation: number } | undefined;
          const generation = prev && prev.moveId === moveId ? prev.generation + 1 : 1;
          inheritedMove = { moveId, generation };
        }
      }
    }

    // ⑥ 乱数と個体
    const seed = seedFromParts(cls.sourceLabel, dominantHex, uid, today, nonce());
    const rng = new XorShift128(seed);
    const ind = rollIndividual(rng, mentorTalent, pending?.useCapsule ?? false, cls.family);
    const moves = pickInitialMoves(rng, cls.family, cls.subFamily, element);
    const items = rollBirthItems(rng, cls.family);
    const bucket = artBucketId(cls.family, cls.subFamily, element, dominantHex);
    const tint = artTint(colors);

    const bucketRef = db.collection("art_buckets").doc(bucket);
    const bucketSnap = await tx.get(bucketRef);
    const artReady = bucketSnap.exists && bucketSnap.get("status") === "ready";

    const stats: Record<string, number> = {};
    for (const s of STATS) stats[s] = ind.base[s];

    // ⑦ 書き込み
    tx.set(monsterRef, {
      ownerId: uid,
      createdAt: FieldValue.serverTimestamp(),
      name: "",
      family: cls.family,
      subFamily: cls.subFamily,
      element,
      sourceLabel: cls.sourceLabel,
      sourceColors: colors.slice(0, 3).map((c) => c.hex),
      sourceImagePath: null,
      artBucketId: bucket,
      artTint: tint,
      customArtPath: null,
      // 個体アート（写真参照）: 写真の保存が終わったら pending → トリガーが生成
      artStatus: (C.artIndividualEnabled as boolean) && deps.saveSource ? "awaiting_source" : "fallback",
      artImagePath: null,
      artAttempts: 0,
      level: 1,
      exp: 0,
      base: ind.base,
      personality: ind.personality,
      personalityRevealed: false,
      stats,
      statHistory: [{ level: 1, stats }],
      trainingBonus: Object.fromEntries(STATS.map((s) => [s, 0])),
      fatigue: 0,
      status: "active",
      isMentor: false,
      mentorId,
      discipleId: null,
      mentorUsed: false,
      mentorMoveId: null,
      inheritedMove,
      moves,
      lastMurmurTextId: null,
    });
    tx.set(privateRef, {
      ownerId: uid,
      talent: ind.talent,
      growth: ind.growth,
      murmurRate: ind.murmurRate,
      murmurWindowOffset: ind.murmurWindowOffset,
      phash,
      seed,
    });
    if (!bucketSnap.exists) {
      tx.set(bucketRef, {
        family: cls.family,
        subFamily: cls.subFamily,
        element,
        colorBucket: bucket.split("_").pop(),
        imagePath: null,
        status: "pending", // P3: 画像生成ジョブが ready にする
        requestedAt: FieldValue.serverTimestamp(),
        hitCount: 1,
      });
    } else {
      tx.update(bucketRef, { hitCount: FieldValue.increment(1) });
    }
    for (const it of items) {
      tx.set(userRef.collection("inventory").doc(it.type), { type: it.type, count: FieldValue.increment(it.count) }, { merge: true });
    }
    const nextRecent = [...recent, phash].slice(-RECENT_PHASH_KEEP);
    if (useTicket) tx.set(ticketRef, { type: "snap_ticket", count: tickets - 1 }, { merge: true });
    const userUpdate: Record<string, unknown> = {
      dailyState: { ...(sameDay ? daily : {}), date: today, snapsUsed: snapsUsed + 1 },
      lastSnapAt: nowMs,
      recentPhashes: nextRecent,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!(user.partnerMonsterId as string | undefined)) userUpdate.partnerMonsterId = monsterRef.id;
    if (mentorId) {
      userUpdate.pendingDisciple = FieldValue.delete();
      tx.update(db.collection("monsters").doc(mentorId), { discipleId: monsterRef.id, mentorUsed: true });
    }
    tx.set(userRef, userUpdate, { merge: true });

    return {
      monsterId: monsterRef.id,
      family: cls.family,
      subFamily: cls.subFamily,
      element,
      sourceLabel: cls.sourceLabel,
      base: ind.base,
      moves,
      inheritedMove,
      artBucketId: bucket,
      artTint: tint,
      artReady,
      artStatus: (C.artIndividualEnabled as boolean) && deps.saveSource ? "awaiting_source" : "fallback",
      items,
      snapsUsed: snapsUsed + 1,
      snapsPerDay,
      snapsMaxPerDay,
      ticketUsed: useTicket,
      ticketsLeft: useTicket ? tickets - 1 : tickets,
      mentorId,
    } satisfies GenerateResult;
  });

  // ⑧ 出自写真の保存（本人のみ読める Storage）。失敗しても誕生は取り消さない
  if (deps.saveSource) {
    try {
      const p = await deps.saveSource(uid, result.monsterId, image);
      await monsterRef.update({ sourceImagePath: p, ...((C.artIndividualEnabled as boolean) ? { artStatus: "pending" } : {}) });
    } catch (e) {
      console.warn("saveSource failed", (e as Error).message);
      await monsterRef.update({ artStatus: "fallback" });
    }
  }
  return result;
}
