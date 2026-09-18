// Cloud Functions エントリポイント（企画書 §11）。
// すべての callable は認証 + App Check 必須。レスポンスは { ok, data } / エラーは HttpsError。
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { setGlobalOptions } from "firebase-functions/v2";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { GenerateError, generateMonsterCore } from "./generate/generateMonster";
import { computePhash } from "./generate/phash";
import { DEFAULT_FAKE_VISION, FakeVisionClient, GoogleVisionClient, type VisionClient } from "./generate/vision";
import { RenameError, renameMonsterCore } from "./monster/rename";

initializeApp();
setGlobalOptions({ region: "asia-northeast1", maxInstances: 10 });

const IS_EMULATOR = process.env.FUNCTIONS_EMULATOR === "true";
const MAX_IMAGE_BYTES = 1024 * 1024;

function requireUid(request: CallableRequest): string {
  if (!request.auth) throw new HttpsError("unauthenticated", "sign in required");
  return request.auth.uid;
}

// ---------------------------------------------------------------- ping（疎通確認）
const PingInput = z.object({ message: z.string().max(100).optional() });

export const ping = onCall({ enforceAppCheck: !IS_EMULATOR }, (request) => {
  const uid = requireUid(request);
  const parsed = PingInput.safeParse(request.data ?? {});
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  return { ok: true, data: { echo: parsed.data.message ?? "pong", uid, at: Date.now() } };
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

export const generateMonster = onCall(
  { enforceAppCheck: !IS_EMULATOR, memory: "512MiB", timeoutSeconds: 60 },
  async (request) => {
    const uid = requireUid(request);
    const parsed = GenerateInput.safeParse(request.data ?? {});
    if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);

    const image = Buffer.from(parsed.data.imageBase64, "base64");
    if (image.length === 0) throw new HttpsError("invalid-argument", "image is empty");
    if (image.length > MAX_IMAGE_BYTES) throw new HttpsError("invalid-argument", "image must be <= 1MB");

    try {
      const result = await generateMonsterCore(
        {
          db: getFirestore(),
          vision: visionFor(parsed.data.debugVision),
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
        const codeMap = {
          face_detected: "failed-precondition",
          duplicate_photo: "already-exists",
          daily_limit: "resource-exhausted",
          rate_limited: "resource-exhausted",
          vision_failed: "unavailable",
        } as const;
        throw new HttpsError(codeMap[e.code], e.message, { reason: e.code });
      }
      console.error("generateMonster failed", e);
      throw new HttpsError("internal", "生成に失敗しました。もう一度お試しください");
    }
  },
);

// ---------------------------------------------------------------- renameMonster（初回の名前付け）
const RenameInput = z.object({ monsterId: z.string().min(1).max(64), name: z.string().max(40) });

export const renameMonster = onCall({ enforceAppCheck: !IS_EMULATOR }, async (request) => {
  const uid = requireUid(request);
  const parsed = RenameInput.safeParse(request.data ?? {});
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  try {
    const data = await renameMonsterCore(getFirestore(), uid, parsed.data.monsterId, parsed.data.name);
    return { ok: true, data };
  } catch (e) {
    if (e instanceof RenameError) {
      const codeMap = { not_found: "not-found", forbidden: "permission-denied", already_named: "failed-precondition", invalid_name: "invalid-argument" } as const;
      throw new HttpsError(codeMap[e.code], e.message, { reason: e.code });
    }
    throw e;
  }
});
