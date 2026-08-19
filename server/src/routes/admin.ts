import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import pool, { initDb } from "../db.js";
import {
  authenticate,
  requireAdmin,
  AuthRequest,
} from "../middleware/auth.js";

const router = Router();

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

// POST /api/admin/reseed - Reset & Seed the Database (Super Admin only)
router.post("/reseed", async (req: AuthRequest, res: Response) => {
  try {
    if (req.userRole !== "super_admin") {
      res.status(403).json({ error: "Super Admin access required" });
      return;
    }
    console.log("Super Admin triggered database re-seed...");
    await initDb();
    res.json({ message: "Database reinitialized successfully" });
  } catch (err) {
    console.error("Reseed database error:", err);
    res.status(500).json({ error: "Server error during database reset" });
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
      `SELECT u.id, u.name, u.email, u.role, u.semester, d.name as department, d.id as department_id
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

// POST /api/admin/employees - Create a new user (employee/dept_head/admin)
router.post("/employees", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, email, password, role, department_id } = req.body;
    if (!name || !email || !password || !role) {
      res.status(400).json({ error: "Name, email, password, and role are required" });
      return;
    }

    const check = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (check.rows.length > 0) {
      res.status(409).json({ error: "Email already exists" });
      return;
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, department_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role, department_id`,
      [name, email, hash, role, department_id || null]
    );

    await pool.query(
      "INSERT INTO activity_logs (user_id, action, details) VALUES ($1, 'Create User', $2)",
      [req.userId, `Registered user "${name}" with role "${role}"`]
    );

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

    const result = await pool.query(
      `UPDATE users SET
        name = COALESCE($1, name),
        email = COALESCE($2, email),
        role = COALESCE($3, role),
        department_id = COALESCE($4, department_id)
       WHERE id = $5 RETURNING id, name, email, role, department_id`,
      [name, email, role, department_id, id]
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
  try {
    const { resource_id, event_id, start_time, end_time } = req.body;
    if (!resource_id || !event_id || !start_time || !end_time) {
      res.status(400).json({ error: "Resource ID, Event ID, start_time, and end_time are required" });
      return;
    }

    // Check availability
    const conflict = await pool.query(
      `SELECT id FROM resource_bookings
       WHERE resource_id = $1
         AND status = 'Approved'
         AND (
           (start_time <= $2 AND end_time > $2) OR
           (start_time < $3 AND end_time >= $3) OR
           (start_time >= $2 AND end_time <= $3)
         )`,
      [resource_id, start_time, end_time]
    );

    if (conflict.rows.length > 0) {
      res.status(409).json({ error: "Resource is already booked for the selected time range" });
      return;
    }

    const result = await pool.query(
      `INSERT INTO resource_bookings (resource_id, event_id, booked_by, start_time, end_time, status)
       VALUES ($1, $2, $3, $4, $5, 'Approved') RETURNING *`,
      [resource_id, event_id, req.userId, start_time, end_time]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Book resource error:", err);
    res.status(500).json({ error: "Server error" });
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
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Admin update task error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
