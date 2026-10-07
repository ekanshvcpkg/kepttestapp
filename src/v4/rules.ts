export type ProofGate = { status: number; member: boolean; day: number; numDays: number; startTs: number; daySeconds: number; now: number; alreadyRecorded: boolean };

export function proofRejection(input: ProofGate): string | null {
  if (!input.member) return "non_member";
  if (input.status !== 1) return "not_active";
  if (!Number.isInteger(input.day) || input.day < 0 || input.day >= input.numDays) return "wrong_day";
  const current = Math.floor((input.now - input.startTs) / input.daySeconds);
  if (current !== input.day) return "outside_day_window";
  if (input.alreadyRecorded) return "duplicate";
  return null;
}

export function nudgeRejection(input: { member: boolean; recipientMember: boolean; self: boolean; day: number; currentDay: number; alreadyCheckedIn: boolean }): string | null {
  if (!input.member || !input.recipientMember || input.self) return "invalid_member";
  if (input.day !== input.currentDay) return "wrong_day";
  if (input.alreadyCheckedIn) return "already_checked_in";
  return null;
}
