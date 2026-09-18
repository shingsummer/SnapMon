// 日付判定はすべてサーバー時刻の JST 0:00 リセット（企画書 §7.1, §7.2）。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** "yyyymmdd"（JST） */
export function jstDateKey(now: Date = new Date()): string {
  const d = new Date(now.getTime() + JST_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** 次の JST 0:00 までのミリ秒 */
export function msUntilJstMidnight(now: Date = new Date()): number {
  const shifted = now.getTime() + JST_OFFSET_MS;
  const dayMs = 24 * 60 * 60 * 1000;
  const nextMidnightShifted = Math.floor(shifted / dayMs) * dayMs + dayMs;
  return nextMidnightShifted - shifted;
}
