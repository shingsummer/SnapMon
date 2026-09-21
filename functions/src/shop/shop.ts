// 課金（企画書 §12、P6 で確定）。
// 方針: 強さは売らない。売るのは 撮影チケット（1 日の合計 3 枚まで）、プレミアム（30 日）、専用アート。
// 決済の検証（ストアのレシート確認）は PurchaseVerifier に切り出す。付与は orderId で冪等（同じ注文は 1 回だけ）。
import * as fs from "node:fs";
import * as path from "node:path";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { configDir, loadConfig } from "../shared/config";

export type Platform = "android" | "ios" | "dev";

export interface Product {
  id: string;
  kind: "consumable" | "subscription";
  name: string;
  description: string;
  priceJpy: number;
  grant: { item?: string; count?: number; premiumDays?: number };
}

let productsCache: Product[] | null = null;
export function loadProducts(): Product[] {
  if (!productsCache) {
    productsCache = (JSON.parse(fs.readFileSync(path.join(configDir(), "products.json"), "utf-8")) as { products: Product[] }).products;
  }
  return productsCache;
}

export function productById(id: string): Product | undefined {
  return loadProducts().find((p) => p.id === id);
}

export class ShopError extends Error {
  constructor(
    public readonly code: "unknown_product" | "invalid_purchase" | "store_not_configured" | "no_item" | "not_found" | "forbidden" | "no_source" | "in_progress",
    message: string,
  ) {
    super(message);
  }
}

/** ストアのレシート検証。検証できたら注文 ID を返す（付与の冪等キー） */
export interface PurchaseVerifier {
  verify(platform: Platform, productId: string, token: string): Promise<{ orderId: string }>;
}

/** エミュレータ専用: 何でも通す（token をそのまま注文 ID にする） */
export class DevPurchaseVerifier implements PurchaseVerifier {
  async verify(platform: Platform, productId: string, token: string): Promise<{ orderId: string }> {
    if (!token) throw new ShopError("invalid_purchase", "token が空です");
    return { orderId: `dev:${productId}:${token}` };
  }
}

/** ストア連携が未設定のとき（本番の初期状態） */
export class NotConfiguredVerifier implements PurchaseVerifier {
  async verify(): Promise<{ orderId: string }> {
    throw new ShopError("store_not_configured", "購入はまだ準備中です");
  }
}

export interface RedeemInput {
  platform: Platform;
  productId: string;
  token: string;
}

export interface RedeemResult {
  productId: string;
  orderId: string;
  alreadyGranted: boolean;
  granted: Product["grant"];
  premiumUntil: number | null;
}

/** 検証 → 付与（冪等）。purchases/{orderId} を台帳にする */
export async function redeemPurchaseCore(deps: { db: Firestore; verifier: PurchaseVerifier; now?: () => Date }, uid: string, input: RedeemInput): Promise<RedeemResult> {
  const product = productById(input.productId);
  if (!product) throw new ShopError("unknown_product", "その商品はありません");
  const { orderId } = await deps.verifier.verify(input.platform, input.productId, input.token);
  const now = (deps.now ?? (() => new Date()))();
  const db = deps.db;
  const ledgerRef = db.collection("purchases").doc(orderId.replace(/\//g, "_"));
  const userRef = db.collection("users").doc(uid);

  return db.runTransaction(async (tx) => {
    const [ledger, userSnap] = await Promise.all([tx.get(ledgerRef), tx.get(userRef)]);
    const currentPremium = (userSnap.get("premiumUntil") as number | undefined) ?? 0;
    if (ledger.exists) {
      return { productId: product.id, orderId, alreadyGranted: true, granted: product.grant, premiumUntil: currentPremium || null };
    }
    let premiumUntil: number | null = null;
    if (product.grant.item && product.grant.count) {
      const invRef = userRef.collection("inventory").doc(product.grant.item);
      tx.set(invRef, { type: product.grant.item, count: FieldValue.increment(product.grant.count) }, { merge: true });
    }
    if (product.grant.premiumDays) {
      const base = Math.max(currentPremium, now.getTime());
      premiumUntil = base + product.grant.premiumDays * 24 * 60 * 60 * 1000;
      tx.set(userRef, { premiumUntil, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    tx.set(ledgerRef, { uid, productId: product.id, platform: input.platform, orderId, grantedAt: FieldValue.serverTimestamp() });
    return { productId: product.id, orderId, alreadyGranted: false, granted: product.grant, premiumUntil };
  });
}

export function isPremium(user: Record<string, unknown> | undefined, now: Date): boolean {
  const until = user?.premiumUntil as number | undefined;
  return typeof until === "number" && until > now.getTime();
}

/** 1 日の無料枠（プレミアムなら +1） */
export function freeSnapAllowance(user: Record<string, unknown> | undefined, now: Date): number {
  const { constants: C } = loadConfig();
  return (C.snapsPerDay as number) + (isPremium(user, now) ? (C.premiumExtraSnapsPerDay as number) : 0);
}

export interface ArtUpgradeDeps {
  db: Firestore;
  /** 品質を指定して個体アートを描き直す（processMonsterArt を包む） */
  regenerate: (monsterId: string, quality: string) => Promise<{ outcome: string; imagePath?: string }>;
}

/** 専用アート券を 1 枚使って、その個体を高品質で描き直す。券の消費と描き直し可能状態への変更を先に行う */
export async function applyArtUpgradeCore(deps: ArtUpgradeDeps, uid: string, monsterId: string): Promise<{ outcome: string; imagePath?: string; remaining: number }> {
  const { constants: C } = loadConfig();
  const db = deps.db;
  const invRef = db.collection("users").doc(uid).collection("inventory").doc("art_upgrade");
  const ref = db.collection("monsters").doc(monsterId);
  const remaining = await db.runTransaction(async (tx) => {
    const [inv, snap] = await Promise.all([tx.get(invRef), tx.get(ref)]);
    if (!snap.exists) throw new ShopError("not_found", "モンスターが見つかりません");
    if (snap.get("ownerId") !== uid) throw new ShopError("forbidden", "自分のモンスターではありません");
    if (!snap.get("sourceImagePath")) throw new ShopError("no_source", "出自の写真がないので描き直せません");
    if (snap.get("artStatus") === "generating") throw new ShopError("in_progress", "いま描いている途中です");
    const count = inv.exists ? ((inv.get("count") as number | undefined) ?? 0) : 0;
    if (count <= 0) throw new ShopError("no_item", "専用アート券を持っていません");
    tx.set(invRef, { type: "art_upgrade", count: count - 1 }, { merge: true });
    // processMonsterArt が拾えるように、描き直し可能な状態にしてから生成する
    tx.update(ref, { artStatus: "failed", artAttempts: 0, artUpgradeRequestedAt: FieldValue.serverTimestamp() });
    return count - 1;
  });
  const res = await deps.regenerate(monsterId, C.artUpgradeQuality as string);
  return { ...res, remaining };
}
