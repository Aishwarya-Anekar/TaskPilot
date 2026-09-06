import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import pool, { initDb } from "../db.js";
import {
  authenticate,
  requireAdmin,
  AuthRequest,
} from "../middleware/auth.js";
import { createNotifications, notifyTaskAudience } from "../notifications.js";
import { sendWelcomeEmail } from "../email.js";
import crypto from "crypto";
import { sendVerificationEmail } from "../email.js";
import { isEmail, isNonEmptyString, parsePositiveId, passwordError, isOneOf, USER_ROLES } from "../validation.js";

const router = Router();

const BLOCKING_BOOKING_STATUSES = ["Approved", "Active", "Confirmed"];

function validateBookingTimes(startTime: unknown, endTime: unknown): { startTime: string; endTime: string } | null {
  if (typeof startTime !== "string" || typeof endTime !== "string" || !startTime.trim() || !endTime.trim()) {
    return null;
  }

  const start = Date.parse(startTime);
  const end = Date.parse(endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    return null;
  }

  return { startTime: startTime.trim(), endTime: endTime.trim() };
}

async function lockResources(client: import("pg").PoolClient, resourceIds: number[]) {
  for (const resourceId of [...new Set(resourceIds)].sort((a, b) => a - b)) {
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [resourceId]);
  }
}

async function findBookingConflict(
  client: import("pg").PoolClient,
  resourceId: number,
  startTime: string,
  endTime: string,
  excludedBookingId?: number
) {
  const params: unknown[] = [resourceId, startTime, endTime, BLOCKING_BOOKING_STATUSES];
  const exclusion = excludedBookingId ? "AND id <> $5" : "";
  if (excludedBookingId) params.push(excludedBookingId);

  return client.query(
    `SELECT id, start_time, end_time
     FROM resource_bookings
     WHERE resource_id = $1
       AND status = ANY($4::varchar[])
       AND start_time < $3::timestamp
       AND end_time > $2::timestamp
       ${exclusion}
     ORDER BY start_time ASC
     LIMIT 1`,
    params
  );
}

function conflictMessage(conflict: { start_time: string; end_time: string }) {
  return `This resource is already booked from ${new Date(conflict.start_time).toLocaleString()} to ${new Date(conflict.end_time).toLocaleString()} during the selected time period.`;
}

// All admin routes require authentication
router.use(authenticate);

// ==========================================
// SUPER ADMIN & SYSTEM LOGS SECTION
// ==========================================

