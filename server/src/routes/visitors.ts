import { Router, Response } from "express";
import crypto from "crypto";
import pool from "../db.js";
import { authenticate, AuthRequest } from "../middleware/auth.js";
import { isNonEmptyString, parsePositiveId, parseTimestamp } from "../validation.js";
import { logEmailFailure, sendVisitorInvitationEmail, visitorEmailFailureMessage } from "../email.js";
import { createInAppNotification } from "../notifications.js";

const router = Router();
router.use(authenticate);
const canManage = (req: AuthRequest) => ["admin", "super_admin", "dept_head"].includes(req.userRole || "");
const isAdmin = (req: AuthRequest) => req.userRole === "admin" || req.userRole === "super_admin";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidVisitTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second = "0"] = match;
  const date = `${year}-${month}-${day}`;
  if (new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) return false;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false;
  return Number.isFinite(Date.parse(value));
}

async function deliverVisitorInvitation(visitorId: number, performedBy: number, requestKey: string, resend = false) {
  const claimed = await pool.query(
    `UPDATE visitors
     SET email_status = 'Sending', email_last_attempt_at = NOW(), email_attempt_count = email_attempt_count + 1,
         email_last_error = NULL, email_request_key = $3, updated_at = NOW()
     WHERE id = $1 AND contact LIKE '%@%'
       AND (email_status IN ('Pending', 'Failed') OR ($2::boolean AND email_status = 'Sent')
            OR (email_status = 'Sending' AND email_last_attempt_at < NOW() - INTERVAL '5 minutes'))
       AND (email_request_key IS DISTINCT FROM $3::uuid
            OR (email_status = 'Sending' AND email_last_attempt_at < NOW() - INTERVAL '5 minutes'))
     RETURNING id, contact`,
    [visitorId, resend, requestKey]
  );

  if (!claimed.rows.length) {
    const current = await pool.query("SELECT * FROM visitors WHERE id = $1", [visitorId]);
    return current.rows[0] || null;
  }

  try {
    const result = await pool.query(
            `SELECT v.id, v.name, v.contact, v.organization, v.purpose,
              v.expected_arrival AT TIME ZONE s.timezone AS expected_arrival_zoned, v.pass_code,
              h.name AS host_name, e.title AS event_name, COALESCE(e.location, s.college_address) AS location,
              s.organization_name, s.support_email, s.timezone
       FROM visitors v
       LEFT JOIN users h ON h.id = v.host_id
       LEFT JOIN events e ON e.id = v.event_id
       CROSS JOIN system_settings s
       WHERE v.id = $1 AND s.id = 1`,
      [visitorId]
    );
    const visitor = result.rows[0];
    if (!visitor || !emailPattern.test(visitor.contact)) throw new Error("Invalid visitor email");
    const timezone = visitor.timezone || "Asia/Kolkata";
    const visitDateTime = new Intl.DateTimeFormat("en", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date(visitor.expected_arrival_zoned));

    await sendVisitorInvitationEmail(visitor.contact, {
      visitorName: visitor.name,
      organization: visitor.organization,
      purpose: visitor.purpose,
      visitDateTime,
      hostName: visitor.host_name || "College host",
      eventName: visitor.event_name,
      location: visitor.location,
      passCode: visitor.pass_code,
      collegeName: visitor.organization_name,
      supportEmail: visitor.support_email,
    });
  } catch (error) {
    logEmailFailure("Visitor invitation email failed", error);
    const failureMessage = visitorEmailFailureMessage(error);
    const failed = await pool.query(
      "UPDATE visitors SET email_status = 'Failed', email_last_error = $3, updated_at = NOW() WHERE id = $1 AND email_status = 'Sending' AND email_request_key = $2 RETURNING id",
      [visitorId, requestKey, failureMessage]
    );
    if (failed.rows.length) {
      await pool.query("INSERT INTO visitor_activity (visitor_id, action, performed_by, details) VALUES ($1, 'INVITATION_FAILED', $2, $3)", [visitorId, performedBy, failureMessage]).catch(() => undefined);
    }
    const updated = await pool.query("SELECT * FROM visitors WHERE id = $1", [visitorId]);
    return updated.rows[0] || null;
  }

  const sent = await pool.query(
    "UPDATE visitors SET email_status = 'Sent', email_last_error = NULL, updated_at = NOW() WHERE id = $1 AND email_status = 'Sending' AND email_request_key = $2 RETURNING id",
    [visitorId, requestKey]
  );
  if (sent.rows.length) {
    await pool.query("INSERT INTO visitor_activity (visitor_id, action, performed_by, details) VALUES ($1, 'INVITATION_SENT', $2, $3)", [visitorId, performedBy, "Invitation accepted by the configured email provider."]).catch((error) => console.error("Visitor invitation activity logging failed:", error instanceof Error ? error.name : "Unknown error"));
  }
  const updated = await pool.query("SELECT * FROM visitors WHERE id = $1", [visitorId]);
  return updated.rows[0] || null;
}

