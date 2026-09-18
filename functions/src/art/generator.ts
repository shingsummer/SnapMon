// 画像生成アダプタ（企画書 §9.1: 差し替え可能なアダプタ層）。
// 本番は OpenAI Images API。エミュレータ・テストは FakeImageGenerator（jimp で塗った PNG）。
import { Jimp } from "jimp";

export interface GenerateImageOptions {
  size: string; // "1024x1024"
  quality: "low" | "medium" | "high";
}

export interface GeneratedImage {
  png: Buffer;
  model: string;
  costUsd: number;
}

export interface ImageGenerator {
  generate(prompt: string, opts: GenerateImageOptions): Promise<GeneratedImage>;
}

const OPENAI_ENDPOINT = "https://api.openai.com/v1/images/generations";

export class OpenAIImageGenerator implements ImageGenerator {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly costTable: Record<string, number>,
  ) {}

  async generate(prompt: string, opts: GenerateImageOptions): Promise<GeneratedImage> {
    const res = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt, n: 1, size: opts.size, quality: opts.quality, output_format: "png" }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI Images HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI Images returned no image");
    return { png: Buffer.from(b64, "base64"), model: this.model, costUsd: this.costTable[opts.quality] ?? 0 };
  }
}

/** 代表色で塗った丸いシルエット PNG を返す（コストゼロ） */
export class FakeImageGenerator implements ImageGenerator {
  constructor(private readonly delayMs = 0) {}

  async generate(prompt: string, opts: GenerateImageOptions): Promise<GeneratedImage> {
    const m = /Primary colors: #([0-9a-f]{6})/i.exec(prompt);
    const hex = m ? m[1] : "808080";
    const [w, h] = opts.size.split("x").map(Number);
    const img = new Jimp({ width: w || 512, height: h || 512, color: 0xffffffff });
    const color = parseInt(`${hex}ff`, 16);
    const cx = img.width / 2;
    const cy = img.height / 2;
    const r = img.width * 0.35;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const dx = x - cx;
        const dy = (y - cy) * 0.85;
        if (dx * dx + dy * dy <= r * r) img.setPixelColor(color, x, y);
      }
    }
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    return { png: await img.getBuffer("image/png"), model: "fake", costUsd: 0 };
  }
}
