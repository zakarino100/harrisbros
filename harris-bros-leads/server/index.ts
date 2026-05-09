import "dotenv/config";
import express from "express";
import cors from "cors";
import { db } from "./db.js";
import { fetchGraphLead, parseFieldData } from "./facebook.js";
import { sendSms } from "./twilio.js";
import type { LeadRecord } from "./types.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const appPassword = process.env.APP_PASSWORD || "";

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  const expected = `Basic ${Buffer.from(`admin:${appPassword}`).toString("base64")}`;
  if (!appPassword || authHeader !== expected) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Harris Bros Leads"');
    return res.status(401).send("Authentication required");
  }
  next();
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/facebook/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post("/api/facebook/webhook", async (req, res) => {
  res.sendStatus(200);

  const body = req.body as any;
  if (!body || body.object !== "page") return;

  for (const entry of body.entry ?? []) {
    const pageId = String(entry.id ?? "");
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") continue;

      const value = change.value ?? {};
      const leadgenId = String(value.leadgen_id ?? "");
      if (!leadgenId) continue;

      const existing = db.prepare("SELECT id FROM leads WHERE meta_lead_id = ?").get(leadgenId);
      if (existing) continue;

      try {
        const graphLead = await fetchGraphLead(leadgenId);
        const parsed = parseFieldData(graphLead.field_data ?? []);

        const insert = db.prepare(`
          INSERT INTO leads (
            meta_lead_id, meta_page_id, meta_form_id, meta_campaign_id, meta_adset_id, meta_ad_id,
            full_name, phone, email, address, city, state, zip, raw_payload
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = insert.run(
          leadgenId,
          pageId || null,
          String(value.form_id ?? graphLead.form_id ?? "") || null,
          String(value.campaign_id ?? graphLead.campaign_id ?? "") || null,
          String(value.adset_id ?? graphLead.adset_id ?? "") || null,
          String(value.ad_id ?? graphLead.ad_id ?? "") || null,
          parsed.fullName,
          parsed.phone,
          parsed.email,
          parsed.address,
          parsed.city,
          parsed.state,
          parsed.zip,
          JSON.stringify(graphLead)
        );

        const leadId = Number(result.lastInsertRowid);
        const alertPhone = process.env.ROWDY_ALERT_PHONE;
        if (alertPhone) {
          const smsBody = [
            "New Facebook Lead",
            `Name: ${parsed.fullName || "Unknown"}`,
            `Phone: ${parsed.phone || "—"}`,
            `Email: ${parsed.email || "—"}`,
            `Submitted: ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`,
          ].join("\n");

          await sendSms(alertPhone, smsBody);
          db.prepare("UPDATE leads SET sms_alert_sent = 1, sms_alert_sent_at = CURRENT_TIMESTAMP WHERE id = ?").run(leadId);
        }
      } catch (error) {
        console.error("[facebook webhook]", error);
      }
    }
  }
});

app.get("/api/leads", requireAuth, (_req, res) => {
  const leads = db.prepare("SELECT * FROM leads ORDER BY datetime(created_at) DESC").all() as LeadRecord[];
  res.json(leads.map((lead) => ({
    ...lead,
    raw_payload: undefined,
  })));
});

app.get("/api/leads/:id", requireAuth, (req, res) => {
  const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(req.params.id) as LeadRecord | undefined;
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  res.json({ ...lead, raw_payload: JSON.parse(lead.raw_payload) });
});

app.get("/", requireAuth, (_req, res) => {
  const leads = db.prepare("SELECT * FROM leads ORDER BY datetime(created_at) DESC LIMIT 100").all() as LeadRecord[];

  const rows = leads.map((lead) => `
    <tr>
      <td>${lead.created_at}</td>
      <td>${lead.full_name ?? ""}</td>
      <td>${lead.phone ?? ""}</td>
      <td>${lead.email ?? ""}</td>
      <td>${lead.city ?? ""}${lead.state ? `, ${lead.state}` : ""}</td>
      <td>${lead.meta_form_id ?? ""}</td>
      <td>${lead.sms_alert_sent ? "Yes" : "No"}</td>
    </tr>
  `).join("");

  res.send(`<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>Harris Bros Leads</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; background: #111827; color: #f9fafb; }
        h1 { margin-bottom: 8px; }
        p { color: #d1d5db; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; background: #1f2937; }
        th, td { padding: 12px; border-bottom: 1px solid #374151; text-align: left; font-size: 14px; }
        th { background: #000; color: #fbbf24; }
        tr:hover { background: #111827; }
      </style>
    </head>
    <body>
      <h1>Harris Bros Lead Submissions</h1>
      <p>Newest Facebook leads first. Simple dashboard for Rowdy.</p>
      <table>
        <thead>
          <tr>
            <th>Submitted</th>
            <th>Name</th>
            <th>Phone</th>
            <th>Email</th>
            <th>Location</th>
            <th>Form ID</th>
            <th>SMS Sent</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </body>
  </html>`);
});

app.listen(port, () => {
  console.log(`Harris Bros Leads running on port ${port}`);
});
