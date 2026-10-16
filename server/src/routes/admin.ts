import { Router, Response, Request } from "express";
import bcrypt from "bcryptjs";
import pool, { initDb } from "../db.js";
import {
  authenticate,
  requireAdmin,
  AuthRequest,
} from "../middleware/auth.js";
import { createNotifications, notifyTaskAudience } from "../notifications.js";
import { sendAccountSetupEmail } from "../email.js";
import crypto from "crypto";
import { sendVerificationEmail } from "../email.js";
import { isEmail, isNonEmptyString, parsePositiveId, passwordError, isOneOf, USER_ROLES } from "../validation.js";

const router = Router();

const BLOCKING_BOOKING_STATUSES = ["Pending", "Approved", "Active", "Confirmed"];
const DEPARTMENT_TYPES = ["academic", "administrative", "support"] as const;
const COLLEGE_ROLES = ["principal", "hod", "teacher", "office_staff", "laboratory_assistant", "support_staff", "staff"] as const;
const COLLEGE_ROLE_ACCESS: Record<(typeof COLLEGE_ROLES)[number], "employee" | "dept_head"> = {
  principal: "employee",
  hod: "dept_head",
  teacher: "employee",
  office_staff: "employee",
  laboratory_assistant: "employee",
  support_staff: "employee",
  staff: "employee",
};

function collegeRoleFromLegacy(role: string) {
  return role === "dept_head" ? "hod" : role === "employee" ? "staff" : "super_admin";
}

function databaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
}

function validateBookingTimes(startTime: unknown, endTime: unknown): { startTime: string; endTime: string } | null {
  if (typeof startTime !== "string" || typeof endTime !== "string" || !startTime.trim() || !endTime.trim()) {
    return null;
  }

  const start = Date.parse(startTime);
  const end = Date.parse(endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    return null;
  }

  return { startTime: startTime.trim(), endTime: endTime.trim() };
}

async function lockResources(client: import("pg").PoolClient, resourceIds: number[]) {
  for (const resourceId of [...new Set(resourceIds)].sort((a, b) => a - b)) {
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [resourceId]);
  }
}

async function findBookingConflict(
  client: import("pg").PoolClient,
  resourceId: number,
  startTime: string,
  endTime: string,
  excludedBookingId?: number
) {
  const params: unknown[] = [resourceId, startTime, endTime, BLOCKING_BOOKING_STATUSES];
  const exclusion = excludedBookingId ? "AND id <> $5" : "";
  if (excludedBookingId) params.push(excludedBookingId);

  return client.query(
    `SELECT id, start_time, end_time
     FROM resource_bookings
     WHERE resource_id = $1
       AND status = ANY($4::varchar[])
       AND start_time < $3::timestamp
       AND end_time > $2::timestamp
       ${exclusion}
     ORDER BY start_time ASC
     LIMIT 1`,
    params
  );
}

function conflictMessage(conflict: { start_time: string; end_time: string }) {
  return `This resource is already booked from ${new Date(conflict.start_time).toLocaleString()} to ${new Date(conflict.end_time).toLocaleString()} during the selected time period.`;
}

type AuditQuery = {
  action?: unknown;
  search?: unknown;
  actor_id?: unknown;
  entity_type?: unknown;
  outcome?: unknown;
  from?: unknown;
  to?: unknown;
};

function isAuditDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function buildAuditFilters(query: AuditQuery, scope: "filtered" | "date" = "filtered") {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const addFilter = (sql: string, value: unknown) => {
    params.push(value);
    conditions.push(sql.replace("?", `$${params.length}`));
  };

  if (scope === "filtered") {
    const action = typeof query.action === "string" ? query.action.trim() : "";
    const search = typeof query.search === "string" ? query.search.trim() : "";
    if (action) {
      if (action.length > 255) return { error: "Action filter is too long" as const };
      addFilter("al.action = ?", action);
    }
    if (search) {
      if (search.length > 120) return { error: "Search must be 120 characters or fewer" as const };
      params.push(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
      conditions.push(`(al.action ILIKE $${params.length} ESCAPE '\\' OR al.details ILIKE $${params.length} ESCAPE '\\' OR u.name ILIKE $${params.length} ESCAPE '\\' OR u.email ILIKE $${params.length} ESCAPE '\\')`);
    }
    if (query.actor_id !== undefined && query.actor_id !== "") {
      const actorId = parsePositiveId(query.actor_id);
      if (!actorId) return { error: "Actor ID must be a positive integer" as const };
      addFilter("al.user_id = ?", actorId);
    }
    if (typeof query.entity_type === "string" && query.entity_type.trim()) {
      if (query.entity_type.trim().length > 40) return { error: "Entity type is too long" as const };
      addFilter("al.entity_type = ?", query.entity_type.trim());
    }
    if (typeof query.outcome === "string" && query.outcome.trim()) {
      if (query.outcome.trim().length > 30) return { error: "Outcome filter is too long" as const };
      addFilter("al.outcome = ?", query.outcome.trim());
    }
  }

  for (const [key, op] of [["from", ">="], ["to", "<"]] as const) {
    const value = query[key];
    if (value !== undefined && value !== "") {
      if (!isAuditDate(value)) return { error: `Audit ${key} date must use a valid YYYY-MM-DD date` as const };
      const exclusiveTo = key === "to"
        ? new Date(Date.parse(`${value}T00:00:00.000Z`) + 86400000).toISOString().slice(0, 10)
        : value;
      addFilter(`al.created_at ${op} ?::date`, exclusiveTo);
    }
  }
  const from = typeof query.from === "string" ? query.from : "";
  const to = typeof query.to === "string" ? query.to : "";
  if (from && to && from > to) return { error: "Start date must be on or before end date" as const };
  return { conditions, params };
}

function redactSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveFields);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) =>
      [key, /password|token|secret|credential|authorization|cookie/i.test(key) ? "[REDACTED]" : redactSensitiveFields(child)]
    ));
  }
  return value;
}

