import { Router, Response } from "express";
import pool from "../db.js";
import { authenticate, AuthRequest } from "../middleware/auth.js";
import { isNonEmptyString, validateDateRange } from "../validation.js";

const router = Router();
router.use(authenticate);
const isAdmin = (req: AuthRequest) => req.userRole === "admin" || req.userRole === "super_admin";

router.get("/", async (_req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT et.*, COALESCE(json_agg(json_build_object(
        'id', ett.id, 'title', ett.title, 'description', ett.description, 'priority', ett.priority,
        'responsible_role', ett.responsible_role, 'responsible_department_id', ett.responsible_department_id,
        'relative_due_hours', ett.relative_due_hours,
        'subtasks', (SELECT COALESCE(json_agg(ets.title ORDER BY ets.sort_order), '[]') FROM event_template_subtasks ets WHERE ets.template_task_id = ett.id)
      ) ORDER BY ett.sort_order) FILTER (WHERE ett.id IS NOT NULL), '[]') AS tasks
      FROM event_templates et LEFT JOIN event_template_tasks ett ON ett.template_id = et.id
      GROUP BY et.id ORDER BY et.name ASC`);
    res.json(result.rows);
  } catch (err) { console.error("List event templates error:", err); res.status(500).json({ error: "Server error" }); }
});

router.post("/", async (req: AuthRequest, res: Response) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
  const client = await pool.connect();
  try {
    const { name, description, default_duration_minutes, suggested_department_ids, default_responsible_role, tasks = [] } = req.body;
    if (!name) return res.status(400).json({ error: "Template name is required" });
    await client.query("BEGIN");
    const template = await client.query(
      `INSERT INTO event_templates (name, description, default_duration_minutes, suggested_department_ids, default_responsible_role, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, description || "", Number(default_duration_minutes) || 120, suggested_department_ids || [], default_responsible_role || null, req.userId]
    );
    for (const [index, task] of tasks.entries()) {
      const item = await client.query(
        `INSERT INTO event_template_tasks (template_id, title, description, priority, responsible_role, responsible_department_id, relative_due_hours, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [template.rows[0].id, task.title, task.description || "", task.priority || "Medium", task.responsible_role || null, task.responsible_department_id || null, Number(task.relative_due_hours) || 24, index]
      );
      for (const [subIndex, title] of (task.subtasks || []).entries()) {
        await client.query("INSERT INTO event_template_subtasks (template_task_id, title, sort_order) VALUES ($1,$2,$3)", [item.rows[0].id, title, subIndex]);
      }
    }
    await client.query("COMMIT");
    res.status(201).json(template.rows[0]);
  } catch (err) { await client.query("ROLLBACK"); console.error("Create event template error:", err); res.status(500).json({ error: "Server error" }); }
  finally { client.release(); }
});

router.put("/:id", async (req: AuthRequest, res: Response) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
  const client = await pool.connect();
  try {
    const { name, description, default_duration_minutes, suggested_department_ids, default_responsible_role, tasks = [] } = req.body;
    await client.query("BEGIN");
    const template = await client.query(
      `UPDATE event_templates SET name=$1, description=$2, default_duration_minutes=$3, suggested_department_ids=$4, default_responsible_role=$5, updated_at=NOW() WHERE id=$6 RETURNING *`,
      [name, description || "", Number(default_duration_minutes) || 120, suggested_department_ids || [], default_responsible_role || null, req.params.id]
    );
    if (!template.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Template not found" }); }
    await client.query("DELETE FROM event_template_tasks WHERE template_id = $1", [req.params.id]);
    for (const [index, task] of tasks.entries()) {
      const item = await client.query(
        `INSERT INTO event_template_tasks (template_id,title,description,priority,responsible_role,responsible_department_id,relative_due_hours,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [req.params.id, task.title, task.description || "", task.priority || "Medium", task.responsible_role || null, task.responsible_department_id || null, Number(task.relative_due_hours) || 24, index]
      );
      for (const [subIndex, title] of (task.subtasks || []).entries()) await client.query("INSERT INTO event_template_subtasks (template_task_id,title,sort_order) VALUES ($1,$2,$3)", [item.rows[0].id, title, subIndex]);
    }
    await client.query("COMMIT"); res.json(template.rows[0]);
  } catch (err) { await client.query("ROLLBACK"); console.error("Update event template error:", err); res.status(500).json({ error: "Server error" }); }
  finally { client.release(); }
});