async function notifyVisitorHost(visitorId: number, performedBy: number) {
  try {
    const result = await pool.query(
      `SELECT v.id, v.name, v.organization, v.purpose, v.host_id,
              v.expected_arrival AT TIME ZONE s.timezone AS expected_arrival_zoned,
              e.title AS event_title, s.timezone
       FROM visitors v
       LEFT JOIN events e ON e.id = v.event_id
       CROSS JOIN system_settings s
       WHERE v.id = $1 AND s.id = 1`,
      [visitorId]
    );
    const visitor = result.rows[0];
    if (!visitor?.host_id) throw new Error("Visitor has no assigned host");
    const visitDateTime = new Intl.DateTimeFormat("en", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: visitor.timezone || "Asia/Kolkata",
    }).format(new Date(visitor.expected_arrival_zoned));
    const organization = visitor.organization ? ` from ${visitor.organization}` : "";
    const event = visitor.event_title ? ` for ${visitor.event_title}` : "";
    const notificationCreated = await createInAppNotification({
      userId: visitor.host_id,
      type: "visitor_registered",
      title: "Upcoming Visitor",
      message: `${visitor.name}${organization} is scheduled to visit you on ${visitDateTime} for ${visitor.purpose}${event}.`,
      entityType: "visitor",
      entityId: visitor.id,
      dedupeKey: `visitor:${visitor.id}:host:${visitor.host_id}:registered`,
    });
    if (notificationCreated) {
      await pool.query("INSERT INTO visitor_activity (visitor_id, action, performed_by, details) VALUES ($1, 'HOST_NOTIFIED', $2, $3)", [visitorId, performedBy, "Assigned host received an in-app notification."]).catch((error) => console.error("Visitor host notification activity failed:", error instanceof Error ? error.name : "Unknown error"));
    }
    return notificationCreated ? "Sent" : "Already Sent";
  } catch (error) {
    console.error("Visitor host in-app notification failed:", error instanceof Error ? error.message : "Unknown error");
    await pool.query("INSERT INTO visitor_activity (visitor_id, action, performed_by, details) VALUES ($1, 'HOST_NOTIFICATION_FAILED', $2, $3)", [visitorId, performedBy, "Assigned host could not be notified in-app. Registration and visitor pass were preserved."]).catch(() => undefined);
    return "Failed";
  }
}

