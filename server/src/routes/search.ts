import { Router, Response } from "express";
import pool from "../db.js";
import { authenticate, AuthRequest } from "../middleware/auth.js";

const router = Router();
const privilegedRoles = ["admin", "super_admin"];

router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

  if (query.length < 2) {
    res.json({ users: [], tasks: [], events: [], departments: [] });
    return;
  }

  try {
    const pattern = `%${query}%`;
    const isPrivileged = privilegedRoles.includes(req.userRole || "");
    let departmentId: number | null = null;

    if (!isPrivileged) {
      const userResult = await pool.query(
        "SELECT department_id FROM users WHERE id = $1",
        [req.userId]
      );
      departmentId = userResult.rows[0]?.department_id ?? null;
    }

    const taskScope = isPrivileged
      ? ""
      : req.userRole === "dept_head"
        ? "AND t.assigned_dept_id = $2"
        : "AND (t.assigned_to_id = $2 OR t.assigned_dept_id = $3)";
    const scopedParams = isPrivileged ? [pattern] : [pattern, departmentId];
    const taskParams = isPrivileged
      ? [pattern]
      : req.userRole === "dept_head"
        ? [pattern, departmentId]
        : [pattern, req.userId ?? 0, departmentId];

    const [users, tasks, events, departments] = await Promise.all([
      isPrivileged
        ? pool.query(
            `SELECT u.id, u.name, u.email, u.role, d.name AS department
             FROM users u
             LEFT JOIN departments d ON u.department_id = d.id
             WHERE (u.name ILIKE $1 OR u.email ILIKE $1 OR d.name ILIKE $1)
             ORDER BY u.name ASC LIMIT 8`,
        [pattern]
          )
        : Promise.resolve({ rows: [] }),
      pool.query(
        `SELECT t.id, t.title, t.status, e.title AS event_title,
                d.name AS department
         FROM tasks t
         LEFT JOIN events e ON t.event_id = e.id
         LEFT JOIN departments d ON t.assigned_dept_id = d.id
         WHERE (t.title ILIKE $1 OR t.description ILIKE $1 OR e.title ILIKE $1 OR d.name ILIKE $1)
         ${taskScope}
         ORDER BY t.updated_at DESC, t.created_at DESC LIMIT 8`,
        taskParams
      ),
      pool.query(
        `SELECT e.id, e.title, e.status, e.location, e.start_date
         FROM events e
         WHERE (e.title ILIKE $1 OR e.description ILIKE $1 OR e.location ILIKE $1)
         ORDER BY e.start_date ASC NULLS LAST, e.created_at DESC LIMIT 8`,
        [pattern]
      ),
      isPrivileged
        ? pool.query(
            `SELECT d.id, d.name, d.description
             FROM departments d
             WHERE (d.name ILIKE $1 OR d.description ILIKE $1)
             ORDER BY d.name ASC LIMIT 8`,
        [pattern]
          )
        : Promise.resolve({ rows: [] }),
    ]);

    res.json({
      users: users.rows,
      tasks: tasks.rows,
      events: events.rows,
      departments: departments.rows,
    });
  } catch (err) {
    console.error("Global search error:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

export default router;