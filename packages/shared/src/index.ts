// @ball/shared — API contract types shared by frontend + backend.
// One source of truth: change a type here and every consumer re-checks against it.

/** A player's pick in the daily challenge. */
export interface DailyPick {
  userId: string;
  date: string; // ISO date, e.g. "2026-06-02"
  playerId: string;
  submittedAt: string; // ISO timestamp
}
