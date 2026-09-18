// Cloud Functions エントリポイント（企画書 §11）。
// すべての callable は認証 + App Check 必須。レスポンスは { ok, data } / エラーは HttpsError。
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { defineSecret, defineString } from "firebase-functions/params";
import { HttpsError, onCall, type CallableRequest, type FunctionsErrorCode } from "firebase-functions/v2/https";
import { z } from "zod";
import { artStats, enqueuePregeneration, processArtBucket, type ArtDeps } from "./art/artBucket";
import { FakeImageGenerator, OpenAIImageGenerator, type ImageGenerator } from "./art/generator";
import { loadConfig } from "./shared/config";
import { GenerateError, generateMonsterCore } from "./generate/generateMonster";
import { computePhash } from "./generate/phash";
import { DEFAULT_FAKE_VISION, FakeVisionClient, GoogleVisionClient, type VisionClient } from "./generate/vision";
import { MonsterActionError, restCore, setPartnerCore, useItemCore } from "./monster/partnerAndItems";
import { RenameError, renameMonsterCore } from "./monster/rename";
import { TrainError, trainCore } from "./monster/train";
import { StepsError, submitStepsCore } from "./steps/submitSteps";

initializeApp();
setGlobalOptions({ region: "asia-northeast1", maxInstances: 10 });

const IS_EMULATOR = process.env.FUNCTIONS_EMULATOR === "true";
const MAX_IMAGE_BYTES = 1024 * 1024;

// ---------------------------------------------------------------- 設定（Secret / 環境変数）
// OPENAI_API_KEY は `firebase functions:secrets:set OPENAI_API_KEY` で登録（コードにも .env にも書かない）
const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const OPENAI_IMAGE_MODEL = defineString("OPENAI_IMAGE_MODEL", { default: "gpt-image-1" });
// 管理者 uid（カンマ区切り）。事前生成や統計の呼び出しに必要
const ADMIN_UIDS = defineString("ADMIN_UIDS", { default: "" });

function isAdmin(uid: string): boolean {
  return ADMIN_UIDS.value().split(",").map((s) => s.trim()).includes(uid);
}

function requireUid(request: CallableRequest): string {
  if (!request.auth) throw new HttpsError("unauthenticated", "sign in required");
  return request.auth.uid;
}

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw new HttpsError("invalid-argument", r.error.message);
  return r.data;
}

/** ドメインエラー（code プロパティ付き）を HttpsError に変換する */
function toHttpsError(e: unknown, map: Record<string, FunctionsErrorCode>): never {
  if (e instanceof Error && "code" in e && typeof (e as { code: unknown }).code === "string") {
    const code = (e as { code: string }).code;
    if (map[code]) throw new HttpsError(map[code], e.message, { reason: code });
  }
  console.error(e);
  throw new HttpsError("internal", "処理に失敗しました。もう一度お試しください");
}

// ---------------------------------------------------------------- ping（疎通確認）
const PingInput = z.object({ message: z.string().max(100).optional() });

export const ping = onCall({ enforceAppCheck: !IS_EMULATOR }, (request) => {
  const uid = requireUid(request);
  const input = parse(PingInput, request.data);
  return { ok: true, data: { echo: input.message ?? "pong", uid, at: Date.now() } };
});

// ---------------------------------------------------------------- generateMonster（§3.1）
const GenerateInput = z.object({
  imageBase64: z.string().min(1),
  // エミュレータ専用: Vision を呼ばずにラベル・色を指定してテストする
  debugVision: z
    .object({
      labels: z.array(z.object({ name: z.string(), score: z.number().min(0).max(1) })).max(10),
      colors: z.array(z.object({ hex: z.string().regex(/^[0-9a-fA-F]{6}$/), score: z.number() })).max(5),
      faceCount: z.number().int().min(0),
    })
    .optional(),
});

function visionFor(debug: z.infer<typeof GenerateInput>["debugVision"]): VisionClient {
  if (IS_EMULATOR) return new FakeVisionClient(debug ?? DEFAULT_FAKE_VISION);
  return new GoogleVisionClient();
}

