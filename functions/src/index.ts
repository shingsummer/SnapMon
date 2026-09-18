// Cloud Functions エントリポイント（企画書 §11）。
// すべての callable は認証 + App Check 必須。レスポンスは { ok, data } / エラーは HttpsError。
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { setGlobalOptions } from "firebase-functions/v2";
import { HttpsError, onCall, type CallableRequest, type FunctionsErrorCode } from "firebase-functions/v2/https";
import { z } from "zod";
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
