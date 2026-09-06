import { Router, Response } from "express";
import pool from "../db.js";
import { authenticate, AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(authenticate);

router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit || "50")), 100);
    const result = await pool.query(
      `SELECT id, type, title, message, entity_type, entity_id, read_at, created_at
       FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [req.userId, limit]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("List notifications error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/unread-count", async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT COUNT(*)::integer AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL",
      [req.userId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Unread notifications error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id/read", async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      "UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = $1 AND user_id = $2 RETURNING id, read_at",
      [req.params.id, req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Notification not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Mark notification read error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/read-all", async (req: AuthRequest, res: Response) => {
  try {
    await pool.query("UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL", [req.userId]);
    res.json({ message: "Notifications marked as read" });
  } catch (err) {
    console.error("Mark all notifications read error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;