/**
 * Lead scoring — applies point deltas for key events.
 * Score is clamped 0-100. repeat_probability: hot≥75, warm≥45, cold<45.
 */
import { updateLeadScore } from "../db/queries.js";

export const SCORE_EVENTS = {
  job_completed:        +20,
  review_positive:      +30,   // 4-5 star follow-up
  review_left:          +15,   // actually left Google review (future tracking)
  review_negative:      -25,   // 1-2 star follow-up
  conversation_engaged: +5,    // replied to Hayden
  no_show:              -15,
  ghosted_followup:     -10,
  repeat_customer:      +25,
} as const;

export type ScoreEvent = keyof typeof SCORE_EVENTS;

export async function applyScoreEvent(
  tenantId: string,
  leadId: number,
  event: ScoreEvent,
  satisfactionScore?: number,
): Promise<void> {
  const delta = SCORE_EVENTS[event];
  await updateLeadScore(tenantId, leadId, delta, satisfactionScore);
  console.log(`[scoring] Lead ${leadId} ${event} → ${delta > 0 ? '+' : ''}${delta}`);
}
