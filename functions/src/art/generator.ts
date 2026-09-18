// 画像生成アダプタ（企画書 §9.1: 差し替え可能なアダプタ層）。
// 本番は OpenAI Images API。エミュレータ・テストは FakeImageGenerator（jimp で塗った PNG）。
import { Jimp } from "jimp";

export type ArtQuality = "low" | "medium" | "high";

export interface GenerateImageOptions {
  size: string; // "1024x1024"
  quality: ArtQuality;
  /** 参照画像あり生成で、元画像の特徴をどれだけ保つか（OpenAI の input_fidelity） */
  inputFidelity?: "low" | "high";
}

export interface GeneratedImage {
  png: Buffer;
  model: string;
  costUsd: number;
}

export interface ImageGenerator {
  /** テキストだけから生成（共有バケット用） */
  generate(prompt: string, opts: GenerateImageOptions): Promise<GeneratedImage>;
  /** 写真を参照して生成（個体用: 「撮ったものがモンスターになる」） */
  generateFromImage(prompt: string, image: Buffer, opts: GenerateImageOptions): Promise<GeneratedImage>;
}

const OPENAI_GENERATIONS = "https://api.openai.com/v1/images/generations";
const OPENAI_EDITS = "https://api.openai.com/v1/images/edits";

export class OpenAIImageGenerator implements ImageGenerator {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly costTable: Record<string, number>,
  ) {}

  async generate(prompt: string, opts: GenerateImageOptions): Promise<GeneratedImage> {
    const res = await fetch(OPENAI_GENERATIONS, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      // moderation: "low" は gpt-image 系の安全フィルタを緩める公式オプション（モンスター絵の誤検知対策）
      body: JSON.stringify({ model: this.model, prompt, n: 1, size: opts.size, quality: opts.quality, output_format: "png", moderation: "low" }),
    });
    return this.parse(res, opts);
  }

  async generateFromImage(prompt: string, image: Buffer, opts: GenerateImageOptions): Promise<GeneratedImage> {
    const form = new FormData();
    form.append("model", this.model);
    form.append("prompt", prompt);
    form.append("n", "1");
    form.append("size", opts.size);
    form.append("quality", opts.quality);
    form.append("input_fidelity", opts.inputFidelity ?? "low");
    form.append("image", new Blob([new Uint8Array(image)], { type: "image/jpeg" }), "source.jpg");
    const res = await fetch(OPENAI_EDITS, { method: "POST", headers: { Authorization: `Bearer ${this.apiKey}` }, body: form });
    return this.parse(res, opts);
  }

  private async parse(res: Response, opts: GenerateImageOptions): Promise<GeneratedImage> {
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
    return this.blob(m ? m[1] : "808080", opts);
  }

  async generateFromImage(prompt: string, image: Buffer, opts: GenerateImageOptions): Promise<GeneratedImage> {
    // 参照画像の平均色で塗る（「写真の色が反映される」ことだけ模す）
    let hex = "808080";
    try {
      const img = await Jimp.read(image);
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = 0; y < img.height; y += 8) {
        for (let x = 0; x < img.width; x += 8) {
          const c = img.getPixelColor(x, y);
          r += (c >>> 24) & 0xff;
          g += (c >>> 16) & 0xff;
          b += (c >>> 8) & 0xff;
          n++;
        }
      }
      if (n > 0) hex = [r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("");
    } catch {
      // 読めない画像でも生成は成立させる
    }
    return this.blob(hex, opts);
  }

  private async blob(hex: string, opts: GenerateImageOptions): Promise<GeneratedImage> {
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
    if (this.delayMs > 0) await new Promise((res) => setTimeout(res, this.delayMs));
    return { png: await img.getBuffer("image/png"), model: "fake", costUsd: 0 };
  }
}