// GET /api/admin/logs - Fetch all system activity logs (Super Admin only)
router.get("/logs", async (req: AuthRequest, res: Response) => {
  try {
    if (req.userRole !== "super_admin") {
      res.status(403).json({ error: "Super Admin access required" });
      return;
    }
    const result = await pool.query(
      `SELECT al.*, u.name as user_name, u.email as user_email, u.role as user_role
       FROM activity_logs al
       LEFT JOIN users u ON al.user_id = u.id
       ORDER BY al.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch activity logs error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/reseed - Check schema and seed missing demo data (Super Admin only)
router.post("/reseed", async (req: AuthRequest, res: Response) => {
  try {
    if (req.userRole !== "super_admin") {
      res.status(403).json({ error: "Super Admin access required" });
      return;
    }
    console.log("Super Admin triggered a safe database schema and seed check...");
    await initDb();
    res.json({ message: "Database schema and seed data checked successfully" });
  } catch (err) {
    console.error("Database schema and seed check error:", err);
    res.status(500).json({ error: "Server error during database schema check" });
  }
});

// ==========================================
// DASHBOARD STATS
// ==========================================

// GET /api/admin/stats - Organization stats for admin & super admin
router.get("/stats", async (req: AuthRequest, res: Response) => {
  try {
    const totalEvents = await pool.query("SELECT COUNT(*) FROM events");
    const totalTasks = await pool.query("SELECT COUNT(*) FROM tasks");
    const completedTasks = await pool.query("SELECT COUNT(*) FROM tasks WHERE status = 'Completed'");
    const pendingTasks = await pool.query("SELECT COUNT(*) FROM tasks WHERE status IN ('Pending', 'In Progress', 'Under Review')");
    const totalDepartments = await pool.query("SELECT COUNT(*) FROM departments");
    const totalEmployees = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'employee'");

    const eventsCount = parseInt(totalEvents.rows[0].count);
    const tasksCount = parseInt(totalTasks.rows[0].count);
    const completedCount = parseInt(completedTasks.rows[0].count);
    const solvedPercent = tasksCount > 0 ? Math.round((completedCount / tasksCount) * 100) : 0;

    res.json({
      total: tasksCount,
      solved_percent: solvedPercent,
      pending: parseInt(pendingTasks.rows[0].count),
      rejected: eventsCount, // send total events as 'rejected' count to reuse card slots on homepage cleanly, or restructure
      total_events: eventsCount,
      total_departments: parseInt(totalDepartments.rows[0].count),
      total_employees: parseInt(totalEmployees.rows[0].count)
    });
  } catch (err) {
    console.error("Admin stats error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET/PUT /api/admin/escalation-settings - Configure escalation delays in hours
router.get("/escalation-settings", requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query("SELECT stage_2_hours, stage_3_hours, updated_at FROM escalation_settings WHERE id = 1");
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Get escalation settings error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/escalation-settings", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const stage2 = Number(req.body.stage_2_hours);
    const stage3 = Number(req.body.stage_3_hours);
    if (!Number.isInteger(stage2) || !Number.isInteger(stage3) || stage2 <= 0 || stage3 <= stage2) {
      res.status(400).json({ error: "Stage 2 must be positive and Stage 3 must be greater than Stage 2" });
      return;
    }
    const result = await pool.query(
      `UPDATE escalation_settings SET stage_2_hours = $1, stage_3_hours = $2, updated_by = $3, updated_at = NOW()
       WHERE id = 1 RETURNING stage_2_hours, stage_3_hours, updated_at`, [stage2, stage3, req.userId]
    );
    await pool.query("INSERT INTO activity_logs (user_id, action, details) VALUES ($1, 'Update Escalation Settings', $2)", [req.userId, `Escalation intervals set to ${stage2}h and ${stage3}h.`]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update escalation settings error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ==========================================
// DEPARTMENTS MANAGEMENT
// ==========================================

// GET /api/admin/departments - List all departments
router.get("/departments", async (_req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query("SELECT * FROM departments ORDER BY name ASC");
    res.json(result.rows);
  } catch (err) {
    console.error("List departments error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/departments - Create department (Admins only)
router.post("/departments", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      res.status(400).json({ error: "Department name is required" });
      return;
    }
    const result = await pool.query(
      "INSERT INTO departments (name, description) VALUES ($1, $2) RETURNING *",
      [name, description || ""]
    );
    
    await pool.query(
      "INSERT INTO activity_logs (user_id, action, details) VALUES ($1, 'Create Department', $2)",
      [req.userId, `Department "${name}" created`]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create department error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/admin/departments/:id - Update department
router.put("/departments/:id", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    const result = await pool.query(
      `UPDATE departments SET name = COALESCE($1, name), description = COALESCE($2, description)
       WHERE id = $3 RETURNING *`,
      [name, description, id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update department error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /api/admin/departments/:id - Delete department
router.delete("/departments/:id", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM departments WHERE id = $1 RETURNING *", [id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    res.json({ message: "Department deleted successfully" });
  } catch (err) {
    console.error("Delete department error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ==========================================
// EMPLOYEES / USERS MANAGEMENT
// ==========================================

// GET /api/admin/employees - Fetch all employee details
router.get("/employees", async (_req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.semester, u.email_verified, d.name as department, d.id as department_id
       FROM users u
       LEFT JOIN departments d ON u.department_id = d.id
       ORDER BY u.name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("List employees error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/employees/:id/resend-verification", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query("SELECT id, name, email, email_verified FROM users WHERE id = $1", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "User not found" });
    if (result.rows[0].email_verified) return res.json({ message: "User email is already verified." });
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await pool.query("UPDATE email_verification_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL", [req.params.id]);
    await pool.query("INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '24 hours')", [req.params.id, tokenHash]);
    try { await sendVerificationEmail(result.rows[0], rawToken); } catch (error) { console.error("Admin verification email failed:", error instanceof Error ? error.message : "Unknown email error"); }
    res.json({ message: "Verification email request processed." });
  } catch (error) { console.error("Admin resend verification error:", error); res.status(500).json({ error: "Server error" }); }
});

// POST /api/admin/employees - Create a new user (employee/dept_head/admin)
router.post("/employees", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, email, password, role, department_id } = req.body;
    if (!isNonEmptyString(name) || !isNonEmptyString(email) || !isNonEmptyString(password) || !isNonEmptyString(role)) {
      res.status(400).json({ error: "Name, email, password, and role are required" });
      return;
    }
    if (!isEmail(email)) {
      res.status(400).json({ error: "A valid email address is required" });
      return;
    }
    const passwordIssue = passwordError(password);
    if (passwordIssue) {
      res.status(400).json({ error: passwordIssue });
      return;
    }
    if (!isOneOf(role, USER_ROLES) || role === "super_admin") {
      res.status(400).json({ error: "Invalid user role" });
      return;
    }
    const departmentId = department_id == null || department_id === "" ? null : parsePositiveId(department_id);
    if (department_id != null && department_id !== "" && !departmentId) {
      res.status(400).json({ error: "Department ID must be a valid positive integer" });
      return;
    }
    if (departmentId) {
      const department = await pool.query("SELECT id FROM departments WHERE id = $1", [departmentId]);
      if (!department.rows.length) {
        res.status(404).json({ error: "Department not found" });
        return;
      }
    }
    const normalizedEmail = email.trim().toLowerCase();

    const check = await pool.query("SELECT id FROM users WHERE LOWER(email) = $1", [normalizedEmail]);
    if (check.rows.length > 0) {
      res.status(409).json({ error: "Email already exists" });
      return;
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, department_id, email_verified)
      VALUES ($1, $2, $3, $4, $5, false) RETURNING id, name, email, role, department_id`,
              [name.trim(), normalizedEmail, hash, role, departmentId]
    );

    await pool.query(
      "INSERT INTO activity_logs (user_id, action, details) VALUES ($1, 'Create User', $2)",
      [req.userId, `Registered user "${name}" with role "${role}"`]
    );

    await sendWelcomeEmail(result.rows[0]);
    await pool.query("UPDATE users SET email_verified = false WHERE id = $1", [result.rows[0].id]);
    try {
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      await pool.query("INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '24 hours')", [result.rows[0].id, tokenHash]);
      await sendVerificationEmail(result.rows[0], token);
    } catch (error) { console.error("User verification email failed:", error instanceof Error ? error.message : "Unknown email error"); }
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create user error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/admin/employees/:id - Update user role / department (Admins/Super Admins)
router.put("/employees/:id", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, email, role, department_id } = req.body;
    const userId = parsePositiveId(id);
    if (!userId) return res.status(400).json({ error: "User ID must be a valid positive integer" });
    if (name !== undefined && !isNonEmptyString(name)) return res.status(400).json({ error: "Name cannot be empty" });
    if (email !== undefined && !isEmail(email)) return res.status(400).json({ error: "A valid email address is required" });
    if (role !== undefined && (!isOneOf(role, USER_ROLES) || role === "super_admin")) return res.status(400).json({ error: "Invalid user role" });
    const departmentId = department_id === undefined || department_id === null || department_id === "" ? department_id : parsePositiveId(department_id);
    if (department_id !== undefined && department_id !== null && department_id !== "" && !departmentId) return res.status(400).json({ error: "Department ID must be a valid positive integer" });
    if (departmentId) {
      const department = await pool.query("SELECT id FROM departments WHERE id = $1", [departmentId]);
      if (!department.rows.length) return res.status(404).json({ error: "Department not found" });
    }
    if (email !== undefined) {
      const duplicate = await pool.query("SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2", [email.trim().toLowerCase(), userId]);
      if (duplicate.rows.length) return res.status(409).json({ error: "Email already exists" });
    }

    const result = await pool.query(
      `UPDATE users SET
        name = COALESCE($1, name),
        email = COALESCE($2, email),
        role = COALESCE($3, role),
        department_id = COALESCE($4, department_id)
       WHERE id = $5 RETURNING id, name, email, role, department_id`,
      [name === undefined ? null : name.trim(), email === undefined ? null : email.trim().toLowerCase(), role, departmentId, userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update user error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /api/admin/employees/:id - Remove user
router.delete("/employees/:id", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM users WHERE id = $1 RETURNING *", [id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ message: "User deleted successfully" });
  } catch (err) {
    console.error("Delete user error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ==========================================
// RESOURCES SECTION
// ==========================================

// GET /api/admin/resources - Get list of resources & current bookings
router.get("/resources", async (_req: AuthRequest, res: Response) => {
  try {
    const resources = await pool.query("SELECT * FROM resources ORDER BY name ASC");
    const bookings = await pool.query(
      `SELECT rb.*, r.name as resource_name, e.title as event_title, u.name as booked_by_name
       FROM resource_bookings rb
       JOIN resources r ON rb.resource_id = r.id
       JOIN events e ON rb.event_id = e.id
       LEFT JOIN users u ON rb.booked_by = u.id
       ORDER BY rb.start_time ASC`
    );
    res.json({
      resources: resources.rows,
      bookings: bookings.rows
    });
  } catch (err) {
    console.error("List resources error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/resources - Add new resource
router.post("/resources", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, type } = req.body;
    if (!name || !type) {
      res.status(400).json({ error: "Resource name and type are required" });
      return;
    }
    const result = await pool.query(
      "INSERT INTO resources (name, type) VALUES ($1, $2) RETURNING *",
      [name, type]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create resource error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/resources/book - Book resource
router.post("/resources/book", async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  try {
    const { resource_id, event_id, start_time, end_time } = req.body;
    if (!resource_id || !event_id || !start_time || !end_time) {
      res.status(400).json({ error: "Resource ID, Event ID, start_time, and end_time are required" });
      return;
    }

    const times = validateBookingTimes(start_time, end_time);
    if (!times) {
      res.status(400).json({ error: "A valid start_time earlier than end_time is required" });
      return;
    }

    const resourceId = parsePositiveId(resource_id);
    const eventId = parsePositiveId(event_id);
    if (!resourceId || !eventId) {
      res.status(400).json({ error: "Resource ID and Event ID must be valid positive integers" });
      return;
    }

    const references = await pool.query(
      "SELECT (SELECT COUNT(*) FROM resources WHERE id = $1) AS resource_count, (SELECT COUNT(*) FROM events WHERE id = $2) AS event_count",
      [resourceId, eventId]
    );
    if (Number(references.rows[0].resource_count) === 0) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }
    if (Number(references.rows[0].event_count) === 0) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    await client.query("BEGIN");
    await lockResources(client, [resourceId]);
    const conflict = await findBookingConflict(client, resourceId, times.startTime, times.endTime);

    if (conflict.rows.length > 0) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: conflictMessage(conflict.rows[0]) });
      return;
    }

    const result = await client.query(
      `INSERT INTO resource_bookings (resource_id, event_id, booked_by, start_time, end_time, status)
       VALUES ($1, $2, $3, $4, $5, 'Approved') RETURNING *`,
      [resourceId, eventId, req.userId, times.startTime, times.endTime]
    );
    await client.query("COMMIT");

    const recipients = await pool.query(
      `SELECT DISTINCT id FROM users
       WHERE id = $1 OR id = (SELECT coordinator_id FROM events WHERE id = $2)
          OR role IN ('admin', 'super_admin')`,
      [req.userId, eventId]
    );
    await createNotifications(recipients.rows.map((recipient) => ({
      userId: recipient.id,
      type: "booking_status_changed",
      title: "Resource booking approved",
      message: "Your resource booking has been approved.",
      entityType: "event",
      entityId: eventId,
      dedupeKey: `booking:${result.rows[0].id}:status:Approved`,
    })));

    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Book resource error:", err);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

// PUT /api/admin/resources/bookings/:id - Update booking status or booking details
router.put("/resources/bookings/:id", requireAdmin, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  try {
    const { status, resource_id, event_id, start_time, end_time } = req.body;
    if (!['Pending', 'Approved', 'Active', 'Confirmed', 'Cancelled', 'Rejected'].includes(status)) {
      res.status(400).json({ error: "Invalid booking status" });
      return;
    }

    const bookingId = Number(req.params.id);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      res.status(400).json({ error: "Booking ID must be a valid positive integer" });
      return;
    }

    await client.query("BEGIN");
    const existingResult = await client.query(
      `SELECT id, resource_id, event_id, booked_by, start_time, end_time, status
       FROM resource_bookings WHERE id = $1 FOR UPDATE`,
      [bookingId]
    );
    if (!existingResult.rows.length) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Booking not found" });
      return;
    }

    const existing = existingResult.rows[0];
    const resourceId = resource_id === undefined ? existing.resource_id : parsePositiveId(resource_id);
    const eventId = event_id === undefined ? existing.event_id : parsePositiveId(event_id);
    if (!resourceId || !eventId) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "Resource ID and Event ID must be valid positive integers" });
      return;
    }

    const references = await client.query(
      "SELECT (SELECT COUNT(*) FROM resources WHERE id = $1) AS resource_count, (SELECT COUNT(*) FROM events WHERE id = $2) AS event_count",
      [resourceId, eventId]
    );
    if (Number(references.rows[0].resource_count) === 0 || Number(references.rows[0].event_count) === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: Number(references.rows[0].resource_count) === 0 ? "Resource not found" : "Event not found" });
      return;
    }

    const times = validateBookingTimes(start_time ?? existing.start_time, end_time ?? existing.end_time);
    if (!times) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "A valid start_time earlier than end_time is required" });
      return;
    }

    await lockResources(client, [existing.resource_id, resourceId]);
    if (BLOCKING_BOOKING_STATUSES.includes(status)) {
      const conflict = await findBookingConflict(client, resourceId, times.startTime, times.endTime, bookingId);
      if (conflict.rows.length > 0) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: conflictMessage(conflict.rows[0]) });
        return;
      }
    }

    const result = await client.query(
      `UPDATE resource_bookings
       SET status = $1, resource_id = $2, event_id = $3, start_time = $4, end_time = $5
       WHERE id = $6
       RETURNING id, event_id, booked_by, status`,
      [status, resourceId, eventId, times.startTime, times.endTime, bookingId]
    );
    await client.query("COMMIT");
    const booking = result.rows[0];
    await createNotifications([{
      userId: booking.booked_by,
      type: "booking_status_changed",
      title: "Resource booking status changed",
      message: `Your resource booking is now ${status.toLowerCase()}.`,
      entityType: "event",
      entityId: booking.event_id,
      dedupeKey: `booking:${booking.id}:status:${status}`,
    }]);
    res.json(booking);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Update booking error:", err);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

