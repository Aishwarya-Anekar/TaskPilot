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

export async function createNotifications(notifications: NotificationInput[]) {
  for (const notification of notifications) {
    try {
      await pool.query(
        `INSERT INTO notifications
          (user_id, type, title, message, entity_type, entity_id, dedupe_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
        [notification.userId, notification.type, notification.title, notification.message,
          notification.entityType || null, notification.entityId || null, notification.dedupeKey]
      );
      await sendNotificationEmail(notification);
    } catch (err) {
      console.error("Create notification error:", err);
    }
  }
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
        OR ($3::boolean AND role IN ('admin', 'super_admin'))`,
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