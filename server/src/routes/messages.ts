import { Router, Response } from "express";
import pool from "../db.js";
import { authenticate, AuthRequest } from "../middleware/auth.js";

const router = Router();

// ==========================================
// ANNOUNCEMENTS SECTION
// ==========================================

// GET /api/messages/announcements - Fetch announcements targeting user's department or public
router.get("/announcements", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userRes = await pool.query("SELECT department_id FROM users WHERE id = $1", [req.userId]);
    const deptId = userRes.rows[0]?.department_id;

    const result = await pool.query(
      `SELECT a.*, u.name as author_name, d.name as department_name
       FROM announcements a
       JOIN users u ON a.created_by = u.id
       LEFT JOIN departments d ON a.target_dept_id = d.id
       WHERE a.target_dept_id IS NULL OR a.target_dept_id = $1
       ORDER BY a.created_at DESC`,
      [deptId || -1]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch announcements error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/messages/announcements - Broadcast new announcement (Admins & Dept Heads only)
router.post("/announcements", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (req.userRole === "employee") {
      res.status(403).json({ error: "Admins or Department Heads only" });
      return;
    }
    const { title, content, target_dept_id } = req.body;
    if (!title || !content) {
      res.status(400).json({ error: "Title and content are required" });
      return;
    }

    const result = await pool.query(
      `INSERT INTO announcements (title, content, created_by, target_dept_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [title, content, req.userId, target_dept_id || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create announcement error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ==========================================
// CHAT MESSAGING SECTION
// ==========================================

// GET /api/messages/contacts - List active contacts for chat
router.get("/contacts", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const isAdmin = req.userRole === "admin" || req.userRole === "super_admin";

    if (isAdmin) {
      // Admins get list of all employees & department heads
      const result = await pool.query(
        "SELECT id, name, role FROM users WHERE role != 'admin' AND role != 'super_admin' ORDER BY name ASC"
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
    const isAd = req.userRole === "admin" || req.userRole === "super_admin";
    const targetUserId = isAd ? contactId : req.userId;

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

    const isAd = req.userRole === "admin" || req.userRole === "super_admin";
    const targetUserId = isAd ? contactId : req.userId;
    const sentByUser = !isAd; // sentByUser means sent by student/employee

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