router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const limitValue = Number(req.query.limit ?? 25);
    const offsetValue = Number(req.query.offset ?? 0);
    if (!Number.isInteger(limitValue) || limitValue < 1 || !Number.isInteger(offsetValue) || offsetValue < 0) {
      return res.status(400).json({ error: "Limit and offset must be valid non-negative integers" });
    }
    const limit = Math.min(limitValue, 100);
    const offset = offsetValue;
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : "";
    const params: unknown[] = [];
    const filters: string[] = [];
    const add = (value: unknown) => { params.push(value); return `$${params.length}`; };
    if (search) {
      const searchParam = add(search.replace(/[\\%_]/g, "\\$&"));
      filters.push(`(v.name ILIKE '%' || ${searchParam} || '%' ESCAPE '\\' OR v.contact ILIKE '%' || ${searchParam} || '%' ESCAPE '\\' OR COALESCE(v.organization,'') ILIKE '%' || ${searchParam} || '%' ESCAPE '\\' OR v.purpose ILIKE '%' || ${searchParam} || '%' ESCAPE '\\')`);
    }
    if (!isAdmin(req)) filters.push(`v.host_id = ${add(req.userId)}`);
    const status = typeof req.query.status === "string" ? req.query.status : "";
    if (status && status !== "All") {
      if (!["Expected", "Checked In", "Checked Out", "Cancelled"].includes(status)) return res.status(400).json({ error: "Invalid visitor status filter" });
      filters.push(`v.status = ${add(status)}`);
    }
    if (req.query.event_id !== undefined && req.query.event_id !== "") {
      const eventId = parsePositiveId(req.query.event_id);
      if (!eventId) return res.status(400).json({ error: "Event ID must be a positive integer" });
      filters.push(`v.event_id = ${add(eventId)}`);
    }
    if (req.query.host_id !== undefined && req.query.host_id !== "") {
      if (!isAdmin(req)) return res.status(403).json({ error: "Only administrators can filter all hosts" });
      const hostId = parsePositiveId(req.query.host_id);
      if (!hostId) return res.status(400).json({ error: "Host ID must be a positive integer" });
      filters.push(`v.host_id = ${add(hostId)}`);
    }
    const emailStatus = typeof req.query.email_status === "string" ? req.query.email_status : "";
    if (emailStatus) {
      if (!["Not Applicable", "Pending", "Sending", "Sent", "Failed"].includes(emailStatus)) return res.status(400).json({ error: "Invalid invitation status filter" });
      filters.push(`v.email_status = ${add(emailStatus)}`);
    }
    for (const [key, operator] of [["from", ">="], ["to", "<"]] as const) {
      const value = req.query[key];
      if (value !== undefined && value !== "") {
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
          return res.status(400).json({ error: `Visit ${key} date must be a valid YYYY-MM-DD date` });
        }
        const bound = key === "to" ? new Date(Date.parse(`${value}T00:00:00.000Z`) + 86400000).toISOString().slice(0, 10) : value;
        filters.push(`v.expected_arrival ${operator} ${add(bound)}::date`);
      }
    }
    const from = typeof req.query.from === "string" ? req.query.from : "";
    const to = typeof req.query.to === "string" ? req.query.to : "";
    if (from && to && from > to) return res.status(400).json({ error: "Visit start date must be on or before end date" });
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const countResult = await pool.query(`SELECT COUNT(*)::integer AS total FROM visitors v ${where}`, params);
    const pageParams = [...params, limit, offset];
    const result = await pool.query(
      `SELECT v.*, e.title AS event_title, h.name AS host_name, c.name AS created_by_name
       FROM visitors v LEFT JOIN events e ON e.id = v.event_id LEFT JOIN users h ON h.id = v.host_id LEFT JOIN users c ON c.id = v.created_by
       ${where} ORDER BY v.expected_arrival DESC, v.id DESC LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams
    );
    const countParams: unknown[] = [];
    const countScope = isAdmin(req) ? "" : `WHERE host_id = $1`;
    if (!isAdmin(req)) countParams.push(req.userId);
    const counts = await pool.query(`SELECT COUNT(*) FILTER (WHERE status='Expected')::int AS expected, COUNT(*) FILTER (WHERE status='Checked In')::int AS checked_in, COUNT(*) FILTER (WHERE status='Checked Out')::int AS checked_out FROM visitors ${countScope}`, countParams);
    res.json({ visitors: result.rows, counts: counts.rows[0], total: countResult.rows[0].total, limit, offset });
  } catch (error) { console.error("List visitors error:", error); res.status(500).json({ error: "Server error" }); }
});

router.get("/:id", async (req: AuthRequest, res: Response) => {
  try {
    if (!parsePositiveId(req.params.id)) return res.status(400).json({ error: "Visitor ID must be a valid positive integer" });
    const result = await pool.query(`SELECT v.*, e.title AS event_title, h.name AS host_name FROM visitors v LEFT JOIN events e ON e.id=v.event_id LEFT JOIN users h ON h.id=v.host_id WHERE v.id=$1`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "Visitor not found" });
    const visitor = result.rows[0]; if (!isAdmin(req) && visitor.host_id !== req.userId) return res.status(403).json({ error: "Visitor access denied" });
    const activity = await pool.query("SELECT va.*, u.name AS performed_by_name FROM visitor_activity va LEFT JOIN users u ON u.id=va.performed_by WHERE visitor_id=$1 ORDER BY created_at DESC", [req.params.id]);
    res.json({ ...visitor, activity: activity.rows });
  } catch (error) { console.error("Visitor detail error:", error); res.status(500).json({ error: "Server error" }); }
});

router.post("/", async (req: AuthRequest, res: Response) => {
  try {
    if (!canManage(req)) return res.status(403).json({ error: "Visitor management access required" });
    const { name, contact, organization, purpose, event_id, host_id, expected_arrival, registration_key } = req.body;
    if (!isNonEmptyString(name) || name.trim().length > 150 || !isNonEmptyString(contact) || !isNonEmptyString(purpose) || purpose.trim().length > 2000 || !expected_arrival) {
      return res.status(400).json({ error: "Name, contact, purpose, and expected arrival are required" });
    }
    if (typeof organization === "string" && organization.trim().length > 150) return res.status(400).json({ error: "Organization must be 150 characters or fewer" });
    if (!isValidVisitTimestamp(expected_arrival) || parseTimestamp(expected_arrival) === null) return res.status(400).json({ error: "Expected arrival must be a valid date and time" });
    const normalizedContact = contact.trim();
    const hasEmail = normalizedContact.includes("@");
    if (hasEmail && !emailPattern.test(normalizedContact)) return res.status(400).json({ error: "Contact email must be valid" });
    if (!hasEmail && !/^\+?[\d\s().-]{7,20}$/.test(normalizedContact)) return res.status(400).json({ error: "Contact number must be valid" });
    if (registration_key !== undefined && (typeof registration_key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(registration_key))) {
      return res.status(400).json({ error: "Registration request key must be a valid UUID" });
    }
    const host = host_id === undefined ? req.userId : parsePositiveId(host_id);
    if (!host) return res.status(400).json({ error: "Host ID must be a valid positive integer" });
    if (!isAdmin(req) && host !== req.userId) return res.status(403).json({ error: "You can register visitors only under your own host account" });
    const hostResult = await pool.query("SELECT id FROM users WHERE id = $1 AND is_active = true", [host]);
    if (!hostResult.rows.length) return res.status(404).json({ error: "Host user not found" });
    const eventId = event_id == null || event_id === "" ? null : parsePositiveId(event_id);
    if (event_id != null && event_id !== "" && !eventId) return res.status(400).json({ error: "Event ID must be a valid positive integer" });
    if (eventId) {
      const eventResult = await pool.query("SELECT id FROM events WHERE id = $1 AND deleted_at IS NULL AND status <> 'Cancelled'", [eventId]);
      if (!eventResult.rows.length) return res.status(404).json({ error: "Event not found or unavailable" });
    }
    const passCode = `VP-${crypto.randomBytes(16).toString("hex").toUpperCase()}`;
    const requestKey = registration_key || crypto.randomUUID();
    const client = await pool.connect();
    let visitor;
    let created = false;
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO visitors (name, contact, organization, purpose, event_id, host_id, expected_arrival, pass_code, email_status, registration_key, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (registration_key) WHERE registration_key IS NOT NULL DO NOTHING
         RETURNING *`,
        [name.trim(), normalizedContact, typeof organization === "string" ? organization.trim() || null : null, purpose.trim(), eventId, host,
          expected_arrival, passCode, hasEmail ? "Pending" : "Not Applicable", requestKey, req.userId]
      );
      visitor = result.rows[0];
      created = Boolean(visitor);
      if (!visitor) {
        const existing = await client.query("SELECT * FROM visitors WHERE registration_key = $1", [requestKey]);
        if (!existing.rows.length) throw new Error("Idempotent visitor registration could not be loaded");
        visitor = existing.rows[0];
      } else {
        await client.query("INSERT INTO visitor_activity (visitor_id, action, performed_by, details) VALUES ($1, 'REGISTERED', $2, $3)", [visitor.id, req.userId, "Visitor registered"]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    let hostNotificationStatus: string | undefined;
    if (created) {
      if (hasEmail) visitor = await deliverVisitorInvitation(visitor.id, req.userId!, requestKey);
      hostNotificationStatus = await notifyVisitorHost(visitor.id, req.userId!);
    }
    res.status(created ? 201 : 200).json({ ...visitor, ...(hostNotificationStatus ? { host_notification_status: hostNotificationStatus } : {}) });
  } catch (error) { console.error("Register visitor error:", error); res.status(500).json({ error: "Server error" }); }
});