router.post("/:id/duplicate", async (req: AuthRequest, res: Response) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
  try {
    const source = await pool.query("SELECT * FROM event_templates WHERE id = $1", [req.params.id]);
    if (!source.rows.length) return res.status(404).json({ error: "Template not found" });
    const tasks = await pool.query("SELECT ett.*, COALESCE(array_agg(ets.title ORDER BY ets.sort_order) FILTER (WHERE ets.id IS NOT NULL), '{}') AS subtasks FROM event_template_tasks ett LEFT JOIN event_template_subtasks ets ON ets.template_task_id = ett.id WHERE ett.template_id = $1 GROUP BY ett.id ORDER BY ett.sort_order", [req.params.id]);
    const copy = { ...source.rows[0], name: `${source.rows[0].name} Copy`, tasks: tasks.rows };
    const result = await pool.query("INSERT INTO event_templates (name,description,default_duration_minutes,suggested_department_ids,default_responsible_role,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [copy.name, copy.description, copy.default_duration_minutes, copy.suggested_department_ids, copy.default_responsible_role, req.userId]);
    for (const task of copy.tasks) { const item = await pool.query("INSERT INTO event_template_tasks (template_id,title,description,priority,responsible_role,responsible_department_id,relative_due_hours,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id", [result.rows[0].id,task.title,task.description,task.priority,task.responsible_role,task.responsible_department_id,task.relative_due_hours,task.sort_order]); for (const [index, title] of task.subtasks.entries()) await pool.query("INSERT INTO event_template_subtasks (template_task_id,title,sort_order) VALUES ($1,$2,$3)", [item.rows[0].id,title,index]); }
    res.status(201).json(result.rows[0]);
  } catch (err) { console.error("Duplicate event template error:", err); res.status(500).json({ error: "Server error" }); }
});

router.delete("/:id", async (req: AuthRequest, res: Response) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
  try { const result = await pool.query("DELETE FROM event_templates WHERE id = $1 RETURNING id", [req.params.id]); if (!result.rows.length) return res.status(404).json({ error: "Template not found" }); res.json({ message: "Template deleted" }); }
  catch (err) { console.error("Delete event template error:", err); res.status(500).json({ error: "Server error" }); }
});

router.post("/:id/generate", async (req: AuthRequest, res: Response) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
  const client = await pool.connect();
  try {
    const { title, description, location, start_date, end_date, recurrence_type, recurrence_interval, recurrence_until } = req.body;
    const template = await client.query("SELECT * FROM event_templates WHERE id = $1", [req.params.id]);
    if (!template.rows.length) return res.status(404).json({ error: "Template not found" });
    const eventTitle = title ?? template.rows[0].name;
    if (!isNonEmptyString(eventTitle)) return res.status(400).json({ error: "Event title is required" });
    const dateError = validateDateRange(start_date, end_date, true);
    if (dateError) return res.status(400).json({ error: dateError });
    const items = await client.query("SELECT * FROM event_template_tasks WHERE template_id = $1 ORDER BY sort_order", [req.params.id]);
    await client.query("BEGIN");
    const nextAt = recurrence_type && start_date ? new Date(start_date) : null;
    if (nextAt && recurrence_type === "yearly") nextAt.setFullYear(nextAt.getFullYear() + (Number(recurrence_interval) || 1));
    if (nextAt && recurrence_type === "monthly") nextAt.setMonth(nextAt.getMonth() + (Number(recurrence_interval) || 1));
    if (nextAt && recurrence_type === "custom") nextAt.setDate(nextAt.getDate() + (Number(recurrence_interval) || 1));
    const event = await client.query(`INSERT INTO events (title,description,location,start_date,end_date,coordinator_id,status,qr_code_key,recurrence_type,recurrence_interval,recurrence_until,recurrence_next_at,template_id) VALUES ($1,$2,$3,$4,$5,$6,'Draft',$7,$8,$9,$10,$11,$12) RETURNING *`, [eventTitle.trim(), description ?? template.rows[0].description, location || "", start_date, end_date, req.userId, `qr_${Date.now()}`, recurrence_type || null, recurrence_interval || null, recurrence_until || null, nextAt, req.params.id]);
    for (const item of items.rows) {
      const task = await client.query(`INSERT INTO tasks (event_id,title,description,priority,due_date,assigned_dept_id,status,progress) VALUES ($1,$2,$3,$4,CASE WHEN $5::timestamp IS NULL THEN NULL ELSE $5::timestamp + ($6::integer * INTERVAL '1 hour') END,$7,'Pending',0) RETURNING id`, [event.rows[0].id,item.title,item.description,item.priority,end_date || start_date || null,item.relative_due_hours,item.responsible_department_id]);
      const subtasks = await client.query("SELECT title FROM event_template_subtasks WHERE template_task_id = $1 ORDER BY sort_order", [item.id]);
      for (const subtask of subtasks.rows) await client.query("INSERT INTO subtasks (task_id,title) VALUES ($1,$2)", [task.rows[0].id, subtask.title]);
    }
    await client.query("COMMIT"); res.status(201).json(event.rows[0]);
  } catch (err) { await client.query("ROLLBACK"); console.error("Generate event from template error:", err); res.status(500).json({ error: "Server error" }); }
  finally { client.release(); }
});

export default router;