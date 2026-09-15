// Cloud Functions エントリポイント。P0 では疎通確認用の ping のみ。
// 各 callable は認証 + App Check 必須（企画書 §11）。
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { z } from "zod";

setGlobalOptions({ region: "asia-northeast1", maxInstances: 10 });

const PingInput = z.object({ message: z.string().max(100).optional() });

export const ping = onCall({ enforceAppCheck: true }, (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "sign in required");
  const parsed = PingInput.safeParse(request.data ?? {});
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  return { ok: true, data: { echo: parsed.data.message ?? "pong", uid: request.auth.uid, at: Date.now() } };
});