router.post("/:id/resend-invitation", async (req: AuthRequest, res: Response) => {
  try {
    const visitorId = parsePositiveId(req.params.id);
    if (!visitorId) return res.status(400).json({ error: "Visitor ID must be a valid positive integer" });
    const requestKey = req.body?.request_key;
    if (typeof requestKey !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey)) {
      return res.status(400).json({ error: "Email retry request key must be a valid UUID" });
    }
    const result = await pool.query("SELECT id, host_id, contact, email_status, email_last_attempt_at FROM visitors WHERE id = $1", [visitorId]);
    if (!result.rows.length) return res.status(404).json({ error: "Visitor not found" });
    const visitor = result.rows[0];
    if (!isAdmin(req) && visitor.host_id !== req.userId) return res.status(403).json({ error: "Visitor access denied" });
    if (!emailPattern.test(visitor.contact)) return res.status(400).json({ error: "This visitor does not have a valid email address" });
    if (visitor.email_status === "Sending" && visitor.email_last_attempt_at && Date.now() - new Date(visitor.email_last_attempt_at).getTime() < 5 * 60 * 1000) {
      return res.status(409).json({ error: "An invitation email attempt is already in progress" });
    }
    const updated = await deliverVisitorInvitation(visitorId, req.userId!, requestKey, true);
    return res.json(updated);
  } catch (error) {
    console.error("Retry visitor invitation error:", error);
    return res.status(500).json({ error: "Unable to retry visitor invitation" });
  }
});

