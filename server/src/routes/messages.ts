import { Router, Response } from "express";
import pool from "../db.js";
import { authenticate, AuthRequest } from "../middleware/auth.js";
import { createNotifications } from "../notifications.js";
import { parsePositiveId } from "../validation.js";

const router = Router();

// ==========================================
// ANNOUNCEMENTS SECTION
// ==========================================

const ANNOUNCEMENT_CATEGORIES = [
  "General Notice", "Academic Notice", "Examination", "Department Meeting",
  "College Event", "Faculty Training", "Administrative Notice", "Urgent Notice", "Other",
];
const ANNOUNCEMENT_PRIORITIES = ["Normal", "Important", "Urgent"];
const ANNOUNCEMENT_AUDIENCES = ["college", "super_admin", "dept_head", "employee", "department", "selected_users"];

function visibleToUserClause() {
  return `(
    (a.status = 'published' AND a.published_at <= NOW() AND (a.expires_at IS NULL OR a.expires_at > NOW()) AND (
      a.audience = 'college'
      OR (a.audience = 'super_admin' AND $2 = 'super_admin')
      OR (a.audience = 'dept_head' AND $2 = 'dept_head')
      OR (a.audience = 'employee' AND $2 = 'employee')
      OR (a.audience = 'department' AND a.target_dept_id = $3)
      OR (a.audience = 'selected_users' AND EXISTS (
        SELECT 1 FROM announcement_recipients ar WHERE ar.announcement_id = a.id AND ar.user_id = $1
      ))
    ))
    OR $2 = 'super_admin'
    OR (a.created_by = $1 AND $2 = 'dept_head')
  )`;
}

async function announcementRecipients(
  audience: string,
  departmentId: number | null,
  userIds: number[],
  excludeUserId: number
) {
  if (audience === "selected_users") return userIds.filter((id) => id !== excludeUserId);
  const result = await pool.query(
    `SELECT id FROM users
     WHERE is_active = true AND id <> $1 AND (
       $2 = 'college'
       OR ($2 = 'super_admin' AND role = 'super_admin')
       OR ($2 = 'dept_head' AND role = 'dept_head')
       OR ($2 = 'employee' AND role = 'employee')
       OR ($2 = 'department' AND department_id = $3)
     )`,
    [excludeUserId, audience, departmentId]
  );
  return result.rows.map((row) => row.id as number);
}

async function canManageAnnouncement(req: AuthRequest, announcementId: number) {
  if (req.userRole === "super_admin") return true;
  if (req.userRole !== "dept_head") return false;
  const result = await pool.query(
    `SELECT a.created_by, a.target_dept_id, u.department_id
     FROM announcements a JOIN users u ON u.id = $2 WHERE a.id = $1`,
    [announcementId, req.userId]
  );
  const row = result.rows[0];
  return Boolean(row && row.created_by === req.userId && row.target_dept_id === row.department_id);
}