export const generateMonster = onCall({ enforceAppCheck: !IS_EMULATOR, memory: "512MiB", timeoutSeconds: 60 }, async (request) => {
  const uid = requireUid(request);
  const input = parse(GenerateInput, request.data);
  const image = Buffer.from(input.imageBase64, "base64");
  if (image.length === 0) throw new HttpsError("invalid-argument", "image is empty");
  if (image.length > MAX_IMAGE_BYTES) throw new HttpsError("invalid-argument", "image must be <= 1MB");
  try {
    const result = await generateMonsterCore(
      {
        db: getFirestore(),
        vision: visionFor(input.debugVision),
        phash: computePhash,
        saveSource: async (ownerUid, monsterId, bytes) => {
          const path = `source/${ownerUid}/${monsterId}.jpg`;
          await getStorage().bucket().file(path).save(bytes, { contentType: "image/jpeg", resumable: false });
          return path;
        },
      },
      uid,
      image,
    );
    return { ok: true, data: result };
  } catch (e) {
    if (e instanceof GenerateError) {
      return toHttpsError(e, {
        face_detected: "failed-precondition",
        duplicate_photo: "already-exists",
        daily_limit: "resource-exhausted",
        rate_limited: "resource-exhausted",
        vision_failed: "unavailable",
      });
    }
    return toHttpsError(e, {});
  }
});

// ---------------------------------------------------------------- renameMonster（初回の名前付け）
const RenameInput = z.object({ monsterId: z.string().min(1).max(64), name: z.string().max(40) });

export const renameMonster = onCall({ enforceAppCheck: !IS_EMULATOR }, async (request) => {
  const uid = requireUid(request);
  const input = parse(RenameInput, request.data);
  try {
    return { ok: true, data: await renameMonsterCore(getFirestore(), uid, input.monsterId, input.name) };
  } catch (e) {
    if (e instanceof RenameError) {
      return toHttpsError(e, { not_found: "not-found", forbidden: "permission-denied", already_named: "failed-precondition", invalid_name: "invalid-argument" });
    }
    return toHttpsError(e, {});
  }
});

// ---------------------------------------------------------------- submitSteps（§5.1, §5.2）
const SegmentInput = z.object({
  startAt: z.number().int().nonnegative(),
  endAt: z.number().int().nonnegative(),
  steps: z.number().int().min(0).max(100_000),
  activity: z.enum(["walking", "running", "cycling", "automotive", "stationary", "unknown"]),
});
const SubmitStepsInput = z.object({ segments: z.array(SegmentInput).max(600) });

export const submitSteps = onCall({ enforceAppCheck: !IS_EMULATOR }, async (request) => {
  const uid = requireUid(request);
  const input = parse(SubmitStepsInput, request.data);
  try {
    return { ok: true, data: await submitStepsCore({ db: getFirestore(), skipRateLimit: IS_EMULATOR }, uid, input.segments) };
  } catch (e) {
    if (e instanceof StepsError) return toHttpsError(e, { rate_limited: "resource-exhausted", too_many_segments: "invalid-argument" });
    return toHttpsError(e, {});
  }
});

// ---------------------------------------------------------------- train（§5.3）
const TrainInput = z.object({ monsterId: z.string().min(1).max(64), type: z.enum(["dash", "labor", "meditate", "endure"]) });

export const train = onCall({ enforceAppCheck: !IS_EMULATOR }, async (request) => {
  const uid = requireUid(request);
  const input = parse(TrainInput, request.data);
  try {
    return { ok: true, data: await trainCore({ db: getFirestore() }, uid, input.monsterId, input.type) };
  } catch (e) {
    if (e instanceof TrainError) {
      return toHttpsError(e, {
        not_found: "not-found",
        forbidden: "permission-denied",
        stored: "failed-precondition",
        no_vp: "resource-exhausted",
        daily_limit: "resource-exhausted",
        tired: "failed-precondition",
        level_cap: "failed-precondition",
      });
    }
    return toHttpsError(e, {});
  }
});

// ---------------------------------------------------------------- setPartner / useItem / rest
const MonsterIdInput = z.object({ monsterId: z.string().min(1).max(64) });
const UseItemInput = z.object({ monsterId: z.string().min(1).max(64), itemType: z.string().min(1).max(40) });
const ACTION_ERRORS: Record<string, FunctionsErrorCode> = {
  not_found: "not-found",
  forbidden: "permission-denied",
  stored: "failed-precondition",
  daily_limit: "resource-exhausted",
  no_item: "failed-precondition",
  wrong_family: "failed-precondition",
  unknown_item: "invalid-argument",
};

