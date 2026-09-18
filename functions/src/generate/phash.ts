// 写真の知覚ハッシュ（企画書 §7.2 写真の使い回し対策）。jimp の pHash（64bit）を 16 進 16 桁で返す。
import { Jimp } from "jimp";

export async function computePhash(image: Buffer): Promise<string> {
  const img = await Jimp.read(image);
  // 64bit → 16 進 16 桁（先頭ゼロを保つ）
  return img.hash(16).padStart(16, "0");
}