function csvCell(value: unknown): string {
  const raw = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  const safe = /^[=+@\-\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

// All admin routes require authentication
router.use(authenticate);

// ==========================================
// SUPER ADMIN & SYSTEM LOGS SECTION
// ==========================================

router.get("/logs/summary", async (req: AuthRequest, res: Response) => {
  if (req.userRole !== "super_admin") return res.status(403).json({ error: "Super Admin access required" });
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::integer AS total,
              COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE AND created_at < CURRENT_DATE + INTERVAL '1 day')::integer AS today,
              COUNT(*) FILTER (WHERE LOWER(outcome) = 'success')::integer AS successful,
              COUNT(*) FILTER (WHERE LOWER(outcome) IN ('failure', 'failed', 'error'))::integer AS failed
       FROM activity_logs`
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Fetch audit summary error:", err);
    res.status(500).json({ error: "Unable to load audit summary" });
  }
});

router.get("/logs/options", async (req: AuthRequest, res: Response) => {
  if (req.userRole !== "super_admin") return res.status(403).json({ error: "Super Admin access required" });
  try {
    const [actions, entities, outcomes, actors] = await Promise.all([
      pool.query("SELECT DISTINCT action FROM activity_logs ORDER BY action"),
      pool.query("SELECT DISTINCT entity_type FROM activity_logs WHERE entity_type IS NOT NULL ORDER BY entity_type"),
      pool.query("SELECT DISTINCT outcome FROM activity_logs WHERE outcome IS NOT NULL ORDER BY outcome"),
      pool.query(`SELECT DISTINCT u.id, u.name, u.email, u.role
                  FROM activity_logs al JOIN users u ON u.id = al.user_id
                  ORDER BY u.name, u.id`),
    ]);
    res.json({
      actions: actions.rows.map((row) => row.action),
      entity_types: entities.rows.map((row) => row.entity_type),
      outcomes: outcomes.rows.map((row) => row.outcome),
      actors: actors.rows,
    });
  } catch (err) {
    console.error("Fetch audit filter options error:", err);
    res.status(500).json({ error: "Unable to load audit filter options" });
  }
});

// GET /api/admin/logs/export - Stream audit records without loading the full history into the browser.
router.get("/logs/export", async (req: AuthRequest, res: Response) => {
  if (req.userRole !== "super_admin") return res.status(403).json({ error: "Super Admin access required" });
  const format = req.query.format;
  const scope = req.query.scope === "all" ? "date" : req.query.scope === undefined || req.query.scope === "filtered" ? "filtered" : null;
  if (format !== "csv" && format !== "json") return res.status(400).json({ error: "Export format must be csv or json" });
  if (!scope) return res.status(400).json({ error: "Export scope must be filtered or all" });

  const filters = buildAuditFilters(req.query as AuditQuery, scope);
  if ("error" in filters) return res.status(400).json({ error: filters.error });

  const select = `SELECT al.id, al.created_at, al.created_at::text AS export_cursor, al.user_id, u.name AS user_name, u.email AS user_email,
                         u.role AS user_role, al.action, al.entity_type, al.entity_id, al.outcome,
                         al.details, al.before_data, al.after_data
                  FROM activity_logs al LEFT JOIN users u ON u.id = al.user_id`;
  const csvHeaders = ["log_id", "timestamp", "actor_id", "actor_name", "actor_email", "actor_role", "action", "entity_type", "entity_id", "outcome", "details", "before_data", "after_data"];
  const filename = `TaskPilot_Audit_Logs_${new Date().toISOString().slice(0, 10)}.${format}`;
  let cursorDate: Date | string | null = null;
  let cursorId: number | null = null;
  let rowCount = 0;

  try {
    const firstParams = [...filters.params];
    const firstWhere = filters.conditions.length ? `WHERE ${filters.conditions.join(" AND ")}` : "";
    const first = await pool.query(`${select} ${firstWhere} ORDER BY al.created_at DESC, al.id DESC LIMIT 500`, firstParams);
    if (!first.rows.length) return res.status(404).json({ error: "No audit records match the selected filters" });

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8");
    const write = async (chunk: string) => {
      if (!res.write(chunk)) await new Promise<void>((resolve) => res.once("drain", resolve));
    };
    if (format === "csv") await write(`\uFEFF${csvHeaders.map(csvCell).join(",")}\r\n`);
    else await write("[");

    let batch = first.rows;
    while (batch.length) {
      for (const row of batch) {
        const safeRow = {
          ...row,
          export_cursor: undefined,
          before_data: redactSensitiveFields(row.before_data),
          after_data: redactSensitiveFields(row.after_data),
        };
        if (format === "csv") {
          const values = [safeRow.id, safeRow.created_at, safeRow.user_id, safeRow.user_name, safeRow.user_email, safeRow.user_role,
            safeRow.action, safeRow.entity_type, safeRow.entity_id, safeRow.outcome, safeRow.details, safeRow.before_data, safeRow.after_data];
          await write(`${values.map(csvCell).join(",")}\r\n`);
        } else {
          await write(`${rowCount ? "," : ""}${JSON.stringify(safeRow)}`);
        }
        rowCount += 1;
      }

      const last = batch[batch.length - 1];
      cursorDate = last.export_cursor;
      cursorId = last.id;
      const params = [...filters.params, cursorDate, cursorId];
      const where = [...filters.conditions, `(al.created_at, al.id) < ($${params.length - 1}::timestamp, $${params.length}::integer)`];
      batch = (await pool.query(`${select} WHERE ${where.join(" AND ")} ORDER BY al.created_at DESC, al.id DESC LIMIT 500`, params)).rows;
    }
    if (format === "json") await write("]");
    res.end();
  } catch (err) {
    console.error("Export audit logs error:", err);
    if (res.headersSent) res.destroy(err instanceof Error ? err : undefined);
    else res.status(500).json({ error: "Unable to export audit records" });
  }
});

// GET /api/admin/logs - Paginated system activity records (Super Admin only)
router.get("/logs", async (req: AuthRequest, res: Response) => {
  try {
    if (req.userRole !== "super_admin") {
      res.status(403).json({ error: "Super Admin access required" });
      return;
    }
    const limitValue = Number(req.query.limit ?? 50);
    const offsetValue = Number(req.query.offset ?? 0);
    if (!Number.isInteger(limitValue) || limitValue < 1 || !Number.isInteger(offsetValue) || offsetValue < 0) {
      return res.status(400).json({ error: "Limit and offset must be valid non-negative integers" });
    }
    const limit = Math.min(limitValue, 100);
    const offset = offsetValue;
    const filters = buildAuditFilters(req.query as AuditQuery);
    if ("error" in filters) return res.status(400).json({ error: filters.error });
    const actionFilter = filters.conditions.length ? `WHERE ${filters.conditions.join(" AND ")}` : "";
    const countResult = await pool.query(`SELECT COUNT(*)::integer AS total FROM activity_logs al LEFT JOIN users u ON u.id = al.user_id ${actionFilter}`, filters.params);
    const params = [...filters.params, limit, offset];
    const result = await pool.query(
      `SELECT al.id, al.user_id, al.action, al.details, al.entity_type, al.entity_id, al.outcome,
              al.before_data, al.after_data, al.created_at,
              u.name as user_name, u.email as user_email, u.role as user_role
       FROM activity_logs al
       LEFT JOIN users u ON al.user_id = u.id
       ${actionFilter}
       ORDER BY al.created_at DESC, al.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const rows = result.rows.map((row) => ({
      ...row,
      before_data: redactSensitiveFields(row.before_data),
      after_data: redactSensitiveFields(row.after_data),
    }));
    res.json({ rows, total: countResult.rows[0].total, limit, offset });
  } catch (err) {
    console.error("Fetch activity logs error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/settings", async (req: AuthRequest, res: Response) => {
  if (req.userRole !== "super_admin") {
    res.status(403).json({ error: "Super Admin access required" });
    return;
  }
  try {
    const result = await pool.query(
            `SELECT maintenance_mode, enable_audit, enable_notifications, organization_name, support_email,
              institution_code, college_address, timezone, academic_year, academic_term,
              working_days, working_hours_start, working_hours_end, updated_at
       FROM system_settings WHERE id = 1`
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Fetch system settings error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/settings", async (req: AuthRequest, res: Response) => {
  if (req.userRole !== "super_admin") {
    res.status(403).json({ error: "Super Admin access required" });
    return;
  }
  const { maintenance_mode, enable_audit, enable_notifications, organization_name, support_email,
    institution_code, college_address, timezone, academic_year, academic_term,
    working_days, working_hours_start, working_hours_end } = req.body;
  if (typeof maintenance_mode !== "boolean" || enable_audit !== true ||
      typeof enable_notifications !== "boolean" || !isNonEmptyString(organization_name) ||
      organization_name.trim().length > 160 || !isEmail(support_email)) {
    res.status(400).json({ error: "Valid settings values are required" });
    return;
  }
  if (institution_code !== undefined && institution_code !== null && (typeof institution_code !== "string" || institution_code.trim().length > 40)) return res.status(400).json({ error: "Institution code must be 40 characters or fewer" });
  if (college_address !== undefined && (typeof college_address !== "string" || college_address.length > 1000)) return res.status(400).json({ error: "College address must be 1000 characters or fewer" });
  if (timezone !== undefined) {
    if (typeof timezone !== "string" || timezone.length > 80) return res.status(400).json({ error: "Enter a valid IANA time zone" });
    try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); } catch { return res.status(400).json({ error: "Enter a valid IANA time zone" }); }
  }
  if (academic_year !== undefined && academic_year !== null && (typeof academic_year !== "string" || academic_year.trim().length > 30)) return res.status(400).json({ error: "Academic year must be 30 characters or fewer" });
  if (academic_term !== undefined && academic_term !== null && (typeof academic_term !== "string" || academic_term.trim().length > 40)) return res.status(400).json({ error: "Academic term must be 40 characters or fewer" });
  if (working_days !== undefined && (!Array.isArray(working_days) || working_days.some((day: unknown) => !Number.isInteger(day) || Number(day) < 0 || Number(day) > 6) || new Set(working_days).size !== working_days.length)) return res.status(400).json({ error: "Working days must be unique weekday numbers from 0 to 6" });
  const validTime = (value: unknown) => value === undefined || (typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value));
  if (!validTime(working_hours_start) || !validTime(working_hours_end) || (working_hours_start && working_hours_end && working_hours_start >= working_hours_end)) return res.status(400).json({ error: "Working hours must be valid and the end must be later than the start" });
  try {
    const client = await pool.connect();
    let result;
    try {
      await client.query("BEGIN");
      const before = await client.query("SELECT organization_name, support_email, institution_code, college_address, timezone, academic_year, academic_term, working_days, working_hours_start, working_hours_end, maintenance_mode, enable_notifications FROM system_settings WHERE id = 1 FOR UPDATE");
      result = await client.query(
        `UPDATE system_settings SET maintenance_mode = $1, enable_audit = true, enable_notifications = $2,
           organization_name = $3, support_email = $4, institution_code = $5, college_address = $6,
           timezone = $7, academic_year = $8, academic_term = $9, working_days = $10,
           working_hours_start = $11, working_hours_end = $12, updated_by = $13, updated_at = NOW()
         WHERE id = 1
         RETURNING maintenance_mode, enable_audit, enable_notifications, organization_name, support_email,
                   institution_code, college_address, timezone, academic_year, academic_term,
                   working_days, working_hours_start, working_hours_end, updated_at`,
        [maintenance_mode, enable_notifications, organization_name.trim(), support_email.trim().toLowerCase(),
          institution_code === undefined ? before.rows[0].institution_code : institution_code?.trim() || null,
          college_address === undefined ? before.rows[0].college_address : college_address?.trim() || null,
          timezone === undefined ? before.rows[0].timezone : timezone || "Asia/Kolkata",
          academic_year === undefined ? before.rows[0].academic_year : academic_year?.trim() || null,
          academic_term === undefined ? before.rows[0].academic_term : academic_term?.trim() || null,
          working_days === undefined ? before.rows[0].working_days : working_days,
          working_hours_start === undefined ? String(before.rows[0].working_hours_start).slice(0, 5) : working_hours_start || "09:00",
          working_hours_end === undefined ? String(before.rows[0].working_hours_end).slice(0, 5) : working_hours_end || "17:00", req.userId]
      );
      await client.query(
        `INSERT INTO activity_logs (user_id, action, details, entity_type, entity_id, outcome, before_data, after_data)
         VALUES ($1, 'Update System Settings', $2, 'system_settings', 1, 'success', $3::jsonb, $4::jsonb)`,
        [req.userId, "Updated college identity, academic schedule, or system workflow settings.", JSON.stringify(before.rows[0]), JSON.stringify(result.rows[0])]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update system settings error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/reseed - Check schema and seed missing demo data (Super Admin only)
router.post("/reseed", async (req: AuthRequest, res: Response) => {
  try {
    if (req.userRole !== "super_admin") {
      res.status(403).json({ error: "Super Admin access required" });
      return;
    }
    console.log("Super Admin triggered a safe database schema and seed check...");
    await initDb();
    res.json({ message: "Database schema and seed data checked successfully" });
  } catch (err) {
    console.error("Database schema and seed check error:", err);
    res.status(500).json({ error: "Server error during database schema check" });
  }
});

// ==========================================
// DASHBOARD STATS
// ==========================================

// GET /api/admin/stats - Organization stats for admin & super admin
router.get("/stats", async (req: AuthRequest, res: Response) => {
  try {
    const isEmployee = req.userRole === "employee";
    const isHead = req.userRole === "dept_head";
    const scopedClause = isEmployee
      ? "WHERE t.assigned_to_id = $1"
      : isHead
        ? "WHERE t.assigned_dept_id = (SELECT department_id FROM users WHERE id = $1)"
        : "";
    const params = isEmployee || isHead ? [req.userId] : [];
    const tasks = await pool.query(
      `SELECT COUNT(*)::integer AS total,
              COUNT(*) FILTER (WHERE t.status = 'Completed')::integer AS completed,
              COUNT(*) FILTER (WHERE t.status IN ('Pending', 'In Progress', 'Under Review'))::integer AS pending,
              COUNT(*) FILTER (WHERE t.status = 'Rejected')::integer AS rejected
       FROM tasks t
       WHERE t.deleted_at IS NULL ${scopedClause ? `AND ${scopedClause.replace(/^WHERE /, "")}` : ""}`,
      params
    );
    const [events, departments, people] = await Promise.all([
      pool.query("SELECT COUNT(*)::integer AS total, COUNT(*) FILTER (WHERE status = 'Active')::integer AS active FROM events"),
      pool.query("SELECT COUNT(*)::integer AS total FROM departments"),
      pool.query(`SELECT COUNT(*) FILTER (WHERE role = 'admin')::integer AS admins,
                         COUNT(*) FILTER (WHERE role = 'employee')::integer AS employees
                  FROM users WHERE is_active = true`)
    ]);
    const tasksCount = Number(tasks.rows[0].total);
    const completedCount = Number(tasks.rows[0].completed);
    const solvedPercent = tasksCount > 0 ? Math.round((completedCount / tasksCount) * 100) : 0;

    res.json({
      total: tasksCount,
      solved_percent: solvedPercent,
      pending: Number(tasks.rows[0].pending),
      rejected: Number(tasks.rows[0].rejected),
      total_events: Number(events.rows[0].total),
      active_events: Number(events.rows[0].active),
      total_departments: Number(departments.rows[0].total),
      total_admins: Number(people.rows[0].admins),
      total_employees: Number(people.rows[0].employees)
    });
  } catch (err) {
    console.error("Admin stats error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET/PUT /api/admin/escalation-settings - Configure escalation delays in hours
router.get("/escalation-settings", requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query("SELECT stage_2_hours, stage_3_hours, updated_at FROM escalation_settings WHERE id = 1");
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Get escalation settings error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/escalation-settings", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const stage2 = Number(req.body.stage_2_hours);
    const stage3 = Number(req.body.stage_3_hours);
    if (!Number.isInteger(stage2) || !Number.isInteger(stage3) || stage2 <= 0 || stage3 <= stage2) {
      res.status(400).json({ error: "Stage 2 must be positive and Stage 3 must be greater than Stage 2" });
      return;
    }
    const result = await pool.query(
      `UPDATE escalation_settings SET stage_2_hours = $1, stage_3_hours = $2, updated_by = $3, updated_at = NOW()
       WHERE id = 1 RETURNING stage_2_hours, stage_3_hours, updated_at`, [stage2, stage3, req.userId]
    );
    await pool.query("INSERT INTO activity_logs (user_id, action, details) VALUES ($1, 'Update Escalation Settings', $2)", [req.userId, `Escalation intervals set to ${stage2}h and ${stage3}h.`]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update escalation settings error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ==========================================
// DEPARTMENTS MANAGEMENT
// ==========================================

// GET /api/admin/departments - List college departments with live operational counts
router.get("/departments", async (req: AuthRequest, res: Response) => {
  try {
    if (req.userRole !== "super_admin") {
      const result = await pool.query(
        "SELECT id, name, description, department_code, department_type FROM departments WHERE is_active = true ORDER BY name ASC"
      );
      return res.json(result.rows);
    }
    const result = await pool.query(
      `SELECT d.*, h.name AS hod_name,
              (SELECT COUNT(*)::integer FROM users u WHERE u.department_id = d.id AND u.is_active = true) AS active_staff_count,
              (SELECT COUNT(*)::integer FROM events e WHERE e.department_id = d.id AND e.start_date >= NOW() AND e.status NOT IN ('Cancelled', 'Completed')) AS upcoming_event_count,
              (SELECT COUNT(*)::integer FROM tasks t WHERE t.assigned_dept_id = d.id AND t.deleted_at IS NULL AND t.status NOT IN ('Approved', 'Cancelled')) AS pending_task_count,
              (SELECT COUNT(*)::integer FROM tasks t WHERE t.assigned_dept_id = d.id AND t.deleted_at IS NULL AND t.due_date < NOW() AND t.status NOT IN ('Approved', 'Cancelled')) AS overdue_task_count,
              CASE WHEN (SELECT COUNT(*) FROM tasks t WHERE t.assigned_dept_id = d.id AND t.deleted_at IS NULL) = 0 THEN 0
                ELSE ROUND(100.0 * (SELECT COUNT(*) FROM tasks t WHERE t.assigned_dept_id = d.id AND t.deleted_at IS NULL AND t.status = 'Approved') /
                  (SELECT COUNT(*) FROM tasks t WHERE t.assigned_dept_id = d.id AND t.deleted_at IS NULL))::integer END AS workflow_progress
       FROM departments d LEFT JOIN users h ON h.id = d.hod_user_id
       ORDER BY d.is_active DESC, d.department_type, d.name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("List departments error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/departments/:id", async (req: AuthRequest, res: Response) => {
  try {
    const departmentId = parsePositiveId(req.params.id);
    if (!departmentId) return res.status(400).json({ error: "Department ID must be a positive integer" });
    const department = await pool.query(
      `SELECT d.*, h.name AS hod_name,
              (SELECT COUNT(*)::integer FROM users u WHERE u.department_id = d.id AND u.is_active = true) AS active_staff_count,
              (SELECT COUNT(*)::integer FROM events e WHERE e.department_id = d.id AND e.start_date >= NOW() AND e.status NOT IN ('Cancelled', 'Completed')) AS upcoming_event_count,
              (SELECT COUNT(*)::integer FROM tasks t WHERE t.assigned_dept_id = d.id AND t.deleted_at IS NULL AND t.status NOT IN ('Approved', 'Cancelled')) AS pending_task_count,
              (SELECT COUNT(*)::integer FROM tasks t WHERE t.assigned_dept_id = d.id AND t.deleted_at IS NULL AND t.due_date < NOW() AND t.status NOT IN ('Approved', 'Cancelled')) AS overdue_task_count,
              CASE WHEN (SELECT COUNT(*) FROM tasks t WHERE t.assigned_dept_id = d.id AND t.deleted_at IS NULL) = 0 THEN 0
                ELSE ROUND(100.0 * (SELECT COUNT(*) FROM tasks t WHERE t.assigned_dept_id = d.id AND t.deleted_at IS NULL AND t.status = 'Approved') /
                  (SELECT COUNT(*) FROM tasks t WHERE t.assigned_dept_id = d.id AND t.deleted_at IS NULL))::integer END AS workflow_progress
       FROM departments d LEFT JOIN users h ON h.id = d.hod_user_id WHERE d.id = $1`,
      [departmentId]
    );
    if (!department.rows.length) return res.status(404).json({ error: "Department not found" });
    if (req.userRole !== "super_admin") {
      const user = await pool.query("SELECT department_id FROM users WHERE id = $1", [req.userId]);
      if (req.userRole !== "dept_head" || user.rows[0]?.department_id !== departmentId) {
        return res.status(403).json({ error: "Department details access required" });
      }
    }
    const [staff, events, tasks] = await Promise.all([
      pool.query("SELECT id, name, college_role, designation, is_active FROM users WHERE department_id = $1 ORDER BY is_active DESC, name", [departmentId]),
      pool.query("SELECT id, title, category, start_date, end_date, status FROM events WHERE department_id = $1 AND start_date >= NOW() AND status NOT IN ('Cancelled', 'Completed') ORDER BY start_date LIMIT 20", [departmentId]),
      pool.query("SELECT id, title, status, priority, due_date, is_overdue FROM tasks WHERE assigned_dept_id = $1 AND deleted_at IS NULL AND status NOT IN ('Approved', 'Cancelled') ORDER BY due_date NULLS LAST, id DESC LIMIT 50", [departmentId]),
    ]);
    res.json({ ...department.rows[0], staff: staff.rows, events: events.rows, tasks: tasks.rows });
  } catch (err) {
    console.error("Department details error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/departments - Create college department or administrative unit
router.post("/departments", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, department_code, department_type, contact_email, hod_user_id } = req.body;
    if (!isNonEmptyString(name) || name.trim().length > 100) return res.status(400).json({ error: "Department name is required and must be 100 characters or fewer" });
    if (!isOneOf(department_type, DEPARTMENT_TYPES)) return res.status(400).json({ error: "Choose Academic, Administrative, or Support as the department type" });
    if (department_code !== undefined && department_code !== null && (typeof department_code !== "string" || department_code.trim().length > 30)) return res.status(400).json({ error: "Department code must be 30 characters or fewer" });
    if (contact_email && !isEmail(contact_email)) return res.status(400).json({ error: "Enter a valid department contact email" });
    const headId = hod_user_id ? parsePositiveId(hod_user_id) : null;
    if (hod_user_id && !headId) return res.status(400).json({ error: "HOD must be a valid user ID" });
    const client = await pool.connect();
    let result;
    try {
      await client.query("BEGIN");
      let headBefore: Record<string, unknown> | null = null;
      if (headId) {
        const head = await client.query("SELECT id, name, college_role, role, department_id, is_active FROM users WHERE id = $1 FOR UPDATE", [headId]);
        if (!head.rows.length || !head.rows[0].is_active) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "HOD account must exist and be active" });
        }
        const existingAssignment = await client.query("SELECT id FROM departments WHERE hod_user_id = $1", [headId]);
        if (existingAssignment.rows.length) {
          await client.query("ROLLBACK");
          return res.status(409).json({ error: "This HOD is already assigned to a department" });
        }
        headBefore = head.rows[0];
      }
      result = await client.query(
        `INSERT INTO departments (name, description, department_code, department_type, contact_email)
         VALUES ($1, $2, NULLIF($3, ''), $4, $5) RETURNING *`,
        [name.trim(), typeof description === "string" ? description.trim() : "", typeof department_code === "string" ? department_code.trim().toUpperCase() : "", department_type, contact_email?.trim().toLowerCase() || null]
      );
      if (headId) {
        const assigned = await client.query("UPDATE users SET role = 'dept_head', college_role = 'hod', department_id = $1 WHERE id = $2 RETURNING id, name, role, college_role, department_id", [result.rows[0].id, headId]);
        result.rows[0].hod_user_id = headId;
        await client.query("UPDATE departments SET hod_user_id = $1 WHERE id = $2", [headId, result.rows[0].id]);
        await client.query(
          `INSERT INTO activity_logs (user_id, action, details, entity_type, entity_id, before_data, after_data)
           VALUES ($1, 'Assign HOD', $2, 'user', $3, $4::jsonb, $5::jsonb)`,
          [req.userId, `Assigned HOD to department ${result.rows[0].id}.`, headId, JSON.stringify(headBefore), JSON.stringify(assigned.rows[0])]
        );
      }
      await client.query(
        `INSERT INTO activity_logs (user_id, action, details, entity_type, entity_id, after_data)
         VALUES ($1, 'Create Department', $2, 'department', $3, $4::jsonb)`,
        [req.userId, `Created ${department_type} department "${name.trim()}"${department_code ? ` (${department_code.trim()})` : ""}.`, result.rows[0].id, JSON.stringify(result.rows[0])]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (databaseErrorCode(err) === "23505") return res.status(409).json({ error: "A department with that name or code already exists" });
    console.error("Create department error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/admin/departments/:id - Update department metadata, HOD, or status
router.put("/departments/:id", requireAdmin, async (req: AuthRequest, res: Response) => {
  const departmentId = parsePositiveId(req.params.id);
  if (!departmentId) return res.status(400).json({ error: "Department ID must be a positive integer" });
  try {
    const { name, description, department_code, department_type, contact_email, hod_user_id, is_active } = req.body;
    if (name !== undefined && (!isNonEmptyString(name) || name.trim().length > 100)) return res.status(400).json({ error: "Department name must contain 1 to 100 characters" });
    if (department_type !== undefined && !isOneOf(department_type, DEPARTMENT_TYPES)) return res.status(400).json({ error: "Invalid department type" });
    if (department_code !== undefined && department_code !== null && (typeof department_code !== "string" || department_code.trim().length > 30)) return res.status(400).json({ error: "Department code must be 30 characters or fewer" });
    if (contact_email && !isEmail(contact_email)) return res.status(400).json({ error: "Enter a valid department contact email" });
    if (is_active !== undefined && typeof is_active !== "boolean") return res.status(400).json({ error: "Department status must be true or false" });
    const headId = hod_user_id === undefined || hod_user_id === null || hod_user_id === "" ? null : parsePositiveId(hod_user_id);
    if (hod_user_id && !headId) return res.status(400).json({ error: "HOD must be a valid user ID" });
    if (is_active === false) {
      const dependencies = await pool.query(
        `SELECT
           (SELECT COUNT(*) FROM users WHERE department_id = $1 AND is_active = true) AS active_staff,
           (SELECT COUNT(*) FROM events WHERE department_id = $1 AND start_date >= NOW() AND status NOT IN ('Cancelled', 'Completed')) AS upcoming_events,
           (SELECT COUNT(*) FROM tasks WHERE assigned_dept_id = $1 AND deleted_at IS NULL AND status NOT IN ('Approved', 'Cancelled')) AS open_tasks`,
        [departmentId]
      );
      const state = dependencies.rows[0];
      if (Number(state.active_staff) || Number(state.upcoming_events) || Number(state.open_tasks)) {
        return res.status(409).json({ error: `Move or complete dependent records before deactivation (active staff: ${state.active_staff}, upcoming events: ${state.upcoming_events}, open tasks: ${state.open_tasks}).` });
      }
    }

    const client = await pool.connect();
    let result;
    try {
      await client.query("BEGIN");
      const existing = await client.query("SELECT * FROM departments WHERE id = $1 FOR UPDATE", [departmentId]);
      if (!existing.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Department not found" });
      }
      const oldHeadId = existing.rows[0].hod_user_id as number | null;
      if (headId !== null) {
        const head = await client.query("SELECT id, is_active FROM users WHERE id = $1 FOR UPDATE", [headId]);
        if (!head.rows.length || !head.rows[0].is_active) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "HOD account must exist and be active" });
        }
        const assignedElsewhere = await client.query("SELECT id FROM departments WHERE hod_user_id = $1 AND id <> $2", [headId, departmentId]);
        if (assignedElsewhere.rows.length) {
          await client.query("ROLLBACK");
          return res.status(409).json({ error: "This HOD is already assigned to another department" });
        }
      }
      if (oldHeadId && oldHeadId !== headId) {
        await client.query("UPDATE users SET role = 'employee', college_role = CASE WHEN college_role = 'hod' THEN 'staff' ELSE college_role END WHERE id = $1 AND role = 'dept_head'", [oldHeadId]);
      }
      if (headId && headId !== oldHeadId) {
        await client.query("UPDATE users SET role = 'dept_head', college_role = 'hod', department_id = $1 WHERE id = $2", [departmentId, headId]);
      }
      result = await client.query(
        `UPDATE departments SET name = COALESCE($1, name), description = COALESCE($2, description),
           department_code = CASE WHEN $3::boolean THEN NULLIF($4, '') ELSE department_code END,
           department_type = COALESCE($5, department_type),
           contact_email = CASE WHEN $6::boolean THEN $7 ELSE contact_email END,
           hod_user_id = CASE WHEN $8::boolean THEN $9 ELSE hod_user_id END,
           is_active = COALESCE($10, is_active)
         WHERE id = $11 RETURNING *`,
        [name === undefined ? null : name.trim(), description === undefined ? null : description,
          department_code !== undefined, typeof department_code === "string" ? department_code.trim().toUpperCase() : "",
          department_type ?? null, contact_email !== undefined, contact_email?.trim().toLowerCase() || null,
          hod_user_id !== undefined, headId, is_active ?? null, departmentId]
      );
      await client.query(
        `INSERT INTO activity_logs (user_id, action, details, entity_type, entity_id, before_data, after_data)
         VALUES ($1, $2, $3, 'department', $4, $5::jsonb, $6::jsonb)`,
        [req.userId, is_active === undefined ? "Update Department" : is_active ? "Activate Department" : "Deactivate Department",
          `Updated department ${departmentId}; fields: ${Object.keys(req.body).join(", ")}.`, departmentId,
          JSON.stringify(existing.rows[0]), JSON.stringify(result.rows[0])]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    res.json(result.rows[0]);
  } catch (err) {
    if (databaseErrorCode(err) === "23505") return res.status(409).json({ error: "Department name, code, or HOD assignment is already in use" });
    console.error("Update department error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Preserve department history by rejecting physical deletion; use is_active instead.
router.delete("/departments/:id", requireAdmin, async (req: AuthRequest, res: Response) => {
  res.status(405).json({ error: "Departments cannot be deleted. Deactivate the department after resolving active dependencies." });
});

// ==========================================
// EMPLOYEES / USERS MANAGEMENT
// ==========================================

// GET /api/admin/employees - Fetch all employee details
router.get("/employees", async (req: AuthRequest, res: Response) => {
  try {
    const isPrivileged = req.userRole === "admin" || req.userRole === "super_admin";
    const isHead = req.userRole === "dept_head";
    const user = await pool.query("SELECT department_id FROM users WHERE id = $1", [req.userId]);
    const where = isPrivileged ? "" : isHead ? "WHERE u.department_id = $1" : "WHERE u.id = $1";
    const params = isPrivileged ? [] : isHead ? [user.rows[0]?.department_id ?? null] : [req.userId];
    const result = await pool.query(
      `SELECT u.id, u.name, u.role,
              ${isPrivileged ? "u.email, u.semester, u.college_role, u.employee_id, u.designation, u.phone_number, u.date_of_joining, u.email_verified, u.password_setup_required, u.is_active," : ""}
              d.name as department, d.id as department_id
       FROM users u
       LEFT JOIN departments d ON u.department_id = d.id
       ${where}
       ORDER BY u.name ASC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error("List employees error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/employees/directory", async (req: AuthRequest, res: Response) => {
  try {
    if (req.userRole !== "super_admin" && req.userRole !== "dept_head") return res.status(403).json({ error: "Staff directory access required" });
    const limitInput = Number(req.query.limit ?? 25);
    const offsetInput = Number(req.query.offset ?? 0);
    const limit = Number.isInteger(limitInput) ? Math.min(Math.max(limitInput, 1), 100) : 25;
    const offset = Number.isInteger(offsetInput) ? Math.max(offsetInput, 0) : 0;
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (req.userRole === "dept_head") {
      params.push(req.userId);
      conditions.push(`u.department_id = (SELECT department_id FROM users WHERE id = $${params.length})`);
    }
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : "";
    if (search) {
      params.push(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
      conditions.push(`(u.name ILIKE $${params.length} ESCAPE '\\' OR u.email ILIKE $${params.length} ESCAPE '\\' OR u.employee_id ILIKE $${params.length} ESCAPE '\\')`);
    }
    if (typeof req.query.college_role === "string" && COLLEGE_ROLES.includes(req.query.college_role as (typeof COLLEGE_ROLES)[number])) {
      params.push(req.query.college_role);
      conditions.push(`u.college_role = $${params.length}`);
    }
    if (req.userRole === "super_admin" && req.query.department_id !== undefined) {
      const departmentId = parsePositiveId(req.query.department_id);
      if (!departmentId) return res.status(400).json({ error: "Department filter must be a positive integer" });
      params.push(departmentId);
      conditions.push(`u.department_id = $${params.length}`);
    }
    for (const [queryKey, column] of [["is_active", "u.is_active"], ["email_verified", "u.email_verified"]] as const) {
      const value = req.query[queryKey];
      if (req.userRole === "super_admin" && value !== undefined) {
        if (value !== "true" && value !== "false") return res.status(400).json({ error: `${queryKey} filter must be true or false` });
        params.push(value === "true");
        conditions.push(`${column} = $${params.length}`);
      }
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const sortColumns: Record<string, string> = { name: "u.name", email: "u.email", role: "u.college_role", employee_id: "u.employee_id", department: "d.name" };
    const sortColumn = sortColumns[String(req.query.sort)] || "u.name";
    const direction = req.query.direction === "desc" ? "DESC" : "ASC";
    const total = await pool.query(`SELECT COUNT(*)::integer AS total FROM users u LEFT JOIN departments d ON d.id = u.department_id ${where}`, params);
    const pageParams = [...params, limit, offset];
    const rows = await pool.query(
      `SELECT u.id, u.name, u.role, u.college_role, u.employee_id, u.designation,
              ${req.userRole === "super_admin" ? "u.email, u.phone_number, u.date_of_joining, u.email_verified, u.password_setup_required, u.is_active," : ""}
              u.department_id, d.name AS department
       FROM users u LEFT JOIN departments d ON d.id = u.department_id ${where}
       ORDER BY ${sortColumn} ${direction}, u.id ASC LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams
    );
    res.json({ rows: rows.rows, total: total.rows[0].total, limit, offset });
  } catch (err) {
    console.error("Staff directory error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/employees/:id/resend-verification", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query("SELECT id, name, email, email_verified, password_setup_required FROM users WHERE id = $1", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "User not found" });
    if (result.rows[0].password_setup_required) {
      if (req.userRole !== "super_admin") return res.status(403).json({ error: "Super Admin access required to resend account setup links" });
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      await pool.query("UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL", [req.params.id]);
      await pool.query(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '24 hours')",
        [req.params.id, tokenHash]
      );
      let setupEmailSent = false;
      try {
        setupEmailSent = await sendAccountSetupEmail(result.rows[0], rawToken);
      } catch (error) {
        console.error("Account setup email failed:", error instanceof Error ? error.message : "Unknown email error");
      }
      const setupUrl = `${(process.env.APP_URL || "http://localhost:8080").replace(/\/$/, "")}/reset-password?mode=setup&token=${encodeURIComponent(rawToken)}`;
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        message: "Account setup link reissued.",
        setupEmailSent,
        ...(!setupEmailSent && { setupUrl }),
      });
    }
    if (result.rows[0].email_verified) return res.json({ message: "User email is already verified." });
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await pool.query("UPDATE email_verification_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL", [req.params.id]);
    await pool.query("INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '24 hours')", [req.params.id, tokenHash]);
    try { await sendVerificationEmail(result.rows[0], rawToken); } catch (error) { console.error("Admin verification email failed:", error instanceof Error ? error.message : "Unknown email error"); }
    res.json({ message: "Verification email request processed." });
  } catch (error) { console.error("Admin resend verification error:", error); res.status(500).json({ error: "Server error" }); }
});

// POST /api/admin/employees - Create a college staff account and secure setup invitation
router.post("/employees", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    if (req.userRole !== "super_admin") {
      res.status(403).json({ error: "Super Admin access required to create accounts" });
      return;
    }
    const { name, email, role: legacyRole, college_role, department_id, employee_id, designation, phone_number, date_of_joining } = req.body;
    if (!isNonEmptyString(name) || !isNonEmptyString(email)) {
      res.status(400).json({ error: "Full name and official email are required" });
      return;
    }
    if (!isEmail(email)) {
      res.status(400).json({ error: "A valid email address is required" });
      return;
    }
    let collegeRole: string;
    let accessRole: string;
    if (college_role !== undefined) {
      if (!isOneOf(college_role, COLLEGE_ROLES)) return res.status(400).json({ error: "Invalid college role" });
      const selectedCollegeRole = college_role;
      collegeRole = selectedCollegeRole;
      accessRole = COLLEGE_ROLE_ACCESS[selectedCollegeRole];
    } else {
      if (!isOneOf(legacyRole, USER_ROLES) || legacyRole === "super_admin") return res.status(400).json({ error: "A valid college role is required" });
      accessRole = legacyRole;
      collegeRole = collegeRoleFromLegacy(legacyRole);
    }
    const departmentId = department_id == null || department_id === "" ? null : parsePositiveId(department_id);
    if (department_id != null && department_id !== "" && !departmentId) {
      res.status(400).json({ error: "Department ID must be a valid positive integer" });
      return;
    }
    if (departmentId) {
      const department = await pool.query("SELECT id FROM departments WHERE id = $1 AND is_active = true", [departmentId]);
      if (!department.rows.length) {
        res.status(404).json({ error: "Active department not found" });
        return;
      }
    }
    if (collegeRole === "hod" && !departmentId) return res.status(400).json({ error: "An HOD must be assigned to an active department" });
    if (typeof employee_id === "string" && employee_id.trim().length > 40) return res.status(400).json({ error: "Employee ID must be 40 characters or fewer" });
    if (typeof designation === "string" && designation.trim().length > 120) return res.status(400).json({ error: "Designation must be 120 characters or fewer" });
    if (typeof phone_number === "string" && phone_number.trim().length > 40) return res.status(400).json({ error: "Phone number must be 40 characters or fewer" });
    if (date_of_joining && (typeof date_of_joining !== "string" || !Number.isFinite(Date.parse(date_of_joining)))) return res.status(400).json({ error: "Date of joining must be a valid date" });
    const normalizedEmail = email.trim().toLowerCase();

    const check = await pool.query("SELECT id FROM users WHERE LOWER(email) = $1", [normalizedEmail]);
    if (check.rows.length > 0) {
      res.status(409).json({ error: "Email already exists" });
      return;
    }

    const initialPasswordHash = await bcrypt.hash(crypto.randomBytes(48).toString("hex"), 12);
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const client = await pool.connect();
    let createdUser;
    try {
      await client.query("BEGIN");
      if (collegeRole === "hod") {
        const department = await client.query("SELECT hod_user_id FROM departments WHERE id = $1 AND is_active = true FOR UPDATE", [departmentId]);
        if (!department.rows.length) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Active department not found" });
        }
        if (department.rows[0].hod_user_id) {
          await client.query("ROLLBACK");
          return res.status(409).json({ error: "This department already has an assigned HOD" });
        }
      }
      const result = await client.query(
        `INSERT INTO users (name, email, password_hash, role, college_role, department_id, employee_id, designation, phone_number, date_of_joining, email_verified, password_setup_required)
         VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), NULLIF($8, ''), NULLIF($9, ''), $10, false, true)
         RETURNING id, name, email, role, college_role, department_id, employee_id, designation`,
        [name.trim(), normalizedEmail, initialPasswordHash, accessRole, collegeRole, departmentId,
          typeof employee_id === "string" ? employee_id.trim().toUpperCase() : "",
          typeof designation === "string" ? designation.trim() : "",
          typeof phone_number === "string" ? phone_number.trim() : "", date_of_joining || null]
      );
      createdUser = result.rows[0];
      if (collegeRole === "hod") await client.query("UPDATE departments SET hod_user_id = $1 WHERE id = $2", [createdUser.id, departmentId]);
      await client.query(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '24 hours')",
        [createdUser.id, tokenHash]
      );
      await client.query(
        `INSERT INTO activity_logs (user_id, action, details, entity_type, entity_id, after_data)
         VALUES ($1, 'Register Staff', $2, 'user', $3, $4::jsonb)`,
        [req.userId, `Registered college account with role "${collegeRole}" and department ID ${departmentId ?? "none"}.`, createdUser.id, JSON.stringify(createdUser)]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    let setupEmailSent = false;
    try {
      setupEmailSent = await sendAccountSetupEmail(createdUser, rawToken);
    } catch (error) {
      console.error("Account setup email failed:", error instanceof Error ? error.message : "Unknown email error");
    }
    const setupUrl = `${(process.env.APP_URL || "http://localhost:8080").replace(/\/$/, "")}/reset-password?mode=setup&token=${encodeURIComponent(rawToken)}`;
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({
      ...createdUser,
      setupEmailSent,
      ...(!setupEmailSent && { setupUrl }),
    });
  } catch (err) {
    if (databaseErrorCode(err) === "23505") return res.status(409).json({ error: "Email or employee ID already exists" });
    console.error("Create user error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/admin/employees/:id - Update user role / department (Admins/Super Admins)
router.put("/employees/:id", requireAdmin, async (req: AuthRequest, res: Response) => {
  const userId = parsePositiveId(req.params.id);
  if (!userId) return res.status(400).json({ error: "User ID must be a valid positive integer" });
  const { name, email, role: legacyRole, college_role, department_id, employee_id, designation, phone_number, date_of_joining } = req.body;
  if (name !== undefined && (!isNonEmptyString(name) || name.trim().length > 100)) return res.status(400).json({ error: "Name must contain 1 to 100 characters" });
  if (email !== undefined && !isEmail(email)) return res.status(400).json({ error: "A valid email address is required" });
  if (college_role !== undefined && !isOneOf(college_role, COLLEGE_ROLES)) return res.status(400).json({ error: "Invalid college role" });
  if (legacyRole !== undefined && college_role === undefined && (!isOneOf(legacyRole, USER_ROLES) || legacyRole === "super_admin")) return res.status(400).json({ error: "Invalid access role" });
  if ((college_role !== undefined || legacyRole !== undefined) && userId === req.userId) return res.status(400).json({ error: "You cannot change your own role" });
  if (typeof employee_id === "string" && employee_id.trim().length > 40) return res.status(400).json({ error: "Employee ID must be 40 characters or fewer" });
  if (typeof designation === "string" && designation.trim().length > 120) return res.status(400).json({ error: "Designation must be 120 characters or fewer" });
  if (typeof phone_number === "string" && phone_number.trim().length > 40) return res.status(400).json({ error: "Phone number must be 40 characters or fewer" });
  if (date_of_joining && (typeof date_of_joining !== "string" || !Number.isFinite(Date.parse(date_of_joining)))) return res.status(400).json({ error: "Date of joining must be a valid date" });
  const departmentId = department_id === undefined ? undefined : department_id === null || department_id === "" ? null : parsePositiveId(department_id);
  if (department_id !== undefined && department_id !== null && department_id !== "" && !departmentId) return res.status(400).json({ error: "Department ID must be a valid positive integer" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT id, name, email, role, college_role, department_id FROM users WHERE id = $1 FOR UPDATE", [userId]);
    if (!current.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "User not found" });
    }
    if (current.rows[0].role === "super_admin") {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Protected Super Admin accounts cannot be edited through staff management" });
    }
    const nextCollegeRole = college_role ?? (legacyRole !== undefined ? collegeRoleFromLegacy(legacyRole) : current.rows[0].college_role);
    const nextAccessRole = college_role !== undefined
      ? COLLEGE_ROLE_ACCESS[college_role as (typeof COLLEGE_ROLES)[number]]
      : legacyRole !== undefined
        ? legacyRole
        : current.rows[0].role;
    const nextDepartmentId = departmentId === undefined ? current.rows[0].department_id as number | null : departmentId;
    if (nextCollegeRole === "hod" && !nextDepartmentId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "An HOD must be assigned to an active department" });
    }
    if (nextDepartmentId && nextDepartmentId !== current.rows[0].department_id) {
      const department = await client.query("SELECT id FROM departments WHERE id = $1 AND is_active = true", [nextDepartmentId]);
      if (!department.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Active department not found" });
      }
    }
    if (email !== undefined) {
      const duplicate = await client.query("SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2", [email.trim().toLowerCase(), userId]);
      if (duplicate.rows.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Email already exists" });
      }
    }
    if (employee_id) {
      const duplicateId = await client.query("SELECT id FROM users WHERE LOWER(employee_id) = LOWER($1) AND id <> $2", [employee_id.trim(), userId]);
      if (duplicateId.rows.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Employee ID already exists" });
      }
    }
    const previousHead = await client.query("SELECT id FROM departments WHERE hod_user_id = $1 FOR UPDATE", [userId]);
    if (current.rows[0].college_role === "hod" && (nextCollegeRole !== "hod" || nextDepartmentId !== current.rows[0].department_id)) {
      await client.query("UPDATE departments SET hod_user_id = NULL WHERE hod_user_id = $1", [userId]);
    }
    if (nextCollegeRole === "hod" && (current.rows[0].college_role !== "hod" || nextDepartmentId !== current.rows[0].department_id)) {
      const department = await client.query("SELECT hod_user_id FROM departments WHERE id = $1 FOR UPDATE", [nextDepartmentId]);
      if (!department.rows.length || (department.rows[0].hod_user_id && department.rows[0].hod_user_id !== userId)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "The selected department already has an HOD" });
      }
      await client.query("UPDATE departments SET hod_user_id = $1 WHERE id = $2", [userId, nextDepartmentId]);
    }
    const updated = await client.query(
      `UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email),
         role = $3, college_role = $4,
         department_id = CASE WHEN $5::boolean THEN $6::integer ELSE department_id END,
         employee_id = CASE WHEN $7::boolean THEN NULLIF($8, '') ELSE employee_id END,
         designation = CASE WHEN $9::boolean THEN NULLIF($10, '') ELSE designation END,
         phone_number = CASE WHEN $11::boolean THEN NULLIF($12, '') ELSE phone_number END,
         date_of_joining = CASE WHEN $13::boolean THEN $14::date ELSE date_of_joining END,
         email_verified = CASE WHEN $15::boolean THEN false ELSE email_verified END
       WHERE id = $16
       RETURNING id, name, email, role, college_role, department_id, employee_id, designation, phone_number, date_of_joining, email_verified, is_active`,
      [name === undefined ? null : name.trim(), email === undefined ? null : email.trim().toLowerCase(), nextAccessRole, nextCollegeRole,
        department_id !== undefined, nextDepartmentId, employee_id !== undefined, typeof employee_id === "string" ? employee_id.trim().toUpperCase() : "",
        designation !== undefined, typeof designation === "string" ? designation.trim() : "", phone_number !== undefined,
        typeof phone_number === "string" ? phone_number.trim() : "", date_of_joining !== undefined, date_of_joining || null,
        email !== undefined && email.trim().toLowerCase() !== current.rows[0].email, userId]
    );
    const changedFields = ["name", "email", "college_role", "department_id", "employee_id", "designation", "phone_number", "date_of_joining"].filter((field) => req.body[field] !== undefined);
    if (changedFields.length) {
      await client.query(
        `INSERT INTO activity_logs (user_id, action, details, entity_type, entity_id, before_data, after_data)
         VALUES ($1, 'Update User', $2, 'user', $3, $4::jsonb, $5::jsonb)`,
        [req.userId, `Updated user ID ${userId}; fields: ${changedFields.join(", ")}; role ${current.rows[0].college_role} -> ${nextCollegeRole}; department ${current.rows[0].department_id ?? "none"} -> ${nextDepartmentId ?? "none"}.`,
          userId, JSON.stringify(current.rows[0]), JSON.stringify(updated.rows[0])]
      );
    }
    await client.query("COMMIT");
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (databaseErrorCode(err) === "23505") return res.status(409).json({ error: "Email, employee ID, or HOD assignment already exists" });
    console.error("Update user error:", err);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

router.put("/employees/:id/status", async (req: AuthRequest, res: Response) => {
  if (req.userRole !== "super_admin") {
    res.status(403).json({ error: "Super Admin access required" });
    return;
  }
  const userId = parsePositiveId(req.params.id);
  if (!userId) return res.status(400).json({ error: "User ID must be a valid positive integer" });
  if (userId === req.userId) return res.status(400).json({ error: "You cannot deactivate your own account" });
  if (typeof req.body.is_active !== "boolean") return res.status(400).json({ error: "Account status must be a boolean" });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query("SELECT id, name, email, role, college_role, department_id, is_active FROM users WHERE id = $1 FOR UPDATE", [userId]);
      if (!target.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "User not found" });
      }
      if (target.rows[0].role === "super_admin") {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Super Admin accounts cannot be deactivated here" });
      }
      const updated = await client.query(
        "UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, name, email, role, is_active",
        [req.body.is_active, userId]
      );
      await client.query(
        `INSERT INTO activity_logs (user_id, action, details, entity_type, entity_id, before_data, after_data)
         VALUES ($1, $2, $3, 'user', $4, $5::jsonb, $6::jsonb)`,
        [req.userId, req.body.is_active ? "Reactivate User" : "Deactivate User",
          `${req.body.is_active ? "Reactivated" : "Deactivated"} user "${target.rows[0].name}", role "${target.rows[0].college_role}".`,
          userId, JSON.stringify(target.rows[0]), JSON.stringify(updated.rows[0])]
      );
      await client.query("COMMIT");
      res.json(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Update account status error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Preserve account-linked history; use the reversible status endpoint instead.
router.delete("/employees/:id", requireAdmin, async (req: AuthRequest, res: Response) => {
  res.status(405).json({ error: "Staff accounts cannot be deleted. Deactivate the account to preserve historical records." });
});

// ==========================================
// RESOURCES SECTION
// ==========================================

// GET /api/admin/resources - Get list of resources & current bookings
router.get("/resources", async (req: AuthRequest, res: Response) => {
  try {
    const resources = await pool.query("SELECT * FROM resources WHERE is_active = true OR $1 = 'super_admin' ORDER BY is_active DESC, name ASC", [req.userRole]);
    const bookings = await pool.query(
      `SELECT rb.*, r.name as resource_name, e.title as event_title, u.name as booked_by_name
       FROM resource_bookings rb
       JOIN resources r ON rb.resource_id = r.id
       JOIN events e ON rb.event_id = e.id
       LEFT JOIN users u ON rb.booked_by = u.id
       WHERE $1 = 'super_admin' OR rb.booked_by = $2 OR e.coordinator_id = $2
          OR ($1 = 'dept_head' AND e.department_id = (SELECT department_id FROM users WHERE id = $2))
       ORDER BY rb.start_time ASC`
      , [req.userRole, req.userId]
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
    const { name, type, resource_code, department_id, building_location, capacity, quantity, condition_status, description, maintenance_task_id } = req.body;
    if (!isNonEmptyString(name) || name.trim().length > 100 || !isNonEmptyString(type) || type.trim().length > 50) return res.status(400).json({ error: "Resource name and category are required" });
    if (resource_code && (typeof resource_code !== "string" || resource_code.trim().length > 40)) return res.status(400).json({ error: "Resource code must be 40 characters or fewer" });
    const departmentId = department_id ? parsePositiveId(department_id) : null;
    const maintenanceTaskId = maintenance_task_id ? parsePositiveId(maintenance_task_id) : null;
    if ((department_id && !departmentId) || (maintenance_task_id && !maintenanceTaskId)) return res.status(400).json({ error: "Department or maintenance task ID is invalid" });
    for (const [label, value] of [["Capacity", capacity], ["Quantity", quantity]] as const) {
      if (value !== undefined && value !== null && (!Number.isInteger(Number(value)) || Number(value) < 0)) return res.status(400).json({ error: `${label} must be a non-negative whole number` });
    }
    if (condition_status !== undefined && !["Good", "Fair", "Poor", "Under Maintenance"].includes(condition_status)) return res.status(400).json({ error: "Invalid resource condition" });
    if (departmentId) {
      const department = await pool.query("SELECT id FROM departments WHERE id = $1 AND is_active = true", [departmentId]);
      if (!department.rows.length) return res.status(404).json({ error: "Active owning department not found" });
    }
    if (maintenanceTaskId) {
      const task = await pool.query("SELECT id FROM tasks WHERE id = $1", [maintenanceTaskId]);
      if (!task.rows.length) return res.status(404).json({ error: "Maintenance task not found" });
    }
    const result = await pool.query(
      `INSERT INTO resources (name, type, resource_code, department_id, building_location, capacity, quantity, condition_status, description, maintenance_task_id)
       VALUES ($1, $2, NULLIF($3, ''), $4, NULLIF($5, ''), $6, $7, $8, $9, $10) RETURNING *`,
      [name.trim(), type.trim(), resource_code?.trim().toUpperCase() || "", departmentId, building_location?.trim() || "",
        capacity === "" ? null : capacity ?? null, quantity === "" ? null : quantity ?? null, condition_status || "Good",
        typeof description === "string" ? description.trim() : "", maintenanceTaskId]
    );
    await pool.query("INSERT INTO activity_logs (user_id, action, details, entity_type, entity_id, after_data) VALUES ($1, 'Create Resource', $2, 'resource', $3, $4::jsonb)", [req.userId, `Created resource (${type.trim()}).`, result.rows[0].id, JSON.stringify(result.rows[0])]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (databaseErrorCode(err) === "23505") return res.status(409).json({ error: "Resource code already exists" });
    console.error("Create resource error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/resources/:id", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const resourceId = parsePositiveId(req.params.id);
    if (!resourceId) return res.status(400).json({ error: "Resource ID must be a positive integer" });
    const { name, type, status, resource_code, department_id, building_location, capacity, quantity, condition_status, description, maintenance_task_id, is_active } = req.body;
    if (name !== undefined && (!isNonEmptyString(name) || name.trim().length > 100)) return res.status(400).json({ error: "Resource name must contain 1 to 100 characters" });
    if (type !== undefined && (!isNonEmptyString(type) || type.trim().length > 50)) return res.status(400).json({ error: "Resource category must contain 1 to 50 characters" });
    if (is_active !== undefined && typeof is_active !== "boolean") return res.status(400).json({ error: "Resource active state must be true or false" });
    if (status !== undefined && !["Available", "Maintenance", "Unavailable"].includes(status)) return res.status(400).json({ error: "Invalid resource availability status" });
    if (condition_status !== undefined && !["Good", "Fair", "Poor", "Under Maintenance"].includes(condition_status)) return res.status(400).json({ error: "Invalid resource condition" });
    for (const [label, value] of [["Capacity", capacity], ["Quantity", quantity]] as const) {
      if (value !== undefined && value !== null && value !== "" && (!Number.isInteger(Number(value)) || Number(value) < 0)) return res.status(400).json({ error: `${label} must be a non-negative whole number` });
    }
    const departmentId = department_id === undefined ? undefined : department_id ? parsePositiveId(department_id) : null;
    const taskId = maintenance_task_id === undefined ? undefined : maintenance_task_id ? parsePositiveId(maintenance_task_id) : null;
    if ((department_id && !departmentId) || (maintenance_task_id && !taskId)) return res.status(400).json({ error: "Department or maintenance task ID is invalid" });
    if (departmentId) {
      const department = await pool.query("SELECT id FROM departments WHERE id = $1 AND is_active = true", [departmentId]);
      if (!department.rows.length) return res.status(404).json({ error: "Active owning department not found" });
    }
    if (taskId) {
      const task = await pool.query("SELECT id FROM tasks WHERE id = $1", [taskId]);
      if (!task.rows.length) return res.status(404).json({ error: "Maintenance task not found" });
    }
    if (is_active === false || (status !== undefined && status !== "Available")) {
      const futureBooking = await pool.query("SELECT id FROM resource_bookings WHERE resource_id = $1 AND status = ANY($2::varchar[]) AND end_time > NOW() LIMIT 1", [resourceId, BLOCKING_BOOKING_STATUSES]);
      if (futureBooking.rows.length) return res.status(409).json({ error: "Resolve or cancel future reservations before deactivating or making this resource unavailable" });
    }
    const beforeResource = await pool.query("SELECT * FROM resources WHERE id = $1", [resourceId]);
    if (!beforeResource.rows.length) return res.status(404).json({ error: "Resource not found" });
    const result = await pool.query(
      `UPDATE resources SET name = COALESCE($1, name), type = COALESCE($2, type), status = COALESCE($3, status),
         resource_code = CASE WHEN $4::boolean THEN NULLIF($5, '') ELSE resource_code END,
         department_id = CASE WHEN $6::boolean THEN $7::integer ELSE department_id END,
         building_location = CASE WHEN $8::boolean THEN NULLIF($9, '') ELSE building_location END,
         capacity = CASE WHEN $10::boolean THEN $11::integer ELSE capacity END,
         quantity = CASE WHEN $12::boolean THEN $13::integer ELSE quantity END,
         condition_status = COALESCE($14, condition_status),
         description = CASE WHEN $15::boolean THEN $16 ELSE description END,
         maintenance_task_id = CASE WHEN $17::boolean THEN $18::integer ELSE maintenance_task_id END,
         is_active = COALESCE($19, is_active), updated_at = NOW()
       WHERE id = $20 RETURNING *`,
      [name === undefined ? null : name.trim(), type === undefined ? null : type.trim(), status ?? null, resource_code !== undefined,
        typeof resource_code === "string" ? resource_code.trim().toUpperCase() : "", department_id !== undefined, departmentId ?? null,
        building_location !== undefined, building_location?.trim() || "", capacity !== undefined, capacity === "" ? null : capacity ?? null,
        quantity !== undefined, quantity === "" ? null : quantity ?? null, condition_status ?? null, description !== undefined,
        description ?? null, maintenance_task_id !== undefined, taskId ?? null, is_active ?? null, resourceId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Resource not found" });
    await pool.query("INSERT INTO activity_logs (user_id, action, details, entity_type, entity_id, before_data, after_data) VALUES ($1, $2, $3, 'resource', $4, $5::jsonb, $6::jsonb)", [req.userId, is_active === false ? "Deactivate Resource" : "Update Resource", `Updated resource ${resourceId}; fields: ${Object.keys(req.body).join(", ")}.`, resourceId, JSON.stringify(beforeResource.rows[0]), JSON.stringify(result.rows[0])]);
    res.json(result.rows[0]);
  } catch (err) {
    if (databaseErrorCode(err) === "23505") return res.status(409).json({ error: "Resource code already exists" });
    console.error("Update resource error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/resources/book - Book resource
router.post("/resources/book", async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  try {
    const { resource_id, event_id, start_time, end_time } = req.body;
    if (!resource_id || !event_id || !start_time || !end_time) {
      res.status(400).json({ error: "Resource ID, Event ID, start_time, and end_time are required" });
      return;
    }

    const times = validateBookingTimes(start_time, end_time);
    if (!times) {
      res.status(400).json({ error: "A valid start_time earlier than end_time is required" });
      return;
    }

    const resourceId = parsePositiveId(resource_id);
    const eventId = parsePositiveId(event_id);
    if (!resourceId || !eventId) {
      res.status(400).json({ error: "Resource ID and Event ID must be valid positive integers" });
      return;
    }

    const [resource, event, user] = await Promise.all([
      pool.query("SELECT id, status, is_active, condition_status FROM resources WHERE id = $1", [resourceId]),
      pool.query("SELECT id, title, coordinator_id, department_id, status FROM events WHERE id = $1", [eventId]),
      pool.query("SELECT department_id FROM users WHERE id = $1", [req.userId]),
    ]);
    if (!resource.rows.length || !resource.rows[0].is_active) return res.status(404).json({ error: "Active resource not found" });
    if (!event.rows.length) return res.status(404).json({ error: "Event not found" });
    if (resource.rows[0].status !== "Available" || resource.rows[0].condition_status === "Under Maintenance") return res.status(409).json({ error: "This resource is unavailable or under maintenance" });
    const eventScope = event.rows[0];
    if (req.userRole !== "super_admin") {
      if (req.userRole === "dept_head" && eventScope.department_id !== user.rows[0]?.department_id) return res.status(403).json({ error: "You can only reserve resources for your department's events" });
      if (req.userRole === "employee") {
        const assignment = await pool.query(
          `SELECT 1 FROM events e WHERE e.id = $1 AND (
             e.coordinator_id = $2 OR EXISTS (SELECT 1 FROM tasks t WHERE t.event_id = e.id AND (t.assigned_to_id = $2 OR t.assigned_dept_id = $3))
           )`,
          [eventId, req.userId, user.rows[0]?.department_id ?? null]
        );
        if (!assignment.rows.length) return res.status(403).json({ error: "You are not assigned to this event" });
      }
    }

    await client.query("BEGIN");
    await lockResources(client, [resourceId]);
    const conflict = await findBookingConflict(client, resourceId, times.startTime, times.endTime);

    if (conflict.rows.length > 0) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: conflictMessage(conflict.rows[0]) });
      return;
    }

    const result = await client.query(
      `INSERT INTO resource_bookings (resource_id, event_id, booked_by, start_time, end_time, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [resourceId, eventId, req.userId, times.startTime, times.endTime, req.userRole === "super_admin" ? "Approved" : "Pending"]
    );
    await client.query("INSERT INTO activity_logs (user_id, action, details, entity_type, entity_id, after_data) VALUES ($1, $2, $3, 'resource_booking', $4, $5::jsonb)",
      [req.userId, "Request Resource Booking", `Resource ${resourceId} requested for event ${eventId}; status ${result.rows[0].status}.`, result.rows[0].id, JSON.stringify(result.rows[0])]);
    await client.query("COMMIT");

    const status = result.rows[0].status as string;
    const recipients = await pool.query(
      `SELECT DISTINCT id FROM users WHERE id = $1 OR id = $2
         OR ($3 = 'Pending' AND role = 'super_admin')`,
      [req.userId, eventScope.coordinator_id, status]
    );
    await createNotifications(recipients.rows.map((recipient) => ({
      userId: recipient.id,
      type: "booking_status_changed",
      title: status === "Pending" ? "Resource booking request" : "Resource booking approved",
      message: status === "Pending" ? `A reservation was requested for ${eventScope.title}.` : `Your reservation for ${eventScope.title} has been approved.`,
      entityType: "event",
      entityId: eventId,
      dedupeKey: `booking:${result.rows[0].id}:status:${status}`,
    })));

    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Book resource error:", err);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

router.put("/resources/bookings/:id/cancel", async (req: AuthRequest, res: Response) => {
  try {
    const bookingId = parsePositiveId(req.params.id);
    if (!bookingId) return res.status(400).json({ error: "Booking ID must be a positive integer" });
    const result = await pool.query(
      `UPDATE resource_bookings SET status = 'Cancelled'
       WHERE id = $1 AND (booked_by = $2 OR $3 = 'super_admin')
         AND status = ANY($4::varchar[])
       RETURNING id, event_id, resource_id, status`,
      [bookingId, req.userId, req.userRole, BLOCKING_BOOKING_STATUSES]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Active booking not found or cancellation is not permitted" });
    await pool.query("INSERT INTO activity_logs (user_id, action, details, entity_type, entity_id, after_data) VALUES ($1, 'Cancel Resource Booking', $2, 'resource_booking', $3, $4::jsonb)", [req.userId, `Cancelled resource booking ${bookingId}.`, bookingId, JSON.stringify(result.rows[0])]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Cancel booking error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/admin/resources/bookings/:id - Update booking status or booking details
router.put("/resources/bookings/:id", requireAdmin, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  try {
    const { status, resource_id, event_id, start_time, end_time } = req.body;
    if (!['Pending', 'Approved', 'Active', 'Confirmed', 'Cancelled', 'Rejected'].includes(status)) {
      res.status(400).json({ error: "Invalid booking status" });
      return;
    }

    const bookingId = Number(req.params.id);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      res.status(400).json({ error: "Booking ID must be a valid positive integer" });
      return;
    }

    await client.query("BEGIN");
    const existingResult = await client.query(
      `SELECT id, resource_id, event_id, booked_by, start_time, end_time, status
       FROM resource_bookings WHERE id = $1 FOR UPDATE`,
      [bookingId]
    );
    if (!existingResult.rows.length) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Booking not found" });
      return;
    }

    const existing = existingResult.rows[0];
    const resourceId = resource_id === undefined ? existing.resource_id : parsePositiveId(resource_id);
    const eventId = event_id === undefined ? existing.event_id : parsePositiveId(event_id);
    if (!resourceId || !eventId) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "Resource ID and Event ID must be valid positive integers" });
      return;
    }

    const references = await client.query(
      "SELECT (SELECT COUNT(*) FROM resources WHERE id = $1) AS resource_count, (SELECT COUNT(*) FROM events WHERE id = $2) AS event_count",
      [resourceId, eventId]
    );
    if (Number(references.rows[0].resource_count) === 0 || Number(references.rows[0].event_count) === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: Number(references.rows[0].resource_count) === 0 ? "Resource not found" : "Event not found" });
      return;
    }

    const times = validateBookingTimes(start_time ?? existing.start_time, end_time ?? existing.end_time);
    if (!times) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "A valid start_time earlier than end_time is required" });
      return;
    }

    await lockResources(client, [existing.resource_id, resourceId]);
    if (BLOCKING_BOOKING_STATUSES.includes(status)) {
      const conflict = await findBookingConflict(client, resourceId, times.startTime, times.endTime, bookingId);
      if (conflict.rows.length > 0) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: conflictMessage(conflict.rows[0]) });
        return;
      }
    }

    const result = await client.query(
      `UPDATE resource_bookings
       SET status = $1, resource_id = $2, event_id = $3, start_time = $4, end_time = $5
       WHERE id = $6
       RETURNING id, event_id, booked_by, status`,
      [status, resourceId, eventId, times.startTime, times.endTime, bookingId]
    );
    await client.query("COMMIT");
    const booking = result.rows[0];
    await pool.query("INSERT INTO activity_logs (user_id, action, details, entity_type, entity_id, before_data, after_data) VALUES ($1, $2, $3, 'resource_booking', $4, $5::jsonb, $6::jsonb)",
      [req.userId, `Resource Booking ${status}`, `Updated booking ${booking.id} to ${status}.`, booking.id, JSON.stringify(existing), JSON.stringify(booking)]);
    await createNotifications([{
      userId: booking.booked_by,
      type: "booking_status_changed",
      title: "Resource booking status changed",
      message: `Your resource booking is now ${status.toLowerCase()}.`,
      entityType: "event",
      entityId: booking.event_id,
      dedupeKey: `booking:${booking.id}:status:${status}`,
    }]);
    res.json(booking);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Update booking error:", err);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
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
      await notifyTaskAudience(Number(id), {
        type: status === "Under Review" ? "task_submitted" : status === "Completed" ? "task_approved" : status === "Rejected" ? "task_rejected" : "task_status_updated",
        title: "Task status updated",
        message: `Task status changed to ${status}.`,
        entityType: "task",
        entityId: Number(id),
        dedupeKey: `task:${id}:admin-status:${Date.now()}`,
      }, req.userId);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Admin update task error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
