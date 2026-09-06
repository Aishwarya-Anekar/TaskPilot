import { Router, Response } from "express";
import crypto from "crypto";
import pool from "../db.js";
import { authenticate, AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(authenticate);
const canManage = (req: AuthRequest) => ["admin", "super_admin", "dept_head"].includes(req.userRole || "");
const isAdmin = (req: AuthRequest) => req.userRole === "admin" || req.userRole === "super_admin";

router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    if (!canManage(req)) return res.status(403).json({ error: "Visitor management access required" });
    const { search = "", status, event_id, host_id } = req.query;
    const params: unknown[] = [String(search)];
    const filters = ["(v.name ILIKE '%' || $1 || '%' OR v.contact ILIKE '%' || $1 || '%' OR COALESCE(v.organization,'') ILIKE '%' || $1 || '%')"];
    const add = (value: unknown) => { params.push(value); return `$${params.length}`; };
    if (!isAdmin(req)) filters.push(`v.host_id = (SELECT id FROM users WHERE id = ${add(req.userId)})`);
    if (status && status !== "All") filters.push(`v.status = ${add(status)}`);
    if (event_id) filters.push(`v.event_id = ${add(Number(event_id))}`);
    if (host_id && isAdmin(req)) filters.push(`v.host_id = ${add(Number(host_id))}`);
    const result = await pool.query(`SELECT v.*, e.title AS event_title, h.name AS host_name, c.name AS created_by_name FROM visitors v LEFT JOIN events e ON e.id=v.event_id LEFT JOIN users h ON h.id=v.host_id LEFT JOIN users c ON c.id=v.created_by WHERE ${filters.join(" AND ")} ORDER BY v.expected_arrival DESC`, params);
    const countParams: unknown[] = [];
    const countScope = isAdmin(req) ? "" : `WHERE host_id = $1`;
    if (!isAdmin(req)) countParams.push(req.userId);
    const counts = await pool.query(`SELECT COUNT(*) FILTER (WHERE status='Expected')::int AS expected, COUNT(*) FILTER (WHERE status='Checked In')::int AS checked_in, COUNT(*) FILTER (WHERE status='Checked Out')::int AS checked_out FROM visitors ${countScope}`, countParams);
    res.json({ visitors: result.rows, counts: counts.rows[0] });
  } catch (error) { console.error("List visitors error:", error); res.status(500).json({ error: "Server error" }); }
});

router.get("/:id", async (req: AuthRequest, res: Response) => {
  try {
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
    const { name, contact, organization, purpose, event_id, host_id, expected_arrival } = req.body;
    if (!name?.trim() || !contact?.trim() || !purpose?.trim() || !expected_arrival) return res.status(400).json({ error: "Name, contact, purpose, and expected arrival are required" });
    const host = Number(host_id) || req.userId;
    const passCode = `VP-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
    const result = await pool.query(`INSERT INTO visitors (name,contact,organization,purpose,event_id,host_id,expected_arrival,pass_code,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [name.trim(), contact.trim(), organization?.trim() || null, purpose.trim(), event_id || null, host, expected_arrival, passCode, req.userId]);
    await pool.query("INSERT INTO visitor_activity (visitor_id,action,performed_by,details) VALUES ($1,'REGISTERED',$2,$3)", [result.rows[0].id, req.userId, "Visitor registered"]);
    res.status(201).json(result.rows[0]);
  } catch (error) { console.error("Register visitor error:", error); res.status(500).json({ error: "Server error" }); }
});

async function updateStatus(req: AuthRequest, res: Response, status: string) {
  const result = await pool.query("SELECT id, host_id, status FROM visitors WHERE id=$1", [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: "Visitor not found" });
  if (!isAdmin(req) && result.rows[0].host_id !== req.userId) return res.status(403).json({ error: "Visitor access denied" });
  const timeColumn = status === "Checked In" ? "check_in_at" : "check_out_at";
  const updated = await pool.query(`UPDATE visitors SET status=$1, ${timeColumn}=NOW(), updated_at=NOW() WHERE id=$2 RETURNING *`, [status, req.params.id]);
  await pool.query("INSERT INTO visitor_activity (visitor_id,action,performed_by,details) VALUES ($1,$2,$3,$4)", [req.params.id, status === "Checked In" ? "CHECK_IN" : "CHECK_OUT", req.userId, `Visitor ${status.toLowerCase()}`]);
  res.json(updated.rows[0]);
}
router.post("/:id/check-in", async (req: AuthRequest, res: Response) => { try { return await updateStatus(req, res, "Checked In"); } catch (error) { console.error("Visitor check-in error:", error); res.status(500).json({ error: "Server error" }); } });
router.post("/:id/check-out", async (req: AuthRequest, res: Response) => { try { return await updateStatus(req, res, "Checked Out"); } catch (error) { console.error("Visitor check-out error:", error); res.status(500).json({ error: "Server error" }); } });

export default router;