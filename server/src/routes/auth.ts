import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../db.js";
import { authenticate, AuthRequest } from "../middleware/auth.js";

const router = Router();

// POST /api/auth/register
router.post("/register", async (req, res: Response) => {
  try {
    const { name, email, password, department, role, semester } = req.body;
    if (!name || !email || !password) {
      res.status(400).json({ error: "Name, email, and password are required" });
      return;
    }

    // Check existing user
    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );
    if (existing.rows.length > 0) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    // Resolve department name to ID
    let deptId = null;
    if (department) {
      const deptRes = await pool.query(
        "SELECT id FROM departments WHERE name = $1 OR CAST(id AS TEXT) = $1",
        [department]
      );
      if (deptRes.rows.length > 0) {
        deptId = deptRes.rows[0].id;
      }
    }

    const targetRole = role || "employee";
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, department_id, semester)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email, role, semester`,
      [name, email, hash, targetRole, deptId, semester || null]
    );

    const user = result.rows[0];
    user.department = department || null;

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET || "fallback-secret",
      { expiresIn: "7d" }
    );

    res.status(201).json({ user, token });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    const result = await pool.query(
      `SELECT u.*, d.name as department
       FROM users u
       LEFT JOIN departments d ON u.department_id = d.id
       WHERE u.email = $1`,
      [email]
    );
    if (result.rows.length === 0) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET || "fallback-secret",
      { expiresIn: "7d" }
    );

    const { password_hash, department_id, ...safeUser } = user;
    res.json({ user: safeUser, token });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/auth/me
router.get("/me", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.semester,
              u.sms_notifications, u.email_notifications, u.push_notifications, u.created_at,
              d.name as department
       FROM users u
       LEFT JOIN departments d ON u.department_id = d.id
       WHERE u.id = $1`,
      [req.userId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Me error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/auth/me
router.put("/me", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const {
      name,
      department,
      semester,
      sms_notifications,
      email_notifications,
      push_notifications,
      current_password,
      new_password,
    } = req.body;

    // If changing password, verify current first
    if (new_password) {
      if (!current_password) {
        res.status(400).json({ error: "Current password required" });
        return;
      }
      const userResult = await pool.query(
        "SELECT password_hash FROM users WHERE id = $1",
        [req.userId]
      );
      const valid = await bcrypt.compare(
        current_password,
        userResult.rows[0].password_hash
      );
      if (!valid) {
        res.status(401).json({ error: "Current password is incorrect" });
        return;
      }
      const hash = await bcrypt.hash(new_password, 10);
      await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
        hash,
        req.userId,
      ]);
    }

    // Resolve department name to ID
    let deptId = undefined;
    if (department !== undefined) {
      if (department === null || department === "") {
        deptId = null;
      } else {
        const deptRes = await pool.query("SELECT id FROM departments WHERE name = $1", [department]);
        if (deptRes.rows.length > 0) {
          deptId = deptRes.rows[0].id;
        }
      }
    }

    // Update fields
    const queryParts = [];
    const params = [];
    let idx = 1;

    if (name !== undefined) {
      queryParts.push(`name = $${idx++}`);
      params.push(name);
    }
    if (deptId !== undefined) {
      queryParts.push(`department_id = $${idx++}`);
      params.push(deptId);
    }
    if (semester !== undefined) {
      queryParts.push(`semester = $${idx++}`);
      params.push(semester);
    }
    if (sms_notifications !== undefined) {
      queryParts.push(`sms_notifications = $${idx++}`);
      params.push(sms_notifications);
    }
    if (email_notifications !== undefined) {
      queryParts.push(`email_notifications = $${idx++}`);
      params.push(email_notifications);
    }
    if (push_notifications !== undefined) {
      queryParts.push(`push_notifications = $${idx++}`);
      params.push(push_notifications);
    }

    if (queryParts.length === 0) {
      // Just fetch current user
      const userRes = await pool.query(
        `SELECT u.id, u.name, u.email, u.role, u.semester,
                u.sms_notifications, u.email_notifications, u.push_notifications,
                d.name as department
         FROM users u
         LEFT JOIN departments d ON u.department_id = d.id
         WHERE u.id = $1`,
        [req.userId]
      );
      res.json(userRes.rows[0]);
      return;
    }

    params.push(req.userId);
    const updateQuery = `
      UPDATE users
      SET ${queryParts.join(", ")}
      WHERE id = $${idx}
      RETURNING id, name, email, role, semester, sms_notifications, email_notifications, push_notifications
    `;

    const updateRes = await pool.query(updateQuery, params);
    const updatedUser = updateRes.rows[0];
    updatedUser.department = department || null;

    res.json(updatedUser);
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
