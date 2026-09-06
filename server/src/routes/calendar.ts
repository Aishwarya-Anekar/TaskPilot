import { Router, Response } from "express";
import pool from "../db.js";
import { authenticate, AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(authenticate);

router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, department_id, employee_id, event_id, status } = req.query;
    const range = (column: string, params: unknown[]) => {
      const add = (value: unknown) => { params.push(value); return `$${params.length}`; };
      const clauses: string[] = [];
      if (from) clauses.push(`${column} >= ${add(from)}`);
      if (to) clauses.push(`${column} < (${add(to)}::date + INTERVAL '1 day')`);
      return clauses.length ? `AND ${clauses.join(" AND ")}` : "";
    };
    const isEmployee = req.userRole === "employee";
    const isHead = req.userRole === "dept_head";
    const taskParams: unknown[] = [];
    const taskAdd = (value: unknown) => { taskParams.push(value); return `$${taskParams.length}`; };
    const taskScope = isEmployee
      ? `AND (t.assigned_to_id = ${taskAdd(req.userId)} OR t.assigned_dept_id = (SELECT department_id FROM users WHERE id = ${taskAdd(req.userId)}))`
      : isHead ? `AND t.assigned_dept_id = (SELECT department_id FROM users WHERE id = ${taskAdd(req.userId)})` : "";
    const taskFilters = (alias: string) => `${department_id ? ` AND ${alias}.assigned_dept_id = ${taskAdd(Number(department_id))}` : ""}${employee_id ? ` AND ${alias}.assigned_to_id = ${taskAdd(Number(employee_id))}` : ""}${event_id ? ` AND ${alias}.event_id = ${taskAdd(Number(event_id))}` : ""}${status && status !== "All" ? ` AND ${alias}.status = ${taskAdd(status)}` : ""}`;
    const tasks = await pool.query(`SELECT t.id, t.title, t.due_date AS start, t.due_date AS end, t.status, t.priority, t.event_id, e.title AS event_title, 'task' AS kind FROM tasks t LEFT JOIN events e ON e.id=t.event_id WHERE t.due_date IS NOT NULL ${taskScope}${taskFilters("t")}${range("t.due_date", taskParams)} ORDER BY t.due_date`, taskParams);
    const eventParams: unknown[] = [];
    const events = await pool.query(`SELECT e.id, e.title, e.start_date AS start, e.end_date AS end, e.status, e.location, 'event' AS kind FROM events e WHERE (e.start_date IS NOT NULL OR e.end_date IS NOT NULL) ${range("COALESCE(e.start_date, e.end_date)", eventParams)} ORDER BY e.start_date`, eventParams);
    const meetingParams: unknown[] = [];
    const meetingEvent = event_id ? `AND mn.event_id = $${meetingParams.push(Number(event_id))}` : "";
    const meetings = await pool.query(`SELECT mn.id, mn.title, mn.created_at AS start, mn.created_at AS end, mn.event_id, e.title AS event_title, 'meeting' AS kind FROM meeting_notes mn JOIN events e ON e.id=mn.event_id WHERE 1=1 ${meetingEvent}${range("mn.created_at", meetingParams)} ORDER BY mn.created_at`, meetingParams);
    const bookingParams: unknown[] = [];
    const bookingScope = req.userRole === "admin" || req.userRole === "super_admin" ? "TRUE" : `rb.booked_by = $${bookingParams.push(req.userId)}`;
    const bookingEvent = event_id ? `AND rb.event_id = $${bookingParams.push(Number(event_id))}` : "";
    const bookings = await pool.query(`SELECT rb.id, r.name AS title, rb.start_time AS start, rb.end_time AS end, rb.status, rb.event_id, e.title AS event_title, 'booking' AS kind FROM resource_bookings rb JOIN resources r ON r.id=rb.resource_id JOIN events e ON e.id=rb.event_id WHERE (${bookingScope}) ${bookingEvent}${range("rb.start_time", bookingParams)} ORDER BY rb.start_time`, bookingParams);
    res.json({ events: [...events.rows, ...tasks.rows, ...meetings.rows, ...bookings.rows], holidays: [] });
  } catch (err) { console.error("Calendar feed error:", err); res.status(500).json({ error: "Server error" }); }
});

export default router;
