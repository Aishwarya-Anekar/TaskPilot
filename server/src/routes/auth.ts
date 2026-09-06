import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../db.js";
import { authenticate, AuthRequest } from "../middleware/auth.js";
import { sendWelcomeEmail, sendVerificationEmail } from "../email.js";
import { sendPasswordResetEmail } from "../email.js";
import crypto from "crypto";

const router = Router();

const resetAttempts = new Map<string, { count: number; resetAt: number }>();
const verificationAttempts = new Map<number, { count: number; resetAt: number }>();

async function issueVerification(user: { id: number; name: string; email: string }) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  await pool.query("UPDATE email_verification_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL", [user.id]);
  await pool.query("INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '24 hours')", [user.id, tokenHash]);
  await sendVerificationEmail(user, rawToken);
}

router.get("/verify-email", async (req: any, res: Response) => {
  try {
    const token = String(req.query.token || "");
    if (!token) return res.status(400).json({ error: "Verification link is invalid or expired." });
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const result = await pool.query("SELECT id, user_id FROM email_verification_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()", [hash]);
    if (!result.rows.length) return res.status(400).json({ error: "Verification link is invalid or expired." });
    await pool.query("UPDATE users SET email_verified = true WHERE id = $1", [result.rows[0].user_id]);
    await pool.query("UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1", [result.rows[0].id]);
    res.json({ message: "Email verified successfully. Your account is active." });
  } catch (error) { console.error("Email verification error:", error); res.status(500).json({ error: "Unable to verify email" }); }
});

router.post("/resend-verification", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const attempt = verificationAttempts.get(req.userId!); const now = Date.now();
    if (attempt && attempt.resetAt > now && attempt.count >= 3) return res.status(429).json({ error: "Too many verification requests. Try again later." });
    const result = await pool.query("SELECT id, name, email, email_verified FROM users WHERE id = $1", [req.userId]);
    if (!result.rows.length || result.rows[0].email_verified) return res.json({ message: "If verification is required, a new email has been sent." });
    verificationAttempts.set(req.userId!, { count: attempt && attempt.resetAt > now ? attempt.count + 1 : 1, resetAt: now + 15 * 60 * 1000 });
    await issueVerification(result.rows[0]);
    res.json({ message: "If verification is required, a new email has been sent." });
  } catch (error) { console.error("Resend verification error:", error); res.json({ message: "If verification is required, a new email has been sent." }); }
});

router.post("/forgot-password", async (req: any, res: Response) => {
  const generic = "If an account exists for that email, a password reset link has been sent.";
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const now = Date.now(); const attempt = resetAttempts.get(email);
    if (attempt && attempt.resetAt > now && attempt.count >= 5) return res.json({ message: generic });
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.json({ message: generic });
    resetAttempts.set(email, { count: attempt && attempt.resetAt > now ? attempt.count + 1 : 1, resetAt: now + 15 * 60 * 1000 });
    const userResult = await pool.query("SELECT id, name, email FROM users WHERE LOWER(email) = $1", [email]);
    if (userResult.rows.length) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      await pool.query("UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL", [userResult.rows[0].id]);
      await pool.query("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')", [userResult.rows[0].id, tokenHash]);
      try { await sendPasswordResetEmail(userResult.rows[0], rawToken); } catch (error) { console.error("Password reset email failed:", error instanceof Error ? error.message : "Unknown email error"); }
    }
    return res.json({ message: generic });
  } catch (error) { console.error("Forgot password error:", error); return res.json({ message: generic }); }
});

router.post("/reset-password", async (req: any, res: Response) => {
  try {
    const { token, password, confirmPassword } = req.body;
    if (typeof token !== "string" || typeof password !== "string" || password !== confirmPassword || password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) return res.status(400).json({ error: "Use matching passwords with 8+ characters, uppercase, lowercase, and a number." });
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const result = await pool.query("SELECT id, user_id FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()", [hash]);
    if (!result.rows.length) return res.status(400).json({ error: "This reset link is invalid or expired." });
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [await bcrypt.hash(password, 12), result.rows[0].user_id]);
    await pool.query("UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1", [result.rows[0].id]);
    res.json({ message: "Password reset successfully. You can now sign in." });
  } catch (error) { console.error("Reset password error:", error); res.status(500).json({ error: "Unable to reset password" }); }
});

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
    await pool.query("UPDATE users SET email_verified = false WHERE id = $1", [user.id]);
    try { await issueVerification(user); } catch (error) { console.error("Registration verification email failed:", error instanceof Error ? error.message : "Unknown email error"); }
    await sendWelcomeEmail(user);

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
