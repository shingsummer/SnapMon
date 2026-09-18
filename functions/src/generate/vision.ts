// 画像認識クライアント（企画書 §3.1 ③、§9.1）。
// Google Cloud Vision API の REST を直接叩く（Label + Image Properties + Face を 1 リクエストで）。
// テストとエミュレータでは FakeVisionClient に差し替える。
import { GoogleAuth } from "google-auth-library";
import type { VisionColor, VisionLabel } from "./classify";

export interface VisionResult {
  labels: VisionLabel[];
  colors: VisionColor[]; // 面積比の大きい順、hex は "rrggbb"
  faceCount: number;
}

export interface VisionClient {
  annotate(imageBytes: Buffer): Promise<VisionResult>;
}

const VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

interface AnnotateResponse {
  responses?: Array<{
    labelAnnotations?: Array<{ description?: string; score?: number }>;
    imagePropertiesAnnotation?: {
      dominantColors?: { colors?: Array<{ color?: { red?: number; green?: number; blue?: number }; pixelFraction?: number; score?: number }> };
    };
    faceAnnotations?: Array<unknown>;
    error?: { code?: number; message?: string };
  }>;
}

export class GoogleVisionClient implements VisionClient {
  private readonly auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

  async annotate(imageBytes: Buffer): Promise<VisionResult> {
    const token = await this.auth.getAccessToken();
    if (!token) throw new Error("failed to obtain access token for Vision API");
    const body = {
      requests: [
        {
          image: { content: imageBytes.toString("base64") },
          features: [
            { type: "LABEL_DETECTION", maxResults: 10 },
            { type: "IMAGE_PROPERTIES" },
            { type: "FACE_DETECTION", maxResults: 5 },
          ],
        },
      ],
    };
    const res = await fetch(VISION_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Vision API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const json = (await res.json()) as AnnotateResponse;
    const r = json.responses?.[0];
    if (!r) throw new Error("Vision API returned no response");
    if (r.error) throw new Error(`Vision API error ${r.error.code}: ${r.error.message}`);
    return parseVisionResponse(r);
  }
}

export function parseVisionResponse(r: NonNullable<AnnotateResponse["responses"]>[number]): VisionResult {
  const labels: VisionLabel[] = (r.labelAnnotations ?? [])
    .filter((l) => l.description)
    .map((l) => ({ name: l.description as string, score: l.score ?? 0 }));
  const colors: VisionColor[] = (r.imagePropertiesAnnotation?.dominantColors?.colors ?? [])
    .map((c) => ({
      hex: rgbToHex(c.color?.red ?? 0, c.color?.green ?? 0, c.color?.blue ?? 0),
      score: c.pixelFraction ?? c.score ?? 0,
    }))
    .sort((a, b) => b.score - a.score);
  return { labels, colors, faceCount: r.faceAnnotations?.length ?? 0 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `${c(r)}${c(g)}${c(b)}`;
}

/** テスト・エミュレータ用。固定の結果を返す。 */
export class FakeVisionClient implements VisionClient {
  constructor(private readonly result: VisionResult) {}
  async annotate(): Promise<VisionResult> {
    return this.result;
  }
}

export const DEFAULT_FAKE_VISION: VisionResult = {
  labels: [{ name: "Mug", score: 0.93 }, { name: "Tableware", score: 0.81 }, { name: "Cup", score: 0.77 }],
  colors: [{ hex: "1e88e5", score: 0.55 }, { hex: "ffffff", score: 0.3 }, { hex: "37474f", score: 0.1 }],
  faceCount: 0,
};
