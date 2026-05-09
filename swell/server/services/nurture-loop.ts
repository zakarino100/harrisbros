/**
 * Nurture loop — fires due nurture jobs every minute.
 * Started once from server/index.ts. Single setInterval, in-process.
 */
import {
  getDueNurtureJobs,
  getTenantById,
  getLeadByIdForTenant,
  markNurtureJobFired,
  logActivity,
} from "../db/queries.js";
import { fireNurtureJob } from "./conversation.js";

const TICK_MS = Number(process.env.NURTURE_TICK_MS || 60_000);

let running = false;

export function startNurtureLoop() {
  if (running) return;
  running = true;
  console.log(`[nurture] loop started (every ${Math.round(TICK_MS / 1000)}s)`);
  setInterval(tick, TICK_MS);
  // Fire one tick on boot so we don't wait the full interval
  setTimeout(tick, 5_000);
}

async function tick() {
  let jobs;
  try {
    jobs = await getDueNurtureJobs(20);
  } catch (err) {
    console.error("[nurture] getDueNurtureJobs failed:", err);
    return;
  }
  if (!jobs.length) return;

  console.log(`[nurture] firing ${jobs.length} job(s)`);
  for (const job of jobs) {
    try {
      const tenant = await getTenantById(job.tenant_id);
      const lead = tenant ? await getLeadByIdForTenant(tenant.id, job.lead_id) : undefined;
      if (!tenant || !lead) {
        await markNurtureJobFired(job.id, false, "tenant or lead missing");
        continue;
      }
      const result = await fireNurtureJob({
        tenant,
        lead,
        conversationId: job.conversation_id ?? 0,
        kind: job.kind,
      });
      await markNurtureJobFired(job.id, !!result.ok, result.ok ? null : result.reason ?? null);

      await logActivity({
        lead_id: lead.id,
        tenant_id: tenant.id,
        type: result.ok ? "nurture_fired" : "nurture_skipped",
        direction: "internal",
        body: `${job.kind}: ${result.ok ? "sent" : `skipped — ${result.reason}`}`,
        metadata: { jobId: job.id, kind: job.kind, result },
      });
    } catch (err: any) {
      console.error(`[nurture] job ${job.id} threw:`, err);
      await markNurtureJobFired(job.id, false, String(err?.message ?? err));
    }
  }
}
