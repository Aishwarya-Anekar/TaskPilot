import pool from "./db.js";
import { createNotifications, taskAudience } from "./notifications.js";

async function processDeadlineNotifications() {
  const settingsResult = await pool.query("SELECT stage_2_hours, stage_3_hours FROM escalation_settings WHERE id = 1");
  const settings = settingsResult.rows[0] || { stage_2_hours: 24, stage_3_hours: 48 };
  const result = await pool.query(
    `SELECT id, title, due_date, status, assigned_dept_id, overdue_at
     FROM tasks
     WHERE due_date IS NOT NULL AND status NOT IN ('Completed', 'Rejected')`
  );

  for (const task of result.rows) {
    if (new Date(task.due_date).getTime() < Date.now() && !task.overdue_at) {
      await pool.query("UPDATE tasks SET is_overdue = true, overdue_at = due_date WHERE id = $1 AND overdue_at IS NULL", [task.id]);
      task.overdue_at = task.due_date;
    }

    let reminder: { type: string; title: string; message: string; key: string } | null = null;
    if (await isDueOn(task.due_date, 3)) {
      reminder = { type: "deadline_3_days", title: "Task deadline in 3 days", message: `"${task.title}" is due in 3 days.`, key: `task:${task.id}:deadline-3-days` };
    } else if (await isDueOn(task.due_date, 1)) {
      reminder = { type: "deadline_1_day", title: "Task deadline tomorrow", message: `"${task.title}" is due tomorrow.`, key: `task:${task.id}:deadline-1-day` };
    } else if (await isDueOn(task.due_date, 0)) {
      reminder = { type: "deadline_today", title: "Task deadline today", message: `"${task.title}" is due today.`, key: `task:${task.id}:deadline-today` };
    } else if (new Date(task.due_date).getTime() < Date.now()) {
      reminder = { type: "task_overdue", title: "Task overdue", message: `"${task.title}" has passed its deadline.`, key: `task:${task.id}:overdue` };
    }

    if (reminder) {
      const { users } = await taskAudience(task.id, false);
      await createNotifications(users.map((userId) => ({
        userId,
        type: reminder!.type,
        title: reminder!.title,
        message: reminder!.message,
        entityType: "task",
        entityId: task.id,
        dedupeKey: reminder!.key,
      })));
    }

    if (!task.overdue_at) continue;
    const overdueHours = (Date.now() - new Date(task.overdue_at).getTime()) / 3600000;
    const stages = [{ stage: 1, role: "assigned" }];
    if (overdueHours >= settings.stage_2_hours) stages.push({ stage: 2, role: "dept_head" });
    if (overdueHours >= settings.stage_3_hours) stages.push({ stage: 3, role: "admin" });

    for (const escalation of stages) {
      const claimed = await pool.query(
        `INSERT INTO task_escalations (task_id, stage, recipient_role)
         VALUES ($1, $2, $3) ON CONFLICT (task_id, stage) DO NOTHING RETURNING id`,
        [task.id, escalation.stage, escalation.role]
      );
      if (!claimed.rows.length) continue;

      const recipients = escalation.stage === 1
        ? (await taskAudience(task.id, false)).users
        : (await pool.query(
          escalation.stage === 2
            ? "SELECT id FROM users WHERE role = 'dept_head' AND department_id = $1"
            : "SELECT id FROM users WHERE role IN ('admin', 'super_admin')",
          escalation.stage === 2 ? [task.assigned_dept_id] : []
        )).rows.map((row) => row.id as number);
      const title = `Task escalation - Stage ${escalation.stage}`;
      const message = escalation.stage === 1
        ? `"${task.title}" is overdue and requires your attention.`
        : escalation.stage === 2
          ? `"${task.title}" remains incomplete and has been escalated to the department head.`
          : `"${task.title}" remains incomplete and has been escalated to administration.`;
      await createNotifications(recipients.map((userId) => ({
        userId, type: `task_escalation_${escalation.stage}`, title, message,
        entityType: "task", entityId: task.id,
        dedupeKey: `task:${task.id}:escalation:${escalation.stage}`,
      })));
      await pool.query(
        "INSERT INTO activity_logs (user_id, action, details) VALUES (NULL, $1, $2)",
        [title, `Task "${task.title}" crossed escalation stage ${escalation.stage}.`]
      );
    }
  }
}

async function processRecurringEvents() {
  const result = await pool.query(`SELECT * FROM events WHERE recurrence_type IS NOT NULL AND recurrence_next_at <= NOW() AND (recurrence_until IS NULL OR recurrence_next_at <= recurrence_until)`);
  for (const source of result.rows) {
    const next = new Date(source.recurrence_next_at);
    const end = source.end_date && source.start_date ? new Date(next.getTime() + new Date(source.end_date).getTime() - new Date(source.start_date).getTime()) : null;
    const created = await pool.query(`INSERT INTO events (title,description,location,start_date,end_date,coordinator_id,status,qr_code_key,template_id) VALUES ($1,$2,$3,$4,$5,$6,'Draft',$7,$8) RETURNING id`, [source.title, source.description, source.location, next, end, source.coordinator_id, `qr_${Date.now()}`, source.template_id]);
    if (source.template_id) {
      const items = await pool.query("SELECT * FROM event_template_tasks WHERE template_id = $1", [source.template_id]);
      for (const item of items.rows) {
        const task = await pool.query("INSERT INTO tasks (event_id,title,description,priority,status,progress) VALUES ($1,$2,$3,$4,'Pending',0) RETURNING id", [created.rows[0].id, item.title, item.description, item.priority]);
        const subs = await pool.query("SELECT title FROM event_template_subtasks WHERE template_task_id = $1", [item.id]);
        for (const sub of subs.rows) await pool.query("INSERT INTO subtasks (task_id,title) VALUES ($1,$2)", [task.rows[0].id, sub.title]);
      }
    }
    if (source.recurrence_type === "yearly") next.setFullYear(next.getFullYear() + source.recurrence_interval);
    else if (source.recurrence_type === "monthly") next.setMonth(next.getMonth() + source.recurrence_interval);
    else next.setDate(next.getDate() + source.recurrence_interval);
    await pool.query("UPDATE events SET recurrence_next_at = $1 WHERE id = $2", [next, source.id]);
  }
}

async function isDueOn(value: string | Date, daysFromToday: number) {
  const result = await pool.query(
    `SELECT ($1::timestamp::date = CURRENT_DATE + $2::integer) AS matches`,
    [value, daysFromToday]
  );
  return result.rows[0]?.matches === true;
}

export function startNotificationScheduler() {
  const run = () => Promise.all([processDeadlineNotifications(), processRecurringEvents()]).catch((err) => {
    console.error("Deadline notification job failed:", err);
  });
  run();
  return setInterval(run, 60 * 60 * 1000);
}