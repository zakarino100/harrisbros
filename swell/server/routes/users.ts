/**
 * User management API endpoints.
 * Allows tenant admins to create, list, and update team member accounts.
 */
import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { requireTenant } from "../middleware/tenant.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { listUsers, createUser, updateUser, getUserByEmail } from "../db/queries.js";

const router = Router();

router.use(requireTenant, requireAuth);

/**
 * GET /api/users
 * List all users for the tenant (admin only)
 */
router.get("/api/users", requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const users = await listUsers(req.tenant!.id);
    res.json(users);
  } catch (error) {
    console.error("[users:list]", error);
    res.status(500).json({ error: "Failed to list users" });
  }
});

/**
 * POST /api/users
 * Create a new user (admin only)
 * Body: { name, email, password, role }
 */
router.post("/api/users", requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const { name, email, password, role } = req.body ?? {};
    
    // Validate inputs
    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email, password required" });
    }
    
    const validRoles = ["admin", "rep", "viewer"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: "role must be admin, rep, or viewer" });
    }
    
    // Check if user already exists
    const existing = await getUserByEmail(req.tenant!.id, email);
    if (existing) {
      return res.status(409).json({ error: "User already exists with this email" });
    }
    
    // Hash password and create user
    const hash = await bcrypt.hash(password, 10);
    const id = await createUser({
      tenant_id: req.tenant!.id,
      name,
      email,
      password_hash: hash,
      role,
    });
    
    res.json({ ok: true, id });
  } catch (error) {
    console.error("[users:create]", error);
    res.status(500).json({ error: "Failed to create user" });
  }
});

/**
 * PATCH /api/users/:id
 * Update an existing user (admin only)
 * Body: { name?, role?, enabled?, password? }
 */
router.patch("/api/users/:id", requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { name, role, enabled, password } = req.body ?? {};
    
    const patch: any = {};
    if (name !== undefined) patch.name = name;
    if (role !== undefined) {
      const validRoles = ["admin", "rep", "viewer"];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: "role must be admin, rep, or viewer" });
      }
      patch.role = role;
    }
    if (enabled !== undefined) patch.enabled = enabled;
    if (password) patch.password_hash = await bcrypt.hash(password, 10);
    
    await updateUser(id, req.tenant!.id, patch);
    res.json({ ok: true });
  } catch (error) {
    console.error("[users:update]", error);
    res.status(500).json({ error: "Failed to update user" });
  }
});

export default router;
