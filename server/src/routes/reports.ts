import { Router, Response } from "express";
import pool from "../db.js";
import { authenticate, AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(authenticate);

router.get("/data", async (req: AuthRequest, res: Response) => {
  try {
    const { type = "tasks", from, to, department_id, employee_id, event_id, status, priority } = req.query;
    const isEmployee = req.userRole === "employee";
    const isHead = req.userRole === "dept_head";
    const params: unknown[] = [];
    const where: string[] = [];
    const add = (value: unknown) => { params.push(value); return `$${params.length}`; };
    if (type === "resources") {
      const result = await pool.query(`SELECT rb.id, r.name AS resource, r.type, e.title AS event, u.name AS booked_by, rb.status, rb.start_time, rb.end_time, rb.created_at FROM resource_bookings rb JOIN resources r ON r.id=rb.resource_id JOIN events e ON e.id=rb.event_id LEFT JOIN users u ON u.id=rb.booked_by ORDER BY rb.created_at DESC`);
      return res.json({ type, rows: result.rows, summary: { total: result.rowCount } });
    }
    if (isEmployee) { where.push(`(t.assigned_to_id = ${add(req.userId)} OR t.assigned_dept_id = (SELECT department_id FROM users WHERE id = ${add(req.userId)}))`); }
    else if (isHead) where.push(`t.assigned_dept_id = (SELECT department_id FROM users WHERE id = ${add(req.userId)})`);
    if (from) where.push(`t.created_at >= ${add(from)}`);
    if (to) where.push(`t.created_at < (${add(to)}::date + INTERVAL '1 day')`);
    if (department_id) where.push(`t.assigned_dept_id = ${add(Number(department_id))}`);
    if (employee_id) where.push(`t.assigned_to_id = ${add(Number(employee_id))}`);
    if (event_id) where.push(`t.event_id = ${add(Number(event_id))}`);
    if (status && status !== "All") where.push(`t.status = ${add(status)}`);
    if (priority && priority !== "All") where.push(`t.priority = ${add(priority)}`);
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const result = await pool.query(`SELECT t.id, t.title AS task, t.status, t.priority, t.due_date, t.created_at, e.title AS event, d.name AS department, u.name AS employee FROM tasks t LEFT JOIN events e ON e.id=t.event_id LEFT JOIN departments d ON d.id=t.assigned_dept_id LEFT JOIN users u ON u.id=t.assigned_to_id ${whereSql} ORDER BY t.created_at DESC`, params);
    const rows = type === "overdue" ? result.rows.filter((row) => row.status !== "Completed" && row.due_date && new Date(row.due_date).getTime() < Date.now()) : type === "completed" ? result.rows.filter((row) => row.status === "Completed") : type === "pending" ? result.rows.filter((row) => row.status !== "Completed") : result.rows;
    res.json({ type, rows, summary: { total: rows.length, completed: rows.filter((row) => row.status === "Completed").length, pending: rows.filter((row) => row.status !== "Completed").length, overdue: rows.filter((row) => row.due_date && row.status !== "Completed" && new Date(row.due_date).getTime() < Date.now()).length } });
  } catch (err) { console.error("Report data error:", err); res.status(500).json({ error: "Server error" }); }
});

export default router;