function validOptionalTimestamp(value: unknown) {
  if (value === undefined || value === null || value === "") return true;
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

async function validateAnnouncementTarget(
  req: AuthRequest,
  audience: unknown,
  rawDepartmentId: unknown,
  rawRecipientIds: unknown
) {
  if (typeof audience !== "string" || !ANNOUNCEMENT_AUDIENCES.includes(audience)) {
    return { error: "Choose a valid target audience" };
  }
  if (audience === "selected_users" && req.userRole !== "super_admin" && req.userRole !== "dept_head") {
    return { error: "You cannot select individual recipients" };
  }

  const departmentId = audience === "department" ? parsePositiveId(rawDepartmentId) : null;
  if (audience === "department" && !departmentId) return { error: "Choose a valid department" };

  const profile = await pool.query("SELECT department_id FROM users WHERE id = $1", [req.userId]);
  const ownDepartmentId = profile.rows[0]?.department_id as number | null;
  if (req.userRole === "dept_head") {
    if (audience !== "department" || departmentId !== ownDepartmentId) {
      return { error: "Department Heads may publish only to their own department" };
    }
  } else if (req.userRole !== "super_admin") {
    return { error: "Announcement publishing access required" };
  }

  if (departmentId) {
    const department = await pool.query("SELECT id FROM departments WHERE id = $1", [departmentId]);
    if (!department.rows.length) return { error: "Department not found" };
  }

  let recipientIds: number[] = [];
  if (audience === "selected_users") {
    if (!Array.isArray(rawRecipientIds) || rawRecipientIds.length === 0 || rawRecipientIds.length > 200) {
      return { error: "Choose between 1 and 200 eligible recipients" };
    }
    recipientIds = [...new Set(rawRecipientIds.map(parsePositiveId).filter((id): id is number => id !== null))];
    if (recipientIds.length !== rawRecipientIds.length) return { error: "Recipient list contains invalid users" };
    const eligible = await pool.query(
      `SELECT id FROM users WHERE is_active = true AND id = ANY($1::integer[])
       AND ($2 <> 'dept_head' OR department_id = $3)`,
      [recipientIds, req.userRole, ownDepartmentId]
    );
    if (eligible.rows.length !== recipientIds.length) return { error: "One or more selected users are not eligible recipients" };
  }
  return { departmentId, recipientIds };
}

async function validateRelatedRecord(req: AuthRequest, eventId: number | null, taskId: number | null) {
  if (eventId) {
    const event = await pool.query("SELECT department_id FROM events WHERE id = $1", [eventId]);
    if (!event.rows.length) return "Related event not found";
    if (req.userRole !== "super_admin" && !(req.userRole === "dept_head" && event.rows[0].department_id === (await userDepartment(req.userId)))) {
      return "You cannot link an event outside your authorized scope";
    }
  }
  if (taskId) {
    const task = await pool.query("SELECT assigned_dept_id FROM tasks WHERE id = $1 AND deleted_at IS NULL", [taskId]);
    if (!task.rows.length) return "Related task not found";
    if (req.userRole !== "super_admin" && !(req.userRole === "dept_head" && task.rows[0].assigned_dept_id === (await userDepartment(req.userId)))) {
      return "You cannot link a task outside your authorized scope";
    }
  }
  return null;
}

async function userDepartment(userId?: number) {
  const result = await pool.query("SELECT department_id FROM users WHERE id = $1", [userId]);
  return result.rows[0]?.department_id as number | null;
}

function announcementNotificationInput(userId: number, announcement: Record<string, any>) {
  return {
    userId,
    type: announcement.priority === "Urgent" ? "urgent_announcement" : "new_announcement",
    title: announcement.priority === "Urgent" ? "Urgent college notice" : "New college announcement",
    message: announcement.title,
    entityType: "announcement",
    entityId: announcement.id,
    dedupeKey: `announcement:${announcement.id}:published:${new Date(announcement.published_at).getTime()}`,
  };
}

// GET /api/messages/announcements - list only notices visible to the authenticated user
router.get("/announcements", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userRes = await pool.query("SELECT department_id FROM users WHERE id = $1", [req.userId]);
    const deptId = userRes.rows[0]?.department_id ?? null;
    const params: unknown[] = [req.userId, req.userRole, deptId];
    const filters = [visibleToUserClause()];
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : "";
    if (search) {
      params.push(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
      filters.push(`(a.title ILIKE $${params.length} ESCAPE '\\' OR a.content ILIKE $${params.length} ESCAPE '\\')`);
    }
    if (typeof req.query.category === "string" && ANNOUNCEMENT_CATEGORIES.includes(req.query.category)) {
      params.push(req.query.category);
      filters.push(`a.category = $${params.length}`);
    }
    if (typeof req.query.priority === "string" && ANNOUNCEMENT_PRIORITIES.includes(req.query.priority)) {
      params.push(req.query.priority);
      filters.push(`a.priority = $${params.length}`);
    }
    if (req.userRole === "super_admin" && ["published", "scheduled", "draft", "archived"].includes(String(req.query.status))) {
      params.push(req.query.status);
      filters.push(`a.status = $${params.length}${req.query.status === "published" ? " AND (a.expires_at IS NULL OR a.expires_at > NOW())" : ""}`);
    }
    const result = await pool.query(
      `SELECT a.id, a.created_by, a.title, a.content, a.category, a.priority, a.audience, a.status,
              a.target_dept_id, a.published_at, a.expires_at, a.acknowledgement_required,
              a.is_pinned, a.related_event_id, a.related_task_id, a.created_at,
              u.name AS author_name, u.role AS author_role, d.name AS department_name,
              ev.title AS event_title,
              CASE WHEN $2 = 'super_admin'
                     OR ($2 = 'dept_head' AND t.assigned_dept_id = $3)
                     OR ($2 = 'employee' AND (t.assigned_to_id = $1 OR t.assigned_dept_id = $3))
                   THEN t.title ELSE NULL END AS task_title,
              EXISTS (SELECT 1 FROM announcement_reads ar WHERE ar.announcement_id = a.id AND ar.user_id = $1) AS is_read,
              EXISTS (SELECT 1 FROM announcement_acknowledgements aa WHERE aa.announcement_id = a.id AND aa.user_id = $1) AS is_acknowledged,
              CASE WHEN a.created_by = $1 OR $2 = 'super_admin' THEN
                (SELECT COUNT(*)::integer FROM announcement_acknowledgements aa WHERE aa.announcement_id = a.id)
              ELSE NULL END AS acknowledged_count,
              CASE WHEN a.created_by = $1 OR $2 = 'super_admin' THEN
                (SELECT COUNT(*)::integer FROM users recipient WHERE recipient.is_active = true AND recipient.id <> a.created_by AND (
                  (a.audience = 'college') OR (a.audience = 'super_admin' AND recipient.role = 'super_admin')
                  OR (a.audience = 'dept_head' AND recipient.role = 'dept_head')
                  OR (a.audience = 'employee' AND recipient.role = 'employee')
                  OR (a.audience = 'department' AND recipient.department_id = a.target_dept_id)
                  OR (a.audience = 'selected_users' AND EXISTS (
                    SELECT 1 FROM announcement_recipients ar WHERE ar.announcement_id = a.id AND ar.user_id = recipient.id
                  ))
                )) ELSE NULL END AS eligible_count
       FROM announcements a
       JOIN users u ON a.created_by = u.id
       LEFT JOIN departments d ON a.target_dept_id = d.id
      LEFT JOIN events ev ON ev.id = a.related_event_id
      LEFT JOIN tasks t ON t.id = a.related_task_id
       WHERE ${filters.join(" AND ")}
       ORDER BY a.is_pinned DESC, CASE a.priority WHEN 'Urgent' THEN 0 WHEN 'Important' THEN 1 ELSE 2 END,
                a.published_at DESC, a.id DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch announcements error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/messages/announcements - create a scoped, scheduled, or immediately published notice
router.post("/announcements", authenticate, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  try {
    const { title, content, category, priority, audience, target_dept_id, recipient_user_ids,
      published_at, expires_at, acknowledgement_required, related_event_id, related_task_id, status: requestedStatus } = req.body;
    if (typeof title !== "string" || !title.trim() || title.trim().length > 255 || typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "A title (max 255 characters) and announcement content are required" });
    }
    if (!ANNOUNCEMENT_CATEGORIES.includes(category) || !ANNOUNCEMENT_PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: "Choose a valid announcement category and priority" });
    }
    if (!validOptionalTimestamp(published_at) || !validOptionalTimestamp(expires_at)) {
      return res.status(400).json({ error: "Publish and expiry dates must be valid" });
    }
    if (acknowledgement_required !== undefined && typeof acknowledgement_required !== "boolean") return res.status(400).json({ error: "Acknowledgement setting must be true or false" });
    if (requestedStatus !== undefined && requestedStatus !== "draft" && requestedStatus !== "published") return res.status(400).json({ error: "Choose draft or publish" });
    if (published_at && expires_at && Date.parse(expires_at) <= Date.parse(published_at)) {
      return res.status(400).json({ error: "Expiry must be later than the publish date" });
    }
    const target = await validateAnnouncementTarget(req, audience, target_dept_id, recipient_user_ids);
    if ("error" in target) return res.status(403).json({ error: target.error });
    const eventId = related_event_id ? parsePositiveId(related_event_id) : null;
    const taskId = related_task_id ? parsePositiveId(related_task_id) : null;
    if ((related_event_id && !eventId) || (related_task_id && !taskId)) return res.status(400).json({ error: "Related event or task ID is invalid" });
    const relatedError = await validateRelatedRecord(req, eventId, taskId);
    if (relatedError) return res.status(403).json({ error: relatedError });

    const publishDate = published_at ? new Date(published_at) : new Date();
    const status = requestedStatus === "draft" ? "draft" : publishDate.getTime() > Date.now() ? "scheduled" : "published";
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO announcements
        (title, content, created_by, target_dept_id, category, priority, audience, status,
         published_at, expires_at, acknowledgement_required, related_event_id, related_task_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [title.trim(), content.trim(), req.userId, target.departmentId ?? null, category, priority, audience, status,
        publishDate, expires_at || null, Boolean(acknowledgement_required), eventId, taskId]
    );
    const announcement = result.rows[0];
    for (const userId of target.recipientIds) {
      await client.query("INSERT INTO announcement_recipients (announcement_id, user_id) VALUES ($1, $2)", [announcement.id, userId]);
    }
    await client.query(
      "INSERT INTO activity_logs (user_id, action, details) VALUES ($1, $2, $3)",
      [req.userId, "Create announcement", `Announcement ${announcement.id} created with ${status} status.`]
    );
    await client.query("COMMIT");

    if (status === "published") {
      const recipients = await announcementRecipients(audience, target.departmentId ?? null, target.recipientIds, req.userId!);
      await createNotifications(recipients.map((userId) => announcementNotificationInput(userId, announcement)));
    }
    res.status(201).json(announcement);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Create announcement error:", err);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

router.get("/announcements/:id", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const id = parsePositiveId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid announcement ID" });
    const profile = await pool.query("SELECT department_id FROM users WHERE id = $1", [req.userId]);
      const result = await pool.query(
        `SELECT a.*, u.name AS author_name, u.role AS author_role, d.name AS department_name,
              ev.title AS event_title,
              CASE WHEN $2 = 'super_admin'
                     OR ($2 = 'dept_head' AND t.assigned_dept_id = $3)
                     OR ($2 = 'employee' AND (t.assigned_to_id = $1 OR t.assigned_dept_id = $3))
                   THEN t.title ELSE NULL END AS task_title,
              EXISTS (SELECT 1 FROM announcement_acknowledgements aa WHERE aa.announcement_id = a.id AND aa.user_id = $1) AS is_acknowledged,
              CASE WHEN a.created_by = $1 OR $2 = 'super_admin' THEN
                (SELECT COUNT(*)::integer FROM announcement_acknowledgements aa WHERE aa.announcement_id = a.id)
              ELSE NULL END AS acknowledged_count,
              CASE WHEN a.created_by = $1 OR $2 = 'super_admin' THEN
                (SELECT COUNT(*)::integer FROM users recipient WHERE recipient.is_active = true AND recipient.id <> a.created_by AND (
                  a.audience = 'college' OR (a.audience = 'super_admin' AND recipient.role = 'super_admin')
                  OR (a.audience = 'dept_head' AND recipient.role = 'dept_head')
                  OR (a.audience = 'employee' AND recipient.role = 'employee')
                  OR (a.audience = 'department' AND recipient.department_id = a.target_dept_id)
                  OR (a.audience = 'selected_users' AND EXISTS (
                    SELECT 1 FROM announcement_recipients ar WHERE ar.announcement_id = a.id AND ar.user_id = recipient.id
                  ))
                )) ELSE NULL END AS eligible_count
              ,CASE WHEN a.created_by = $1 OR $2 = 'super_admin' THEN
                ARRAY(SELECT ar.user_id FROM announcement_recipients ar WHERE ar.announcement_id = a.id)
              ELSE NULL END AS recipient_user_ids
              ,CASE WHEN a.created_by = $1 OR $2 = 'super_admin' THEN
                COALESCE((SELECT json_agg(json_build_object('id', recipient.id, 'name', recipient.name, 'role', recipient.role) ORDER BY recipient.name)
                  FROM users recipient WHERE recipient.is_active = true AND recipient.id <> a.created_by
                  AND NOT EXISTS (SELECT 1 FROM announcement_acknowledgements aa WHERE aa.announcement_id = a.id AND aa.user_id = recipient.id)
                  AND (
                    a.audience = 'college' OR (a.audience = 'super_admin' AND recipient.role = 'super_admin')
                    OR (a.audience = 'dept_head' AND recipient.role = 'dept_head')
                    OR (a.audience = 'employee' AND recipient.role = 'employee')
                    OR (a.audience = 'department' AND recipient.department_id = a.target_dept_id)
                    OR (a.audience = 'selected_users' AND EXISTS (
                      SELECT 1 FROM announcement_recipients ar WHERE ar.announcement_id = a.id AND ar.user_id = recipient.id
                    ))
                  )), '[]'::json)
              ELSE NULL END AS outstanding_recipients
       FROM announcements a JOIN users u ON u.id = a.created_by
       LEFT JOIN departments d ON d.id = a.target_dept_id
       LEFT JOIN events ev ON ev.id = a.related_event_id LEFT JOIN tasks t ON t.id = a.related_task_id
       WHERE a.id = $4 AND ${visibleToUserClause()}`,
      [req.userId, req.userRole, profile.rows[0]?.department_id ?? null, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Announcement not found" });
    await pool.query(
      "INSERT INTO announcement_reads (announcement_id, user_id) VALUES ($1, $2) ON CONFLICT (announcement_id, user_id) DO NOTHING",
      [id, req.userId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Fetch announcement details error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/announcements/:id", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const id = parsePositiveId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid announcement ID" });
    if (!(await canManageAnnouncement(req, id))) return res.status(403).json({ error: "Announcement management access required" });
    const { title, content, category, priority, audience, target_dept_id, recipient_user_ids,
      published_at, expires_at, acknowledgement_required, related_event_id, related_task_id, status: requestedStatus } = req.body;
    if (typeof title !== "string" || !title.trim() || title.trim().length > 255 || typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "A title (max 255 characters) and announcement content are required" });
    }
    if (!ANNOUNCEMENT_CATEGORIES.includes(category) || !ANNOUNCEMENT_PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: "Choose a valid announcement category and priority" });
    }
    if (!validOptionalTimestamp(published_at) || !validOptionalTimestamp(expires_at)) return res.status(400).json({ error: "Publish and expiry dates must be valid" });
    if (acknowledgement_required !== undefined && typeof acknowledgement_required !== "boolean") return res.status(400).json({ error: "Acknowledgement setting must be true or false" });
    if (requestedStatus !== undefined && requestedStatus !== "draft" && requestedStatus !== "published") return res.status(400).json({ error: "Choose draft or publish" });
    if (published_at && expires_at && Date.parse(expires_at) <= Date.parse(published_at)) return res.status(400).json({ error: "Expiry must be later than the publish date" });
    const target = await validateAnnouncementTarget(req, audience, target_dept_id, recipient_user_ids);
    if ("error" in target) return res.status(403).json({ error: target.error });
    const eventId = related_event_id ? parsePositiveId(related_event_id) : null;
    const taskId = related_task_id ? parsePositiveId(related_task_id) : null;
    if ((related_event_id && !eventId) || (related_task_id && !taskId)) return res.status(400).json({ error: "Related event or task ID is invalid" });
    const relatedError = await validateRelatedRecord(req, eventId, taskId);
    if (relatedError) return res.status(403).json({ error: relatedError });

    const publishDate = published_at ? new Date(published_at) : new Date();
    const status = requestedStatus === "draft" ? "draft" : publishDate.getTime() > Date.now() ? "scheduled" : "published";
    const client = await pool.connect();
    let result;
    try {
      await client.query("BEGIN");
      result = await client.query(
        `UPDATE announcements SET title = $1, content = $2, target_dept_id = $3, category = $4,
          priority = $5, audience = $6, status = $7, published_at = $8, expires_at = $9,
          acknowledgement_required = $10, related_event_id = $11, related_task_id = $12, updated_at = NOW()
         WHERE id = $13 RETURNING *`,
        [title.trim(), content.trim(), target.departmentId ?? null, category, priority, audience, status,
          publishDate, expires_at || null, Boolean(acknowledgement_required), eventId, taskId, id]
      );
      await client.query("DELETE FROM announcement_recipients WHERE announcement_id = $1", [id]);
      for (const userId of target.recipientIds) {
        await client.query("INSERT INTO announcement_recipients (announcement_id, user_id) VALUES ($1, $2)", [id, userId]);
      }
      await client.query("INSERT INTO activity_logs (user_id, action, details) VALUES ($1, $2, $3)", [req.userId, "Edit announcement", `Announcement ${id} updated.`]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    if (status === "published") {
      const recipients = await announcementRecipients(audience, target.departmentId ?? null, target.recipientIds, req.userId!);
      await createNotifications(recipients.map((userId) => announcementNotificationInput(userId, result.rows[0])));
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update announcement error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/announcements/:id/acknowledge", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const id = parsePositiveId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid announcement ID" });
    const profile = await pool.query("SELECT department_id FROM users WHERE id = $1", [req.userId]);
    const access = await pool.query(
      `SELECT a.id FROM announcements a WHERE a.id = $4 AND a.acknowledgement_required = true
       AND a.created_by <> $1 AND a.status = 'published' AND a.published_at <= NOW()
       AND (a.expires_at IS NULL OR a.expires_at > NOW())
       AND (
         a.audience = 'college'
         OR (a.audience = 'super_admin' AND $2 = 'super_admin')
         OR (a.audience = 'dept_head' AND $2 = 'dept_head')
         OR (a.audience = 'employee' AND $2 = 'employee')
         OR (a.audience = 'department' AND a.target_dept_id = $3)
         OR (a.audience = 'selected_users' AND EXISTS (
           SELECT 1 FROM announcement_recipients ar WHERE ar.announcement_id = a.id AND ar.user_id = $1
         ))
       )`,
      [req.userId, req.userRole, profile.rows[0]?.department_id ?? null, id]
    );
    if (!access.rows.length) return res.status(404).json({ error: "Acknowledgement is unavailable for this announcement" });
    const result = await pool.query(
      `INSERT INTO announcement_acknowledgements (announcement_id, user_id)
       VALUES ($1, $2) ON CONFLICT (announcement_id, user_id) DO UPDATE
       SET acknowledged_at = announcement_acknowledgements.acknowledged_at
       RETURNING acknowledged_at`,
      [id, req.userId]
    );
    res.json({ acknowledged: true, acknowledged_at: result.rows[0].acknowledged_at });
  } catch (err) {
    console.error("Acknowledge announcement error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/announcements/:id/pin", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const id = parsePositiveId(req.params.id);
    if (!id || typeof req.body.is_pinned !== "boolean") return res.status(400).json({ error: "A valid announcement ID and pin state are required" });
    if (!(await canManageAnnouncement(req, id))) return res.status(403).json({ error: "Announcement management access required" });
    const result = await pool.query("UPDATE announcements SET is_pinned = $1, updated_at = NOW() WHERE id = $2 RETURNING id, is_pinned", [req.body.is_pinned, id]);
    if (!result.rows.length) return res.status(404).json({ error: "Announcement not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Pin announcement error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/announcements/:id/archive", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const id = parsePositiveId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid announcement ID" });
    if (!(await canManageAnnouncement(req, id))) return res.status(403).json({ error: "Announcement management access required" });
    const result = await pool.query(
      "UPDATE announcements SET status = 'archived', archived_at = NOW(), is_pinned = false, updated_at = NOW() WHERE id = $1 RETURNING id, status, archived_at",
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Announcement not found" });
    await pool.query("INSERT INTO activity_logs (user_id, action, details) VALUES ($1, $2, $3)", [req.userId, "Archive announcement", `Announcement ${id} archived.`]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Archive announcement error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ==========================================
// CHAT MESSAGING SECTION
// ==========================================

async function channelScope(req: AuthRequest, channelId?: number) {
  const channelFilter = channelId ? "AND c.id = $2" : "";
  const params = channelId ? [req.userId, channelId] : [req.userId];
  return pool.query(
    `SELECT c.id, c.name, c.channel_type, c.department_id, c.event_id,
            d.name AS department_name, e.title AS event_title
     FROM conversations c
    JOIN users viewer ON viewer.id = $1
     LEFT JOIN departments d ON d.id = c.department_id
     LEFT JOIN events e ON e.id = c.event_id
     WHERE (
       (c.channel_type = 'department' AND (viewer.role = 'super_admin' OR c.department_id = viewer.department_id))
       OR (c.channel_type = 'event' AND (
         viewer.role = 'super_admin'
         OR e.department_id IS NULL
         OR e.department_id = viewer.department_id
         OR EXISTS (
           SELECT 1 FROM tasks assigned_task WHERE assigned_task.event_id = e.id
             AND (assigned_task.assigned_to_id = viewer.id OR assigned_task.assigned_dept_id = viewer.department_id)
         )
       ))
     ) ${channelFilter}`,
    params
  );
}

router.get("/channels", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    await pool.query(
      `INSERT INTO conversations (name, channel_type, department_id)
       SELECT d.name || ' Department', 'department', d.id FROM departments d
       ON CONFLICT (department_id) WHERE channel_type = 'department' DO NOTHING`
    );
    await pool.query(
      `INSERT INTO conversations (name, channel_type, event_id)
       SELECT e.title, 'event', e.id FROM events e
       ON CONFLICT (event_id) WHERE channel_type = 'event' DO NOTHING`
    );

    const accessible = await channelScope(req);
    for (const channel of accessible.rows) {
      await pool.query(
        "INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT (conversation_id, user_id) DO NOTHING",
        [channel.id, req.userId]
      );
    }

    const result = await pool.query(
      `SELECT c.id, c.name, c.channel_type, c.department_id, c.event_id,
              d.name AS department_name, e.title AS event_title,
              latest.text AS last_message, latest.created_at AS last_message_time,
              (SELECT COUNT(*)::integer FROM conversation_messages unread
               WHERE unread.conversation_id = c.id AND unread.user_id IS DISTINCT FROM $1
                 AND unread.created_at > COALESCE(member.last_read_at, member.joined_at)) AS unread_count
       FROM conversations c
       JOIN conversation_members member ON member.conversation_id = c.id AND member.user_id = $1
       LEFT JOIN departments d ON d.id = c.department_id
       LEFT JOIN events e ON e.id = c.event_id
       LEFT JOIN LATERAL (
         SELECT text, created_at FROM conversation_messages
         WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1
       ) latest ON true
       WHERE c.id = ANY($2::integer[])
       ORDER BY COALESCE(latest.created_at, c.created_at) DESC, c.name ASC`,
      [req.userId, accessible.rows.map((channel) => channel.id)]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("List channels error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/channels/:id/messages", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const channelId = parsePositiveId(req.params.id);
    if (!channelId) return res.status(400).json({ error: "Invalid channel ID" });
    const channel = await channelScope(req, channelId);
    if (!channel.rows.length) return res.status(404).json({ error: "Channel not found" });
    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;
    const beforeId = req.query.before_id === undefined ? null : parsePositiveId(req.query.before_id);
    if (req.query.before_id !== undefined && !beforeId) return res.status(400).json({ error: "Invalid message cursor" });
    const result = await pool.query(
      `SELECT m.id, m.conversation_id, m.user_id, m.sender_name, m.text, m.created_at
       FROM conversation_messages m WHERE m.conversation_id = $1
         AND ($2::integer IS NULL OR m.id < $2)
       ORDER BY m.id DESC LIMIT $3`,
      [channelId, beforeId, limit]
    );
    await pool.query(
      `INSERT INTO conversation_members (conversation_id, user_id, last_read_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at = NOW()`,
      [channelId, req.userId]
    );
    const messages = result.rows.reverse();
    res.json({ channel: channel.rows[0], messages, next_before_id: messages.length === limit ? messages[0].id : null });
  } catch (err) {
    console.error("List channel messages error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/channels/:id/messages", authenticate, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  try {
    const channelId = parsePositiveId(req.params.id);
    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    if (!channelId) return res.status(400).json({ error: "Invalid channel ID" });
    if (!text || text.length > 5000) return res.status(400).json({ error: "Message must contain 1 to 5000 characters" });
    const channel = await channelScope(req, channelId);
    if (!channel.rows.length) return res.status(404).json({ error: "Channel not found" });
    const profile = await pool.query("SELECT name FROM users WHERE id = $1", [req.userId]);

    await client.query("BEGIN");
    await client.query(
      "INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT (conversation_id, user_id) DO NOTHING",
      [channelId, req.userId]
    );
    const result = await client.query(
      `INSERT INTO conversation_messages (conversation_id, user_id, sender_name, text)
       VALUES ($1, $2, $3, $4) RETURNING id, conversation_id, user_id, sender_name, text, created_at`,
      [channelId, req.userId, profile.rows[0].name, text]
    );
    const message = result.rows[0];
    await client.query(
      "INSERT INTO activity_logs (user_id, action, details) VALUES ($1, $2, $3)",
      [req.userId, "Send channel message", `Message ${message.id} posted to channel ${channelId}.`]
    );
    await client.query("COMMIT");

    const members = await pool.query(
      "SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2",
      [channelId, req.userId]
    );
    await createNotifications(members.rows.map((member) => ({
      userId: member.user_id as number,
      type: "channel_message",
      title: `New message in ${channel.rows[0].name}`,
      message: text.slice(0, 180),
      entityType: channel.rows[0].channel_type === "event" ? "event" : "conversation",
      entityId: channel.rows[0].event_id || channelId,
      dedupeKey: `conversation:${channelId}:message:${message.id}`,
    })));
    res.status(201).json(message);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Send channel message error:", err);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

// GET /api/messages/contacts - List active contacts for chat
router.get("/contacts", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const isPrivileged = req.userRole === "super_admin" || req.userRole === "dept_head";

    if (isPrivileged) {
      // Super Admins and Department Heads get the employee contact list
      const result = await pool.query(
        "SELECT id, name, role FROM users WHERE role != 'super_admin' ORDER BY name ASC"
      );
      const contacts = await Promise.all(
        result.rows.map(async (contact) => {
          const lastMsg = await pool.query(
            `SELECT text, created_at, sent_by_user FROM messages 
             WHERE user_id = $1
             ORDER BY created_at DESC LIMIT 1`,
            [contact.id]
          );
          return {
            ...contact,
            name: `${contact.name} (${contact.role.replace('_', ' ')})`,
            last_message: lastMsg.rows[0]?.text || "No messages yet",
            last_message_time: lastMsg.rows[0]?.created_at || null,
          };
        })
      );
      res.json(contacts);
    } else {
      // Employees and Dept Heads get single "Campus Support" Admin contact
      const lastMsg = await pool.query(
        `SELECT text, created_at, sent_by_user FROM messages 
         WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [req.userId]
      );
      res.json([
        {
          id: 0,
          name: "Campus Support",
          last_message: lastMsg.rows[0]?.text || "No messages yet",
          last_message_time: lastMsg.rows[0]?.created_at || null,
        },
      ]);
    }
  } catch (err) {
    console.error("Contacts error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/messages/:contactId - Get chat messages with a contact
router.get("/:contactId", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { contactId } = req.params;
    const isPrivileged = req.userRole === "super_admin" || req.userRole === "dept_head";
    const targetUserId = isPrivileged ? contactId : req.userId;

    const result = await pool.query(
      `SELECT id, text, sent_by_user, created_at
       FROM messages
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [targetUserId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Get messages error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/messages/:contactId - Send a chat message
router.post("/:contactId", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { contactId } = req.params;
    const { text } = req.body;
    if (!text) {
      res.status(400).json({ error: "Message text required" });
      return;
    }

    const isPrivileged = req.userRole === "super_admin" || req.userRole === "dept_head";
    const targetUserId = isPrivileged ? contactId : req.userId;
    const sentByUser = !isPrivileged; // sentByUser means sent by student/employee

    const result = await pool.query(
      `INSERT INTO messages (user_id, contact_id, text, sent_by_user)
       VALUES ($1, NULL, $2, $3)
       RETURNING *`,
      [targetUserId, text, sentByUser]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Send message error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
