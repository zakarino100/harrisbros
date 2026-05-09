/**
 * Tenant resolution middleware.
 *
 * Strategy:
 *   1. Read req.hostname (e.g. "mackwash.nopressurelaunch.com")
 *   2. Strip the apex/parent domain to get the slug ("mackwash")
 *   3. Look up tenant by slug
 *   4. Attach tenant to req
 *
 * Local dev override:
 *   X-Tenant-Slug header forces a tenant for testing.
 */
import type { Request, Response, NextFunction } from "express";
import { getTenantBySlug, type Tenant } from "../db/queries.js";

declare module "express-serve-static-core" {
  interface Request {
    tenant?: Tenant;
    isSuperAdmin?: boolean;
  }
}

const APEX = process.env.SWELL_APEX_DOMAIN || "nopressurelaunch.com";

export function extractSlugFromHost(host: string): string | null {
  if (!host) return null;
  const lower = host.toLowerCase().split(":")[0];

  // Local dev: localhost / 127.0.0.1 → no tenant from host (use header)
  if (lower === "localhost" || lower === "127.0.0.1") return null;

  // Apex itself → no tenant (admin landing page)
  if (lower === APEX) return null;

  // <slug>.<APEX> → slug
  if (lower.endsWith(`.${APEX}`)) {
    const slug = lower.slice(0, -1 - APEX.length);
    // Ignore "www" / "swell" subdomains — those are admin/marketing
    if (slug === "www" || slug === "swell" || slug === "admin") return null;
    return slug;
  }

  // Replit-internal preview URLs (e.g. *.replit.app) — fall through to header
  if (lower.endsWith(".replit.app") || lower.endsWith(".replit.dev")) return null;

  return null;
}

export async function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  // Check if this is a super admin request (systemadmin subdomain)
  const lowerHost = req.hostname.toLowerCase().split(":")[0];
  if (lowerHost === "systemadmin" || lowerHost.includes("admin."+ APEX)) {
    req.isSuperAdmin = true;
    return next();
  }

  // Header override for local dev / testing
  const headerSlug = req.header("x-tenant-slug")?.trim().toLowerCase();
  const slug = headerSlug || extractSlugFromHost(req.hostname);

  if (!slug) {
    // No tenant yet — route handlers can decide whether that's OK
    return next();
  }

  const tenant = await getTenantBySlug(slug);
  if (!tenant) {
    // Unknown subdomain — 404 at the API/SPA boundary
    return res.status(404).send(`Unknown tenant: ${slug}`);
  }

  req.tenant = tenant;
  next();
}

export function requireTenant(req: Request, res: Response, next: NextFunction) {
  if (!req.tenant) {
    return res.status(400).json({ error: "Tenant required" });
  }
  next();
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  // Only enforce on /admin/* paths — let non-admin routes pass through
  if (!req.path.startsWith("/admin")) return next();

  const adminSecret = process.env.SWELL_ADMIN_SECRET;
  if (!adminSecret) {
    return res.status(503).json({ error: "Super admin not configured — set SWELL_ADMIN_SECRET" });
  }
  
  // Check header or cookie
  const headerSecret = req.header("x-admin-secret")?.trim();
  const cookieSecret = req.cookies?.admin_secret;
  const providedSecret = headerSecret || cookieSecret;
  
  if (!providedSecret || providedSecret !== adminSecret) {
    return res.status(403).json({ error: "Invalid admin credentials" });
  }
  
  next();
}
