// xorshift128 乱数。仕様は shared-config/README.md。
// Python の tools/growth_ref.py・Dart の app/lib/domain/rng.dart と bit 単位で一致させること。
import { createHash } from "node:crypto";

export class XorShift128 {
  private x: number;
  private y: number;
  private z: number;
  private w: number;

  constructor(seedHex: string) {
    if (!/^[0-9a-fA-F]{32}$/.test(seedHex)) {
      throw new Error("seedHex must be 32 hex chars");
    }
    const b = Buffer.from(seedHex, "hex");
    this.x = b.readUInt32BE(0);
    this.y = b.readUInt32BE(4);
    this.z = b.readUInt32BE(8);
    this.w = b.readUInt32BE(12);
    if ((this.x | this.y | this.z | this.w) === 0) this.x = 1;
  }

  nextU32(): number {
    const t = (this.x ^ (this.x << 11)) >>> 0;
    this.x = this.y;
    this.y = this.z;
    this.z = this.w;
    this.w = (this.w ^ (this.w >>> 19) ^ (t ^ (t >>> 8))) >>> 0;
    return this.w;
  }

  /** [0, 1) */
  nextDouble(): number {
    return this.nextU32() / 4294967296;
  }

  /** 両端を含む整数 */
  randInt(lo: number, hi: number): number {
    return lo + Math.floor(this.nextDouble() * (hi - lo + 1));
  }

  randRange(lo: number, hi: number): number {
    return lo + this.nextDouble() * (hi - lo);
  }
}

/** 企画書 §16.1: sha256(label|color|userId|yyyymmdd|nonce) の先頭 16 バイト */
export function seedFromParts(label: string, colorHex: string, userId: string, yyyymmdd: string, nonce: string): string {
  const s = [label, colorHex, userId, yyyymmdd, nonce].join("|");
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 32);
}

/** 四捨五入（常に切り上げ側）。言語間で round の挙動が違うため統一 */
export function floorHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}