// PUT /api/admin/issues/:id - Keep for dashboard compatibility (updates status/priority of tasks)
router.put("/issues/:id", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status, priority, progress, assigned_to, assigned_department } = req.body;

    // Resolve name assigned_to to ID if possible
    let assignedToId = undefined;
    if (assigned_to) {
      const userRes = await pool.query("SELECT id FROM users WHERE name = $1", [assigned_to]);
      if (userRes.rows.length > 0) assignedToId = userRes.rows[0].id;
    }

    // Resolve department name to ID
    let assignedDeptId = undefined;
    if (assigned_department) {
      const deptRes = await pool.query("SELECT id FROM departments WHERE name = $1", [assigned_department]);
      if (deptRes.rows.length > 0) assignedDeptId = deptRes.rows[0].id;
    }

    const result = await pool.query(
      `UPDATE tasks SET
        status = COALESCE($1, status),
        priority = COALESCE($2, priority),
        progress = COALESCE($3, progress),
        assigned_to_id = COALESCE($4, assigned_to_id),
        assigned_dept_id = COALESCE($5, assigned_dept_id),
        updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [status, priority, progress, assignedToId, assignedDeptId, id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // Auto-create log/comment
    if (status) {
      await pool.query(
        "INSERT INTO task_comments (task_id, user_id, text) VALUES ($1, $2, $3)",
        [id, req.userId, `Status updated to "${status}" via Admin Panel.`]
      );
      await notifyTaskAudience(Number(id), {
        type: status === "Under Review" ? "task_submitted" : status === "Completed" ? "task_approved" : status === "Rejected" ? "task_rejected" : "task_status_updated",
        title: "Task status updated",
        message: `Task status changed to ${status}.`,
        entityType: "task",
        entityId: Number(id),
        dedupeKey: `task:${id}:admin-status:${Date.now()}`,
      }, req.userId);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Admin update task error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
