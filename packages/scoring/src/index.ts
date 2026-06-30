// @ball/scoring — game rules (daily tally, H2H resolution).
// Note: it imports the SAME types as the frontend, straight from the local
// @ball/shared workspace — no publish step, no version number to keep in sync.
import type { DailyPick } from "@ball/shared";

/** Placeholder: real daily-tally ranking lands in M2. */
export function describePick(pick: DailyPick): string {
  return `${pick.userId} picked ${pick.playerId} on ${pick.date}`;
}
