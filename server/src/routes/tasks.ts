import { Router, Response } from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import pool from "../db.js";
import { authenticate, AuthRequest } from "../middleware/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const storage = multer.diskStorage({
  destination: path.join(__dirname, "../../uploads"),
  filename: (_req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

const router = Router();

// ==========================================
// EVENTS SECTION
// ==========================================

// GET /api/tasks/events/all - List all events
router.get("/events/all", authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT e.*, u.name as coordinator_name
       FROM events e
       LEFT JOIN users u ON e.coordinator_id = u.id
       ORDER BY e.start_date ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("List events error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/tasks/events - Create new event (Admins and Super Admins only)
router.post("/events", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (req.userRole !== "admin" && req.userRole !== "super_admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const { title, description, location, start_date, end_date, coordinator_id, status } = req.body;
    if (!title) {
      res.status(400).json({ error: "Event title is required" });
      return;
    }

    const qrKey = `qr_${title.replace(/\s+/g, "_").toLowerCase()}_${Date.now()}`;
    const result = await pool.query(
      `INSERT INTO events (title, description, location, start_date, end_date, coordinator_id, status, qr_code_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [title, description || "", location || "", start_date || null, end_date || null, coordinator_id || req.userId, status || "Draft", qrKey]
    );

    // Create activity log
    await pool.query(
      `INSERT INTO activity_logs (user_id, action, details) VALUES ($1, $2, $3)`,
      [req.userId, "Create Event", `Event "${title}" was created.`]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create event error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/tasks/events/:id/meeting-notes - Fetch meeting notes for an event
router.get("/events/:id/meeting-notes", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT mn.*, u.name as author_name
       FROM meeting_notes mn
       LEFT JOIN users u ON mn.created_by = u.id
       WHERE mn.event_id = $1
       ORDER BY mn.created_at DESC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch meeting notes error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/tasks/events/:id/meeting-notes - Create meeting notes
router.post("/events/:id/meeting-notes", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { title, notes } = req.body;
    if (!title || !notes) {
      res.status(400).json({ error: "Title and notes are required" });
      return;
    }

    const result = await pool.query(
      `INSERT INTO meeting_notes (event_id, title, notes, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, title, notes, req.userId]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create meeting notes error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/tasks/events/:id/feedback - Fetch feedback for an event
router.get("/events/:id/feedback", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT ef.*, u.name as user_name
       FROM event_feedback ef
       LEFT JOIN users u ON ef.user_id = u.id
       WHERE ef.event_id = $1
       ORDER BY ef.created_at DESC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch feedback error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/tasks/events/:id/feedback - Post feedback
router.post("/events/:id/feedback", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { rating, comments } = req.body;
    if (!rating) {
      res.status(400).json({ error: "Rating is required" });
      return;
    }

    const result = await pool.query(
      `INSERT INTO event_feedback (event_id, user_id, rating, comments)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, req.userId, rating, comments || ""]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Post feedback error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/tasks/events/:id/attendance - Log attendance (QR checkin)
router.post("/events/:id/attendance", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { qr_code_key } = req.body;

    const eventCheck = await pool.query("SELECT qr_code_key, title FROM events WHERE id = $1", [id]);
    if (eventCheck.rows.length === 0) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    if (eventCheck.rows[0].qr_code_key !== qr_code_key) {
      res.status(400).json({ error: "Invalid QR code" });
      return;
    }

    // Check if already checked in
    const checked = await pool.query("SELECT id FROM attendance WHERE event_id = $1 AND user_id = $2", [id, req.userId]);
    if (checked.rows.length > 0) {
      res.status(409).json({ error: "Attendance already logged for this event" });
      return;
    }

    await pool.query(
      "INSERT INTO attendance (event_id, user_id) VALUES ($1, $2)",
      [id, req.userId]
    );

    res.json({ message: `Successfully registered attendance for "${eventCheck.rows[0].title}"!` });
  } catch (err) {
    console.error("QR attendance log error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/tasks/events/:id/attendance - View attendance log for an event
router.get("/events/:id/attendance", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT a.scanned_at, u.name, u.email, d.name as department
       FROM attendance a
       JOIN users u ON a.user_id = u.id
       LEFT JOIN departments d ON u.department_id = d.id
       WHERE a.event_id = $1
       ORDER BY a.scanned_at DESC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("View attendance error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ==========================================
// TASKS SECTION
// ==========================================

// GET /api/tasks - List tasks
router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { status, event_id, priority } = req.query;
    
    // Build query based on role
    // Employees see tasks assigned to them OR their department
    // Department Heads see tasks assigned to their department
    // Admins and Super Admins see all tasks
    const isEmployee = req.userRole === "employee";
    const isDeptHead = req.userRole === "dept_head";
    
    let query = `
      SELECT t.*, e.title as event_title, u.name as assigned_to_name, d.name as assigned_dept_name
      FROM tasks t
      LEFT JOIN events e ON t.event_id = e.id
      LEFT JOIN users u ON t.assigned_to_id = u.id
      LEFT JOIN departments d ON t.assigned_dept_id = d.id
    `;
    
    const params: (number | string)[] = [];
    let paramIdx = 1;
    const whereClauses: string[] = [];

    // Role restrictions
    if (isEmployee) {
      // Find employee's department
      const userRes = await pool.query("SELECT department_id FROM users WHERE id = $1", [req.userId]);
      const deptId = userRes.rows[0]?.department_id;
      
      if (deptId) {
        whereClauses.push(`(t.assigned_to_id = $${paramIdx} OR t.assigned_dept_id = $${paramIdx + 1})`);
        params.push(req.userId!);
        params.push(deptId);
        paramIdx += 2;
      } else {
        whereClauses.push(`t.assigned_to_id = $${paramIdx}`);
        params.push(req.userId!);
        paramIdx++;
      }
    } else if (isDeptHead) {
      const userRes = await pool.query("SELECT department_id FROM users WHERE id = $1", [req.userId]);
      const deptId = userRes.rows[0]?.department_id;
      if (deptId) {
        whereClauses.push(`t.assigned_dept_id = $${paramIdx}`);
        params.push(deptId);
        paramIdx++;
      } else {
        whereClauses.push("t.assigned_dept_id = -1"); // No department
      }
    }

    // Direct filters
    if (status && status !== "All") {
      whereClauses.push(`t.status = $${paramIdx}`);
      params.push(status as string);
      paramIdx++;
    }
    if (event_id) {
      whereClauses.push(`t.event_id = $${paramIdx}`);
      params.push(parseInt(event_id as string));
      paramIdx++;
    }
    if (priority && priority !== "All") {
      whereClauses.push(`t.priority = $${paramIdx}`);
      params.push(priority as string);
      paramIdx++;
    }

    if (whereClauses.length > 0) {
      query += ` WHERE ${whereClauses.join(" AND ")}`;
    }
    
    query += ` ORDER BY t.due_date ASC, t.created_at DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error("List tasks error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/tasks/latest - Latest updates for dashboard
router.get("/latest", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const isEmployee = req.userRole === "employee";
    const isDeptHead = req.userRole === "dept_head";
    
    let query = `
      SELECT t.id, t.description,
             CASE WHEN LENGTH(t.description) > 60 THEN SUBSTRING(t.description, 1, 60) || '...' ELSE t.description END as short_desc,
             t.title, t.status, t.created_at, e.title as event_title
      FROM tasks t
      LEFT JOIN events e ON t.event_id = e.id
    `;
    
    const params = [];
    if (isEmployee) {
      const userRes = await pool.query("SELECT department_id FROM users WHERE id = $1", [req.userId]);
      const deptId = userRes.rows[0]?.department_id;
      query += deptId
        ? ` WHERE t.assigned_to_id = $1 OR t.assigned_dept_id = $2`
        : ` WHERE t.assigned_to_id = $1`;
      params.push(req.userId!);
      if (deptId) params.push(deptId);
    } else if (isDeptHead) {
      const userRes = await pool.query("SELECT department_id FROM users WHERE id = $1", [req.userId]);
      const deptId = userRes.rows[0]?.department_id;
      query += ` WHERE t.assigned_dept_id = $1`;
      params.push(deptId || -1);
    }

    query += ` ORDER BY t.updated_at DESC LIMIT 10`;
    const result = await pool.query(query, params);

    // Adapt layout structure for task updates cards
    const adapted = result.rows.map((row) => ({
      id: row.id,
      title: `${row.title} (${row.event_title || "General Event"})`,
      short_desc: row.short_desc,
      status: row.status,
      created_at: row.created_at
    }));

    res.json(adapted);
  } catch (err) {
    console.error("Latest tasks error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/tasks/history - Full history search
router.get("/history", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { search, status } = req.query;
    let query = `
      SELECT t.id, t.title as category, t.description, t.status, t.created_at, e.title as location
      FROM tasks t
      LEFT JOIN events e ON t.event_id = e.id
    `;
    const params: string[] = [];
    let paramIdx = 1;
    const whereClauses = [];

    if (status && status !== "All") {
      whereClauses.push(`t.status = $${paramIdx++}`);
      params.push(status as string);
    }

    if (search) {
      whereClauses.push(`(t.title ILIKE $${paramIdx} OR t.description ILIKE $${paramIdx} OR e.title ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    if (whereClauses.length > 0) {
      query += ` WHERE ${whereClauses.join(" AND ")}`;
    }
    query += ` ORDER BY t.created_at DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error("Tasks history error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/tasks/:id - Detailed view
router.get("/:id", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const taskResult = await pool.query(
      `SELECT t.*, e.title as event_title, e.location as event_location, e.qr_code_key,
              u.name as assigned_to_name, u.email as assigned_to_email,
              d.name as assigned_dept_name
       FROM tasks t
       LEFT JOIN events e ON t.event_id = e.id
       LEFT JOIN users u ON t.assigned_to_id = u.id
       LEFT JOIN departments d ON t.assigned_dept_id = d.id
       WHERE t.id = $1`,
      [id]
    );

    if (taskResult.rows.length === 0) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    const task = taskResult.rows[0];

    // Fetch Subtasks (Checklist)
    const subtasks = await pool.query(
      `SELECT s.*, u.name as assigned_to_name
       FROM subtasks s
       LEFT JOIN users u ON s.assigned_to_id = u.id
       WHERE s.task_id = $1
       ORDER BY s.id ASC`,
      [id]
    );

    // Fetch Comments
    const comments = await pool.query(
      `SELECT tc.*, u.name as author_name
       FROM task_comments tc
       JOIN users u ON tc.user_id = u.id
       WHERE tc.task_id = $1
       ORDER BY tc.created_at ASC`,
      [id]
    );

    // Adapt to original structure where logs = comments
    const work_logs = comments.rows.map((c) => ({
      id: c.id,
      text: `${c.author_name}: ${c.text}`,
      created_at: c.created_at,
    }));

    res.json({
      ...task,
      subtasks: subtasks.rows,
      work_logs: work_logs,
      comments: comments.rows,
      category: task.title, // keep layout mapping compatibility
      location: task.event_title || "General",
    });
  } catch (err) {
    console.error("Task detail error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/tasks - Create task (Admins/Dept Heads only)
router.post("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (req.userRole === "employee") {
      res.status(403).json({ error: "Admins or Department Heads access only" });
      return;
    }

    const { event_id, title, description, assigned_to_id, assigned_dept_id, priority, due_date } = req.body;
    if (!title || !event_id) {
      res.status(400).json({ error: "Title and Event ID are required" });
      return;
    }

    // Check event exists
    const eventRes = await pool.query("SELECT title FROM events WHERE id = $1", [event_id]);
    if (eventRes.rows.length === 0) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const result = await pool.query(
      `INSERT INTO tasks (event_id, title, description, assigned_to_id, assigned_dept_id, priority, due_date, status, progress)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', 0)
       RETURNING *`,
      [
        event_id,
        title,
        description || "",
        assigned_to_id || null,
        assigned_dept_id || null,
        priority || "Medium",
        due_date || null
      ]
    );

    const task = result.rows[0];

    // Log action
    await pool.query(
      `INSERT INTO activity_logs (user_id, action, details) VALUES ($1, $2, $3)`,
      [req.userId, "Create Task", `Task "${title}" created for event "${eventRes.rows[0].title}".`]
    );

    // Initial system comment
    await pool.query(
      `INSERT INTO task_comments (task_id, user_id, text) VALUES ($1, $2, $3)`,
      [task.id, req.userId, `Task created and initialized.`]
    );

    res.status(201).json(task);
  } catch (err) {
    console.error("Create task error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/tasks/:id - Update status / progress / upload proof
router.put("/:id", authenticate, upload.single("proof"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status, progress, priority, assigned_to_id, assigned_dept_id, comment } = req.body;

    const taskCheck = await pool.query("SELECT * FROM tasks WHERE id = $1", [id]);
    if (taskCheck.rows.length === 0) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    const originalTask = taskCheck.rows[0];

    // If uploading a proof file
    let proofUrl = originalTask.proof_url;
    if (req.file) {
      proofUrl = `/uploads/${req.file.filename}`;
    }

    // Auto update status if proof is uploaded
    let finalStatus = status || originalTask.status;
    let finalProgress = progress !== undefined ? parseInt(progress) : originalTask.progress;

    if (req.file) {
      finalStatus = "Under Review";
      finalProgress = 90;
    }

    if (finalStatus === "Completed") {
      finalProgress = 100;
    }

    const result = await pool.query(
      `UPDATE tasks SET
        status = $1,
        progress = $2,
        priority = COALESCE($3, priority),
        assigned_to_id = COALESCE($4, assigned_to_id),
        assigned_dept_id = COALESCE($5, assigned_dept_id),
        proof_url = $6,
        updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [
        finalStatus,
        finalProgress,
        priority || null,
        assigned_to_id || null,
        assigned_dept_id || null,
        proofUrl,
        id
      ]
    );

    const updatedTask = result.rows[0];

    // Add automatic comment on status changes
    if (status && status !== originalTask.status) {
      await pool.query(
        `INSERT INTO task_comments (task_id, user_id, text) VALUES ($1, $2, $3)`,
        [id, req.userId, `Status updated to "${status}". ${comment || ""}`]
      );
    } else if (comment) {
      await pool.query(
        `INSERT INTO task_comments (task_id, user_id, text) VALUES ($1, $2, $3)`,
        [id, req.userId, comment]
      );
    }

    if (req.file) {
      await pool.query(
        `INSERT INTO task_comments (task_id, user_id, text) VALUES ($1, $2, $3)`,
        [id, req.userId, `Submitted completion proof file: ${req.file.originalname}`]
      );
    }

    res.json(updatedTask);
  } catch (err) {
    console.error("Update task error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/tasks/:id/comments - Post comment/collaboration message
router.post("/:id/comments", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { text } = req.body;
    if (!text) {
      res.status(400).json({ error: "Comment text is required" });
      return;
    }

    const result = await pool.query(
      `INSERT INTO task_comments (task_id, user_id, text)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, req.userId, text]
    );

    const userRes = await pool.query("SELECT name FROM users WHERE id = $1", [req.userId]);
    res.status(201).json({
      ...result.rows[0],
      author_name: userRes.rows[0]?.name || "User",
    });
  } catch (err) {
    console.error("Add comment error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/tasks/:id/subtasks - Create checklist item (subtask)
router.post("/:id/subtasks", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { title, assigned_to_id } = req.body;
    if (!title) {
      res.status(400).json({ error: "Checklist item title is required" });
      return;
    }

    const result = await pool.query(
      `INSERT INTO subtasks (task_id, title, assigned_to_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, title, assigned_to_id || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Add subtask error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/tasks/subtasks/:subtaskId - Toggle subtask completion status
router.put("/subtasks/:subtaskId", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { subtaskId } = req.params;
    const { is_completed } = req.body;

    const result = await pool.query(
      `UPDATE subtasks SET is_completed = $1 WHERE id = $2 RETURNING *`,
      [is_completed, subtaskId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Subtask not found" });
      return;
    }

    // Auto recalculate parent task progress based on completed subtasks count!
    const subtask = result.rows[0];
    const stats = await pool.query(
      `SELECT COUNT(*) as total, COUNT(CASE WHEN is_completed = true THEN 1 END) as completed
       FROM subtasks WHERE task_id = $1`,
      [subtask.task_id]
    );
    const total = parseInt(stats.rows[0].total);
    const completed = parseInt(stats.rows[0].completed);

    if (total > 0) {
      const newProgress = Math.round((completed / total) * 90); // cap progress at 90% via subtasks, final 100% requires admin/head approval
      await pool.query(
        "UPDATE tasks SET progress = $1, status = 'In Progress' WHERE id = $2 AND status != 'Completed'",
        [newProgress, subtask.task_id]
      );
    }

    res.json(subtask);
  } catch (err) {
    console.error("Toggle subtask error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
