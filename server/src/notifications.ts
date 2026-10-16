import pool from "./db.js";
import { sendNotificationEmail } from "./email.js";

export type NotificationInput = {
  userId: number;
  type: string;
  title: string;
  message: string;
  entityType?: string;
  entityId?: number;
  dedupeKey: string;
};

async function notificationsEnabled(userId: number, type: string) {
  const preference = type === "task_assigned"
    ? "task_assignment_notifications"
    : type.startsWith("deadline_") || type === "task_overdue" || type.startsWith("task_escalation_")
      ? "task_deadline_notifications"
      : type === "event_reminder"
        ? "event_reminder_notifications"
        : type.startsWith("task_")
          ? "task_status_notifications"
          : null;
  if (!preference) return true;
  const result = await pool.query(`SELECT ${preference} AS enabled FROM users WHERE id = $1`, [userId]);
  return result.rows[0]?.enabled === true;
}

export async function createNotifications(notifications: NotificationInput[]) {
  const settings = await pool.query("SELECT enable_notifications FROM system_settings WHERE id = 1");
  if (!settings.rows[0]?.enable_notifications) return;
  for (const notification of notifications) {
    try {
      if (!(await notificationsEnabled(notification.userId, notification.type))) continue;
      const created = await pool.query(
        `INSERT INTO notifications
          (user_id, type, title, message, entity_type, entity_id, dedupe_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, dedupe_key) DO NOTHING
         RETURNING id`,
        [notification.userId, notification.type, notification.title, notification.message,
          notification.entityType || null, notification.entityId || null, notification.dedupeKey]
      );
      if (created.rows.length) await sendNotificationEmail(notification);
    } catch (err) {
      console.error("Create notification error:", err);
    }
  }
}

export async function createInAppNotification(notification: NotificationInput): Promise<boolean> {
  const settings = await pool.query("SELECT enable_notifications FROM system_settings WHERE id = 1");
  if (!settings.rows[0]?.enable_notifications) throw new Error("In-app notifications are disabled");
  const result = await pool.query(
    `INSERT INTO notifications (user_id, type, title, message, entity_type, entity_id, dedupe_key)
     SELECT u.id, $2, $3, $4, $5, $6, $7
     FROM users u WHERE u.id = $1 AND u.is_active = true
     ON CONFLICT (user_id, dedupe_key) DO NOTHING
     RETURNING id`,
    [notification.userId, notification.type, notification.title, notification.message,
      notification.entityType || null, notification.entityId || null, notification.dedupeKey]
  );
  if (!result.rows.length) {
    const recipient = await pool.query("SELECT id FROM users WHERE id = $1 AND is_active = true", [notification.userId]);
    if (!recipient.rows.length) throw new Error("Notification recipient is no longer active");
  }
  return result.rows.length > 0;
}

export async function taskAudience(taskId: number, includeAdmins = true) {
  const task = await pool.query(
    `SELECT t.assigned_to_id, t.assigned_dept_id, t.title, e.title AS event_title
     FROM tasks t LEFT JOIN events e ON e.id = t.event_id WHERE t.id = $1`,
    [taskId]
  );
  if (!task.rows[0]) return { users: [], task: null };

  const row = task.rows[0];
  const recipients = await pool.query(
    `SELECT DISTINCT id FROM users
     WHERE ($1::integer IS NOT NULL AND id = $1)
        OR ($2::integer IS NOT NULL AND department_id = $2)
        OR ($3::boolean AND role = 'super_admin')`,
    [row.assigned_to_id, row.assigned_dept_id, includeAdmins]
  );
  return { users: recipients.rows.map((recipient) => recipient.id as number), task: row };
}

export async function notifyTaskAudience(
  taskId: number,
  input: Omit<NotificationInput, "userId">,
  excludeUserId?: number
) {
  const { users } = await taskAudience(taskId);
  await createNotifications(
    users
      .filter((userId) => userId !== excludeUserId)
      .map((userId) => ({ ...input, userId }))
  );
}