/**
 * Cookie-based per-tenant auth.
 *
 * Cookie name:  swell_auth_<tenantId>
 * Cookie value: signed token = tenantId:hmac (so a stolen cookie from one
 *               tenant can't be used on another — defense in depth).
 *
 * For now we use a simple HMAC over (tenantId, password_hash) — if either
 * changes the cookie auto-invalidates.
 *
 * User-based auth:
 *   - Cookie name: swell_user_<tenantId>
 *   - Cookie value: base64(JSON) with userId, role, tenantId
 *   - Role from swell_users table: admin|rep|viewer
 */
import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { getTenantById, type Tenant } from "../db/queries.js";

const SECRET = () => process.env.SWELL_COOKIE_SECRET || "dev-only-cookie-secret-please-set-in-prod";
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function cookieNameForTenant(tenantId: string): string {
  return `swell_auth_${tenantId}`;
}

function sign(tenantId: string, passwordHash: string): string {
  const payload = `${tenantId}:${Date.now()}`;
  const h = crypto.createHmac("sha256", `${SECRET()}::${passwordHash}`);
  h.update(payload);
  return `${payload}.${h.digest("hex")}`;
}

function verify(token: string, tenantId: string, passwordHash: string): boolean {
  if (!token || typeof token !== "string") return false;
  const dotIdx = token.lastIndexOf(".");
  if (dotIdx <= 0) return false;
  const payload = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);

  const [tenantInToken /* , timestampInToken */] = payload.split(":");
  if (tenantInToken !== tenantId) return false;

  const h = crypto.createHmac("sha256", `${SECRET()}::${passwordHash}`);
  h.update(payload);
  const expected = h.digest("hex");

  // constant-time compare
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
}

export function setAuthCookie(res: Response, tenant: Tenant) {
  const token = sign(tenant.id, tenant.password_hash);
  res.cookie(cookieNameForTenant(tenant.id), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_MS,
    path: "/",
  });
}

export function clearAuthCookie(res: Response, tenantId: string) {
  res.clearCookie(cookieNameForTenant(tenantId), { path: "/" });
}

export async function checkPassword(tenant: Tenant, password: string): Promise<boolean> {
  if (!password) return false;
  return bcrypt.compare(password, tenant.password_hash);
}

export function isAuthenticated(req: Request): boolean {
  if (!req.tenant) return false;
  
  // Check legacy tenant cookie (admin access)
  const token = req.cookies?.[cookieNameForTenant(req.tenant.id)];
  if (token && verify(token, req.tenant.id, req.tenant.password_hash)) {
    return true;
  }
  
  // Check user cookie
  const userCookie = req.cookies?.[`swell_user_${req.tenant.id}`];
  if (userCookie) {
    try {
      const data = JSON.parse(Buffer.from(userCookie, 'base64').toString());
      return data.tenantId === req.tenant.id;
    } catch {
      return false;
    }
  }
  
  return false;
}

/**
 * Get the role of the currently authenticated session.
 * Returns 'admin' for legacy tenant login, or the user's role from swell_users.
 * Returns 'none' if not authenticated.
 */
export function getSessionRole(req: Request): string {
  if (!req.tenant) return "none";
  
  // Legacy tenant cookie = admin role
  const token = req.cookies?.[cookieNameForTenant(req.tenant.id)];
  if (token && verify(token, req.tenant.id, req.tenant.password_hash)) {
    return "admin";
  }
  
  // User cookie
  const userCookie = req.cookies?.[`swell_user_${req.tenant.id}`];
  if (userCookie) {
    try {
      const data = JSON.parse(Buffer.from(userCookie, 'base64').toString());
      if (data.tenantId === req.tenant.id) {
        return data.role ?? "rep";
      }
    } catch {}
  }
  
  return "none";
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.tenant) return res.status(400).json({ error: "Tenant required" });
  if (!isAuthenticated(req)) {
    if (req.path.startsWith("/api/")) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    return res.redirect("/login");
  }
  next();
}

/**
 * Require specific role(s). Use after requireAuth.
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = getSessionRole(req);
    if (roles.includes(role) || role === "admin") return next();
    return res.status(403).json({ error: "Insufficient permissions" });
  };
}

// Convenience: lookup tenant + verify password (for /login endpoint)
export async function authenticate(tenantId: string, password: string): Promise<Tenant | null> {
  const tenant = await getTenantById(tenantId);
  if (!tenant) return null;
  const ok = await checkPassword(tenant, password);
  return ok ? tenant : null;
}
