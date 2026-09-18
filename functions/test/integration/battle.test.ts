// バトル・フレンドの結合テスト（Firestore エミュレータ）
import { createHash } from "node:crypto";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { beforeAll, describe, expect, it } from "vitest";
import { generateMonsterCore } from "../../src/generate/generateMonster";
import { DEFAULT_FAKE_VISION, FakeVisionClient } from "../../src/generate/vision";
import { addFriend, blockUser, ensureFriendCode, normalizeCode, removeFriend, reportUser } from "../../src/friends/friends";
import { setBattlePartyCore, startBattleCore } from "../../src/battle/startBattle";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("run via npm run test:integration");

let db: Firestore;
beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: "snap-mon-7a9bf" });
  db = getFirestore();
});

let clock = Date.parse("2026-09-18T00:00:00Z");
async function born(uid: string, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const img = Buffer.from(`img-${uid}-${i}-${clock}`);
    const r = await generateMonsterCore(
      {
        db,
        vision: new FakeVisionClient(DEFAULT_FAKE_VISION),
        phash: async (b) => createHash("sha256").update(b).digest("hex").slice(0, 16),
        now: () => new Date((clock += 25 * 3600_000)), // 1 日ずつ進めて 3 枚/日の枠を避ける
        nonce: () => `${uid}-${i}`,
      },
      uid,
      img,
    );
    ids.push(r.monsterId);
  }
  return ids;
}

const SEED = "0123456789abcdef0123456789abcdef";

describe("friends", () => {
  it("issues a stable friend code, adds/removes/blocks, and reports", async () => {
    const a = `fa-${Date.now()}`;
    const b = `fb-${Date.now()}`;
    await db.collection("users").doc(b).set({ displayName: "B さん" });
    const codeA = await ensureFriendCode(db, a);
    expect(codeA).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(await ensureFriendCode(db, a)).toBe(codeA);
    const codeB = await ensureFriendCode(db, b);

    expect(normalizeCode("abcd 2345")).toBe("ABCD-2345");
    await expect(addFriend(db, a, codeA)).rejects.toMatchObject({ code: "self" });
    await expect(addFriend(db, a, "ZZZZ-ZZZZ")).rejects.toMatchObject({ code: "not_found" });
    const r = await addFriend(db, a, codeB);
    expect(r.friendId).toBe(b);
    expect(r.displayName).toBe("B さん");
    await expect(addFriend(db, a, codeB)).rejects.toMatchObject({ code: "already" });
    expect((await db.collection("friends").doc(b).collection("list").doc(a).get()).exists).toBe(true);

    await removeFriend(db, a, b);
    expect((await db.collection("friends").doc(a).collection("list").doc(b).get()).exists).toBe(false);

    await blockUser(db, b, a);
    await expect(addFriend(db, a, codeB)).rejects.toMatchObject({ code: "blocked" });
    const rep = await reportUser(db, a, b, "harassment", "test");
    expect((await db.collection("reports").doc(rep.reportId).get()).get("status")).toBe("open");
  });
});

describe("battles", () => {
  it("practice battle resolves deterministically, stores the log, and gives no rewards", async () => {
    const uid = `bt-${Date.now()}-p`;
    const ids = await born(uid, 4);
    const party = ids.slice(0, 3);
    let t = Date.parse("2026-09-18T03:00:00Z");
    const deps = { db, now: () => new Date((t += 20_000)), seed: () => SEED, murmur: () => null };
    const r1 = await startBattleCore(deps, uid, "practice", null, party);
    expect(["A", "B"]).toContain(r1.winner);
    expect(r1.rewards.vp).toBe(0);
    expect(r1.rewards.expPerMonster).toBe(0);
    const stored = (await db.collection("battles").doc(r1.battleId).get()).data()!;
    expect(stored.seed).toBe(SEED);
    expect(stored.defenderParty).toEqual([ids[3]]);
    expect(stored.events.length).toBe(r1.result.events.length);
    // 同シード → 同結果
    const r2 = await startBattleCore(deps, uid, "practice", null, party);
    expect(r2.result.events.map((e) => e.text)).toEqual(r1.result.events.map((e) => e.text));
    // レート制限
    await expect(startBattleCore({ ...deps, now: () => new Date(t) }, uid, "practice", null, party)).rejects.toMatchObject({ code: "rate_limited" });
    // 両側に同じモンスター
    await expect(startBattleCore(deps, uid, "practice", null, party, [ids[0], ids[1], ids[2]])).rejects.toMatchObject({ code: "invalid_party" });
  });

  it("friend battle requires friendship, uses the defender's battle party, grants exp/VP with the daily reward cap", async () => {
    const a = `bt-${Date.now()}-a`;
    const b = `bt-${Date.now()}-b`;
    const mine = await born(a, 3);
    const theirs = await born(b, 4);
    let t = Date.parse("2026-09-18T03:00:00Z");
    const deps = { db, now: () => new Date((t += 20_000)), seed: () => SEED, murmur: () => "p001" };

    await expect(startBattleCore(deps, a, "friend", b, mine)).rejects.toMatchObject({ code: "not_friend" });
    await addFriend(db, a, await ensureFriendCode(db, b));
    await setBattlePartyCore(db, b, theirs.slice(1, 4));
    await expect(setBattlePartyCore(db, b, [theirs[0], theirs[0], theirs[1]])).rejects.toMatchObject({ code: "invalid_party" });

    const r = await startBattleCore(deps, a, "friend", b, mine);
    const stored = (await db.collection("battles").doc(r.battleId).get()).data()!;
    expect(stored.defenderParty).toEqual(theirs.slice(1, 4));
    expect(r.rewards.rewarded).toBe(true);
    expect(r.rewards.vp).toBe(r.winner === "A" ? 5 : 2);
    expect(r.rewards.expPerMonster).toBe(r.winner === "A" ? 20 : 8);
    expect(r.murmurTextId).toBe("p001");
    const m0 = (await db.collection("monsters").doc(mine[0]).get()).data()!;
    expect(m0.exp + (m0.level - 1) * 100).toBeGreaterThan(0);
    const user = (await db.collection("users").doc(a).get()).data()!;
    expect(user.vpBalance).toBe(r.rewards.vp);
    expect(user.dailyState.friendBattlesToday).toBe(1);

    // 4 回目以降は VP 報酬なし（経験値はあり）
    await startBattleCore(deps, a, "friend", b, mine);
    await startBattleCore(deps, a, "friend", b, mine);
    const r4 = await startBattleCore(deps, a, "friend", b, mine);
    expect(r4.rewards.rewarded).toBe(false);
    expect(r4.rewards.vp).toBe(0);
    expect(r4.rewards.expPerMonster).toBeGreaterThan(0);

    // ブロックされたら対戦不可
    await blockUser(db, b, a);
    await expect(startBattleCore(deps, a, "friend", b, mine)).rejects.toMatchObject({ code: "blocked" });
  });
});
