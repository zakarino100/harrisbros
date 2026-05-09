/**
 * Login / logout routes.
 * Per-tenant: tenant resolved from req.hostname before reaching here.
 */
import path from "node:path";
import url from "node:url";
import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { authenticate, setAuthCookie, clearAuthCookie, isAuthenticated, getSessionRole } from "../middleware/auth.js";
import { requireTenant } from "../middleware/tenant.js";
import { getUserByEmail, markUserLogin } from "../db/queries.js";

const router = Router();

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../../client");

router.get("/login", requireTenant, (req: Request, res: Response) => {
  if (isAuthenticated(req)) return res.redirect("/");
  // Serve the React SPA — it reads /api/me and renders the login form
  res.sendFile(path.join(clientDist, "index.html"), (err) => {
    if (err) res.status(500).send("Build not found — run npm run build");
  });
});

router.post("/login", requireTenant, async (req: Request, res: Response) => {
  const { password, email } = req.body ?? {};
  
  // User-based login: email + password
  if (email && password) {
    const user = await getUserByEmail(req.tenant!.id, email);
    if (!user) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }
    await markUserLogin(user.id);
    // Set user cookie
    const cookieVal = Buffer.from(JSON.stringify({ userId: user.id, role: user.role, tenantId: req.tenant!.id })).toString('base64');
    res.cookie(`swell_user_${req.tenant!.id}`, cookieVal, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    });
    return res.json({ ok: true, role: user.role });
  }
  
  // Legacy tenant password-only login
  if (!password || typeof password !== "string") {
    return res.status(400).json({ ok: false, error: "Password required" });
  }
  const tenant = await authenticate(req.tenant!.id, password);
  if (!tenant) {
    return res.status(401).json({ ok: false, error: "Wrong password" });
  }
  setAuthCookie(res, tenant);
  return res.json({ ok: true, role: "admin" });
});

router.post("/logout", (req: Request, res: Response) => {
  if (req.tenant) clearAuthCookie(res, req.tenant.id);
  return res.json({ ok: true });
});

router.get("/api/me", requireTenant, (req: Request, res: Response) => {
  // Returns tenant + auth state + role — used by the SPA on boot
  const t = req.tenant!;
  return res.json({
    tenant: {
      id: t.id,
      name: t.name,
      slug: t.slug,
      brandColor: t.brand_color,
      accentColor: t.accent_color,
      logoUrl: t.logo_url,
    },
    authenticated: isAuthenticated(req),
    role: getSessionRole(req),
  });
});

export default router;

// ─── Inline minimal HTML for the /login GET (SPA bootstraps from this) ─────────

function loginShell(tenantName: string, brandColor: string): string {
  // Bare-bones shell; the real polished login UI is in the React SPA.
  // This exists so the server-rendered fallback works even before JS loads.
  const safeName = String(tenantName).replace(/[<>&"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" } as Record<string, string>)[c] ?? c
  );
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safeName} — Swell</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>html{background:#0a0a0a;color:#fff;font-family:system-ui}body{display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
  .c{background:#111827;padding:32px;border:1px solid #1f2937;border-radius:16px;width:340px;max-width:90vw;text-align:center}
  h1{color:${brandColor};margin:0 0 4px;font-size:20px;letter-spacing:.02em}
  p{color:#9ca3af;font-size:13px;margin:0 0 18px}
  input{width:100%;padding:11px 12px;margin:6px 0 10px;background:#0a0a0a;border:1px solid #374151;border-radius:8px;color:#fff;font-size:14px;box-sizing:border-box}
  button{width:100%;padding:11px;background:${brandColor};color:#000;font-weight:700;border:0;border-radius:8px;cursor:pointer;font-size:14px}
  .err{color:#fca5a5;font-size:12px;margin-top:8px;min-height:16px}</style></head>
  <body><form class="c" method="post" action="/login">
  <h1>${safeName}</h1><p>Lead Command — Swell by Blue Ocean</p>
  <input name="password" type="password" placeholder="Password" autofocus required>
  <button type="submit">Sign in</button>
  </form></body></html>`;
}
