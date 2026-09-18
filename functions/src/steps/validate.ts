// 歩数区間の検証と VP 換算（企画書 v1.3 §5.1, §5.2, §7.2）。純ロジック。
// v1 は位置情報を使わないので、判定材料は「アクティビティ種別」と「歩数の物理妥当性」だけ。
import { loadConfig } from "../shared/config";

export type Activity = "walking" | "running" | "cycling" | "automotive" | "stationary" | "unknown";

export interface StepSegment {
  startAt: number; // epoch ms
  endAt: number;
  steps: number;
  activity: Activity;
}

export type RejectReason = "invalid_range" | "too_long" | "future" | "already_synced" | "vehicle" | "stationary" | "too_fast";

export interface ValidatedSegment extends StepSegment {
  accepted: boolean;
  rejectReason?: RejectReason;
}

export function validateSegments(segments: StepSegment[], lastSyncAt: number, now: number): ValidatedSegment[] {
  const { constants: C } = loadConfig();
  const maxPerMinute = C.maxStepsPerMinute as number;
  const maxMinutes = C.stepSegmentMaxMinutes as number;
  const futureTol = C.stepSegmentFutureToleranceMs as number;
  return segments.map((s) => {
    const durationMs = s.endAt - s.startAt;
    const reject = (reason: RejectReason): ValidatedSegment => ({ ...s, accepted: false, rejectReason: reason });
    if (!Number.isFinite(s.steps) || s.steps < 0 || durationMs <= 0) return reject("invalid_range");
    if (durationMs > maxMinutes * 60_000) return reject("too_long");
    if (s.endAt > now + futureTol) return reject("future");
    if (s.startAt < lastSyncAt) return reject("already_synced");
    if (s.activity === "cycling" || s.activity === "automotive") return reject("vehicle");
    if (s.activity === "stationary") return reject("stationary");
    const perMinute = s.steps / Math.max(1, durationMs / 60_000);
    if (perMinute > maxPerMinute) return reject("too_fast");
    return { ...s, accepted: true };
  });
}

/** 30 分以上の連続歩行（walking/running が最大 gap 以内で連なる）があるか */
export function hasContinuousWalk(segments: ValidatedSegment[]): boolean {
  const { constants: C } = loadConfig();
  const needMs = (C.walkBonusMinutes as number) * 60_000;
  const maxGap = C.walkBonusMaxGapMs as number;
  const walks = segments
    .filter((s) => s.accepted && (s.activity === "walking" || s.activity === "running") && s.steps > 0)
    .sort((a, b) => a.startAt - b.startAt);
  let runStart = -1;
  let runEnd = -1;
  for (const s of walks) {
    if (runEnd >= 0 && s.startAt - runEnd <= maxGap) {
      runEnd = Math.max(runEnd, s.endAt);
    } else {
      runStart = s.startAt;
      runEnd = s.endAt;
    }
    if (runEnd - runStart >= needMs) return true;
  }
  return false;
}

export interface VpConversion {
  acceptedSteps: number;
  countedSteps: number; // 日次上限で切った後
  stepsToday: number;
  vpGained: number;
  stepCarry: number; // 100 歩未満の端数（翌回に持ち越し）
  vpBalance: number;
  vpEarnedToday: number;
  partnerExp: number;
  partnerExpToday: number;
  walkBonusApplied: boolean;
}

export interface VpState {
  stepsToday: number;
  vpBalance: number;
  vpEarnedToday: number;
  stepCarry: number;
  partnerExpToday: number;
  walkBonusToday: boolean;
}

/** 受理歩数を VP とパートナー経験値に換算する（§5.1, §4.7） */
export function convertSteps(state: VpState, acceptedSteps: number, walkBonus: boolean): VpConversion {
  const { constants: C } = loadConfig();
  const stepsPerVp = C.stepsPerVp as number;
  const maxStepsPerDay = C.maxStepsPerDay as number;
  const maxVpBalance = C.maxVpBalance as number;
  const stepsPerExp = C.stepsPerPartnerExp as number;
  const maxExpPerDay = C.maxPartnerExpPerDay as number;

  const room = Math.max(0, maxStepsPerDay - state.stepsToday);
  const countedSteps = Math.min(acceptedSteps, room);
  const stepsToday = state.stepsToday + countedSteps;

  const pool = state.stepCarry + countedSteps;
  let vpGained = Math.floor(pool / stepsPerVp);
  const stepCarry = pool % stepsPerVp;

  let walkBonusApplied = false;
  if (walkBonus && !state.walkBonusToday) {
    vpGained += C.walkBonusVp as number;
    walkBonusApplied = true;
  }
  const vpBalance = Math.min(maxVpBalance, state.vpBalance + vpGained);
  const vpEarnedToday = state.vpEarnedToday + vpGained;

  const expRoom = Math.max(0, maxExpPerDay - state.partnerExpToday);
  const partnerExp = Math.min(expRoom, Math.floor(countedSteps / stepsPerExp));

  return {
    acceptedSteps,
    countedSteps,
    stepsToday,
    vpGained,
    stepCarry,
    vpBalance,
    vpEarnedToday,
    partnerExp,
    partnerExpToday: state.partnerExpToday + partnerExp,
    walkBonusApplied,
  };
}