async function updateStatus(req: AuthRequest, res: Response, status: string) {
  if (!canManage(req)) return res.status(403).json({ error: "Visitor management access required" });
  if (!parsePositiveId(req.params.id)) return res.status(400).json({ error: "Visitor ID must be a valid positive integer" });
  const result = await pool.query("SELECT id, host_id, status FROM visitors WHERE id = $1", [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: "Visitor not found" });
  if (!isAdmin(req) && result.rows[0].host_id !== req.userId) return res.status(403).json({ error: "Visitor access denied" });
  const expectedStatus = status === "Checked In" ? "Expected" : "Checked In";
  const timeColumn = status === "Checked In" ? "check_in_at" : "check_out_at";
  const updated = await pool.query(
    `UPDATE visitors SET status = $1, ${timeColumn} = NOW(), updated_at = NOW()
     WHERE id = $2 AND status = $3 ${status === "Checked Out" ? "AND check_in_at IS NOT NULL AND check_in_at <= NOW()" : ""}
     RETURNING *`,
    [status, req.params.id, expectedStatus]
  );
  if (!updated.rows.length) return res.status(409).json({ error: status === "Checked In" ? "Only expected visitors can be checked in" : "Visitor must be checked in before check-out" });
  await pool.query("INSERT INTO visitor_activity (visitor_id,action,performed_by,details) VALUES ($1,$2,$3,$4)", [req.params.id, status === "Checked In" ? "CHECK_IN" : "CHECK_OUT", req.userId, `Visitor ${status.toLowerCase()}`]);
  res.json(updated.rows[0]);
}
router.post("/:id/check-in", async (req: AuthRequest, res: Response) => { try { return await updateStatus(req, res, "Checked In"); } catch (error) { console.error("Visitor check-in error:", error); res.status(500).json({ error: "Server error" }); } });
router.post("/:id/check-out", async (req: AuthRequest, res: Response) => { try { return await updateStatus(req, res, "Checked Out"); } catch (error) { console.error("Visitor check-out error:", error); res.status(500).json({ error: "Server error" }); } });

router.post("/:id/cancel", async (req: AuthRequest, res: Response) => {
  try {
    if (!canManage(req)) return res.status(403).json({ error: "Visitor management access required" });
    const visitorId = parsePositiveId(req.params.id);
    if (!visitorId) return res.status(400).json({ error: "Visitor ID must be a valid positive integer" });
    const existing = await pool.query("SELECT id, host_id, status FROM visitors WHERE id = $1", [visitorId]);
    if (!existing.rows.length) return res.status(404).json({ error: "Visitor not found" });
    if (!isAdmin(req) && existing.rows[0].host_id !== req.userId) return res.status(403).json({ error: "Visitor access denied" });
    const cancelled = await pool.query("UPDATE visitors SET status = 'Cancelled', updated_at = NOW() WHERE id = $1 AND status = 'Expected' RETURNING *", [visitorId]);
    if (!cancelled.rows.length) return res.status(409).json({ error: "Only expected visitors can be cancelled" });
    await pool.query("INSERT INTO visitor_activity (visitor_id, action, performed_by, details) VALUES ($1, 'CANCELLED', $2, $3)", [visitorId, req.userId, "Visitor registration cancelled"]);
    return res.json(cancelled.rows[0]);
  } catch (error) {
    console.error("Cancel visitor registration error:", error);
    return res.status(500).json({ error: "Unable to cancel visitor registration" });
  }
});

export default router;