// submitSteps（企画書 §11, §5.1, §5.2, §4.7）: 区間検証 → VP 換算 → パートナー経験値 → dailyState 更新 → つぶやき。
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { loadConfig, type GrowthType, type Stats, type StatsInt } from "../shared/config";
import { jstDateKey } from "../shared/jst";
import { rollMurmur } from "../murmur/murmur";
import { grantExp } from "../monster/progress";
import { convertSteps, hasContinuousWalk, validateSegments, type StepSegment, type ValidatedSegment } from "./validate";

export class StepsError extends Error {
  constructor(
    public readonly code: "rate_limited" | "too_many_segments",
    message: string,
  ) {
    super(message);
  }
}

export interface SubmitStepsDeps {
  db: Firestore;
  now?: () => Date;
  /** テストで固定するため。省略時は本物の乱数 */
  murmur?: typeof rollMurmur;
  /** エミュレータ・テストでは 5 分間隔のレート制限を外す */
  skipRateLimit?: boolean;
}

export interface SubmitStepsResult {
  acceptedSteps: number;
  rejected: { index: number; reason: string }[];
  stepsToday: number;
  vpGained: number;
  vpBalance: number;
  walkBonusApplied: boolean;
  partner: { monsterId: string; exp: number; level: number; levelUps: number } | null;
  murmurTextId: string | null;
}

const MAX_SEGMENTS = 600; // 5 分 × 600 = 50 時間分

export async function submitStepsCore(deps: SubmitStepsDeps, uid: string, segments: StepSegment[]): Promise<SubmitStepsResult> {
  const { constants: C } = loadConfig();
  const now = deps.now ?? (() => new Date());
  const murmur = deps.murmur ?? rollMurmur;
  const db = deps.db;
  if (segments.length > MAX_SEGMENTS) throw new StepsError("too_many_segments", "区間が多すぎます");

  const nowMs = now().getTime();
  const today = jstDateKey(now());
  const userRef = db.collection("users").doc(uid);

  return db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const user = userSnap.exists ? (userSnap.data() as Record<string, unknown>) : {};
    const lastSubmit = (user.lastStepsSubmitAt as number | undefined) ?? 0;
    if (!deps.skipRateLimit && nowMs - lastSubmit < (C.stepsSubmitIntervalMs as number)) {
      throw new StepsError("rate_limited", "歩数の同期は5分に1回です");
    }
    const lastSyncAt = (user.lastStepSyncAt as number | undefined) ?? 0;
    const daily = (user.dailyState as Record<string, unknown> | undefined) ?? {};
    const sameDay = daily.date === today;
    const d = (k: string) => (sameDay ? ((daily[k] as number | undefined) ?? 0) : 0);

    const validated: ValidatedSegment[] = validateSegments(segments, lastSyncAt, nowMs);
    const accepted = validated.filter((s) => s.accepted);
    const acceptedSteps = accepted.reduce((a, s) => a + s.steps, 0);
    const conv = convertSteps(
      {
        stepsToday: d("stepsToday"),
        vpBalance: (user.vpBalance as number | undefined) ?? 0,
        vpEarnedToday: d("vpEarnedToday"),
        stepCarry: (user.stepCarry as number | undefined) ?? 0,
        partnerExpToday: d("partnerExpToday"),
        walkBonusToday: sameDay && daily.walkBonusToday === true,
      },
      acceptedSteps,
      hasContinuousWalk(validated),
    );

    // パートナーへ経験値
    let partnerResult: SubmitStepsResult["partner"] = null;
    let murmurTextId: string | null = null;
    const partnerId = user.partnerMonsterId as string | undefined;
    if (partnerId) {
      const pubRef = db.collection("monsters").doc(partnerId);
      const privRef = db.collection("monsters_private").doc(partnerId);
      const [pub, priv] = await Promise.all([tx.get(pubRef), tx.get(privRef)]);
      if (pub.exists && priv.exists && pub.get("ownerId") === uid && pub.get("status") === "active") {
        const p = pub.data() as Record<string, unknown>;
        const pr = priv.data() as Record<string, unknown>;
        const res = grantExp(
          {
            seed: pr.seed as string,
            level: p.level as number,
            exp: p.exp as number,
            stats: p.stats as Stats,
            talent: pr.talent as StatsInt,
            growth: pr.growth as GrowthType,
            personality: p.personality as number,
            statHistory: (p.statHistory as { level: number; stats: Stats }[]) ?? [],
          },
          conv.partnerExp,
        );
        murmurTextId = murmur(
          { growth: pr.growth as GrowthType, murmurRate: pr.murmurRate as number, murmurWindowOffset: pr.murmurWindowOffset as number, level: res.level },
          1 + res.levelUps,
        );
        if (conv.partnerExp > 0 || res.levelUps > 0) {
          tx.update(pubRef, {
            exp: res.exp,
            level: res.level,
            stats: res.stats,
            statHistory: res.statHistory,
            ...(murmurTextId ? { lastMurmurTextId: murmurTextId } : {}),
            updatedAt: FieldValue.serverTimestamp(),
          });
        } else if (murmurTextId) {
          tx.update(pubRef, { lastMurmurTextId: murmurTextId });
        }
        partnerResult = { monsterId: partnerId, exp: conv.partnerExp, level: res.level, levelUps: res.levelUps };
      }
    }

    // 区間の記録（受理・拒否とも）
    const segCol = userRef.collection("stepSegments");
    for (const s of validated) {
      tx.set(segCol.doc(`${s.startAt}`), {
        startAt: s.startAt,
        endAt: s.endAt,
        steps: s.steps,
        activity: s.activity,
        accepted: s.accepted,
        rejectReason: s.rejectReason ?? null,
        submittedAt: nowMs,
      });
    }
    const newestEnd = accepted.reduce((a, s) => Math.max(a, s.endAt), lastSyncAt);

    tx.set(
      userRef,
      {
        dailyState: {
          ...(sameDay ? daily : {}),
          date: today,
          stepsToday: conv.stepsToday,
          vpEarnedToday: conv.vpEarnedToday,
          partnerExpToday: conv.partnerExpToday,
          walkBonusToday: (sameDay && daily.walkBonusToday === true) || conv.walkBonusApplied,
        },
        vpBalance: conv.vpBalance,
        stepCarry: conv.stepCarry,
        lastStepSyncAt: newestEnd,
        lastStepsSubmitAt: nowMs,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return {
      acceptedSteps,
      rejected: validated.map((s, i) => ({ i, s })).filter(({ s }) => !s.accepted).map(({ i, s }) => ({ index: i, reason: s.rejectReason! })),
      stepsToday: conv.stepsToday,
      vpGained: conv.vpGained,
      vpBalance: conv.vpBalance,
      walkBonusApplied: conv.walkBonusApplied,
      partner: partnerResult,
      murmurTextId,
    };
  });
}