export const setPartner = onCall({ enforceAppCheck: !IS_EMULATOR }, async (request) => {
  const uid = requireUid(request);
  const input = parse(MonsterIdInput, request.data);
  try {
    return { ok: true, data: await setPartnerCore(getFirestore(), uid, input.monsterId) };
  } catch (e) {
    if (e instanceof MonsterActionError) return toHttpsError(e, ACTION_ERRORS);
    return toHttpsError(e, {});
  }
});

export const useItem = onCall({ enforceAppCheck: !IS_EMULATOR }, async (request) => {
  const uid = requireUid(request);
  const input = parse(UseItemInput, request.data);
  try {
    return { ok: true, data: await useItemCore(getFirestore(), uid, input.monsterId, input.itemType) };
  } catch (e) {
    if (e instanceof MonsterActionError) return toHttpsError(e, ACTION_ERRORS);
    return toHttpsError(e, {});
  }
});

export const rest = onCall({ enforceAppCheck: !IS_EMULATOR }, async (request) => {
  const uid = requireUid(request);
  const input = parse(MonsterIdInput, request.data);
  try {
    return { ok: true, data: await restCore(getFirestore(), uid, input.monsterId) };
  } catch (e) {
    if (e instanceof MonsterActionError) return toHttpsError(e, ACTION_ERRORS);
    return toHttpsError(e, {});
  }
});

// ---------------------------------------------------------------- アート生成（§3.6, §14.2）
function imageGenerator(): ImageGenerator {
  const key = IS_EMULATOR ? process.env.OPENAI_API_KEY ?? "" : OPENAI_API_KEY.value();
  if (!key) {
    if (IS_EMULATOR) return new FakeImageGenerator(500);
    throw new Error("OPENAI_API_KEY is not set");
  }
  const { constants: C } = loadConfig();
  return new OpenAIImageGenerator(key, OPENAI_IMAGE_MODEL.value(), C.artCostUsd as Record<string, number>);
}

function artDeps(): ArtDeps {
  return {
    db: getFirestore(),
    generator: imageGenerator(),
    saveImage: async (path, png) => {
      await getStorage().bucket().file(path).save(png, { contentType: "image/png", resumable: false });
      return path;
    },
  };
}

/** art_buckets が作られたら生成（非同期）。誕生時は generateMonster が pending で作る */
export const onArtBucketCreated = onDocumentCreated(
  { document: "art_buckets/{bucketId}", secrets: [OPENAI_API_KEY], memory: "512MiB", timeoutSeconds: 120, retry: false },
  async (event) => {
    const bucketId = event.params.bucketId;
    try {
      const r = await processArtBucket(artDeps(), bucketId);
      console.log("art bucket", bucketId, r.outcome, r.costUsd ?? "", r.error ?? "");
    } catch (e) {
      console.error("art bucket failed", bucketId, e);
    }
  },
);

/** 失敗したバケットの再試行。自分のモンスターが使うバケットに限る */
const BucketIdInput = z.object({ bucketId: z.string().min(1).max(120) });

export const retryArtBucket = onCall({ enforceAppCheck: !IS_EMULATOR, secrets: [OPENAI_API_KEY], memory: "512MiB", timeoutSeconds: 120 }, async (request) => {
  const uid = requireUid(request);
  const input = parse(BucketIdInput, request.data);
  const db = getFirestore();
  const owns = await db.collection("monsters").where("ownerId", "==", uid).where("artBucketId", "==", input.bucketId).limit(1).get();
  if (owns.empty && !isAdmin(uid)) throw new HttpsError("permission-denied", "このアートは再生成できません");
  const r = await processArtBucket(artDeps(), input.bucketId);
  return { ok: true, data: r };
});

/** 管理者: 事前生成 252 バケットを投入（トリガーが順次生成する） */
export const pregenerateArt = onCall({ enforceAppCheck: !IS_EMULATOR }, async (request) => {
  const uid = requireUid(request);
  if (!isAdmin(uid)) throw new HttpsError("permission-denied", "admin only");
  const input = parse(z.object({ limit: z.number().int().min(1).max(300).optional() }), request.data);
  return { ok: true, data: await enqueuePregeneration(getFirestore(), input.limit ?? 300) };
});

/** 管理者: 生成数・コスト・キャッシュ命中率（P3 完了条件の実測） */
export const getArtStats = onCall({ enforceAppCheck: !IS_EMULATOR }, async (request) => {
  const uid = requireUid(request);
  if (!isAdmin(uid)) throw new HttpsError("permission-denied", "admin only");
  return { ok: true, data: await artStats(getFirestore()) };
});
