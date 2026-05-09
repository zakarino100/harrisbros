import path from "node:path";
import url from "node:url";
import { Router, type Request, type Response } from "express";
import { getReviewFollowByToken } from "../db/queries.js";
import { sql } from "../db/index.js";

const router = Router();
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// Public feedback form — no auth required
router.get("/feedback/:token", async (req: Request, res: Response) => {
  try {
    const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
    const rf = await getReviewFollowByToken(token);
    if (!rf || rf.status === "closed") {
      return res.status(404).send(feedbackHtml("Not Found", "This feedback link has expired or is not valid.", false));
    }
    const tenantName = (req as any).tenant?.name ?? "your service provider";
    res.send(feedbackHtml(tenantName, null, true, token));
  } catch (err) {
    console.error("[feedback] GET error:", err);
    res.status(500).send(feedbackHtml("Error", "Something went wrong. Please try again.", false));
  }
});

router.post("/feedback/:token", async (req: Request, res: Response) => {
  try {
    const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
    const rf = await getReviewFollowByToken(token);
    if (!rf) return res.status(404).json({ error: "Invalid token" });

    const { rating, comment } = req.body ?? {};
    const ratingNum = parseInt(rating, 10);
    if (!ratingNum || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).send(feedbackHtml("Error", "Please select a rating.", false));
    }

    await sql`
      INSERT INTO swell_feedback_submissions (review_follow_id, tenant_id, lead_id, rating, comment)
      VALUES (${rf.id}, ${rf.tenant_id}, ${rf.lead_id}, ${ratingNum}, ${comment ?? null})
    `;
    await sql`UPDATE swell_review_follows SET status = 'closed' WHERE id = ${rf.id}`;

    res.send(feedbackHtml("Thank you!", "Your feedback has been received. We'll be in touch.", false));
  } catch (err) {
    console.error("[feedback] POST error:", err);
    res.status(500).send(feedbackHtml("Error", "Something went wrong. Please try again.", false));
  }
});

function feedbackHtml(title: string, message: string | null, showForm: boolean, token?: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0a;color:#fff;font-family:system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
.card{background:#111827;border:1px solid #1f2937;border-radius:16px;padding:32px;width:100%;max-width:480px}
h1{color:#fbbf24;font-size:22px;margin-bottom:8px}
p{color:#9ca3af;font-size:14px;margin-bottom:20px}
.stars{display:flex;gap:8px;margin-bottom:16px}
.star{font-size:32px;cursor:pointer;opacity:0.3;transition:opacity 0.15s}
.star.active{opacity:1}
textarea{width:100%;background:#0a0a0a;border:1px solid #374151;color:#fff;border-radius:8px;padding:12px;font-size:14px;min-height:100px;resize:vertical;margin-bottom:16px}
button{width:100%;padding:12px;background:#fbbf24;color:#000;font-weight:700;border:0;border-radius:8px;font-size:15px;cursor:pointer}
</style></head><body>
<div class="card">
<h1>${title}</h1>
${message ? `<p>${message}</p>` : ""}
${
  showForm
    ? `
<form method="POST" action="/feedback/${token}">
<p>How would you rate your experience?</p>
<div class="stars" id="stars">
  <span class="star" data-v="1">⭐</span>
  <span class="star" data-v="2">⭐</span>
  <span class="star" data-v="3">⭐</span>
  <span class="star" data-v="4">⭐</span>
  <span class="star" data-v="5">⭐</span>
</div>
<input type="hidden" name="rating" id="rating" value="">
<textarea name="comment" placeholder="Tell us what happened (optional)..."></textarea>
<button type="submit">Submit Feedback</button>
</form>
<script>
document.querySelectorAll('.star').forEach(s=>{
  s.addEventListener('click',()=>{
    const v=+s.dataset.v;
    document.getElementById('rating').value=v;
    document.querySelectorAll('.star').forEach((x,i)=>x.classList.toggle('active',i<v));
  });
});
</script>`
    : ""
}
</div></body></html>`;
}

export default router;
