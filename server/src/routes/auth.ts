import { NextFunction, Request, Router, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../db.js";
import { authenticate, AuthRequest } from "../middleware/auth.js";
import { sendAccountSetupEmail, sendPasswordResetEmail, sendVerificationEmail } from "../email.js";
import crypto from "crypto";
import { isEmail, isNonEmptyString, passwordError } from "../validation.js";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const profileUploadDir = path.join(__dirname, "../../uploads/profile");
fs.mkdirSync(profileUploadDir, { recursive: true });

const profilePhotoTypes: Record<string, { extension: string; signature: number[] }> = {
  "image/jpeg": { extension: ".jpg", signature: [0xff, 0xd8, 0xff] },
  "image/png": { extension: ".png", signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  "image/webp": { extension: ".webp", signature: [0x52, 0x49, 0x46, 0x46] },
};

const profilePhotoUpload = multer({
  storage: multer.diskStorage({
    destination: profileUploadDir,
    filename: (_req, file, callback) => {
      callback(null, `${crypto.randomUUID()}${profilePhotoTypes[file.mimetype]?.extension || ".tmp"}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!profilePhotoTypes[file.mimetype]) {
      callback(new Error("Profile photos must be JPG, PNG, or WebP images"));
      return;
    }
    callback(null, true);
  },
});

function publicUserFields() {
  return `u.id, u.name, u.email, u.role, u.college_role, u.semester,
          u.employee_id, u.designation, u.phone_number, u.bio, u.profile_photo,
          u.sms_notifications, u.email_notifications, u.push_notifications,
          u.task_assignment_notifications, u.task_deadline_notifications,
          u.event_reminder_notifications, u.task_status_notifications, u.created_at,
          u.email_verified, d.name AS department`;
}

function validProfileEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const email = value.trim();
  const [localPart, domain] = email.split("@");
  return email.length <= 254 &&
    /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,63}$/i.test(email) &&
    Boolean(localPart) &&
    localPart.length <= 64 &&
    !localPart.includes("..") &&
    Boolean(domain) &&
    domain.split(".").every((part) => part.length <= 63);
}

function validProfilePhone(value: string): boolean {
  return /^\+91[789]\d{9}$/.test(value);
}

function hasUnsupportedControlCharacters(value: string): boolean {
  return value.split("").some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
  });
}

async function removeProfilePhoto(photoUrl: string | null | undefined) {
  if (!photoUrl?.startsWith("/uploads/profile/")) return;
  const filename = path.basename(photoUrl);
  if (filename !== photoUrl.slice("/uploads/profile/".length)) return;
  try {
    await fs.promises.unlink(path.join(profileUploadDir, filename));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("Unable to remove previous profile photo:", error);
    }
  }
}

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
    const userResult = await pool.query("SELECT id, name, email, password_setup_required FROM users WHERE LOWER(email) = $1", [email]);
    if (userResult.rows.length) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      await pool.query("UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL", [userResult.rows[0].id]);
      const expiresIn = userResult.rows[0].password_setup_required ? "24 hours" : "30 minutes";
      await pool.query("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + $3::interval)", [userResult.rows[0].id, tokenHash, expiresIn]);
      try {
        if (userResult.rows[0].password_setup_required) {
          await sendAccountSetupEmail(userResult.rows[0], rawToken);
        } else {
          await sendPasswordResetEmail(userResult.rows[0], rawToken);
        }
      } catch (error) { console.error("Password reset email failed:", error instanceof Error ? error.message : "Unknown email error"); }
    }
    return res.json({ message: generic });
  } catch (error) { console.error("Forgot password error:", error); return res.json({ message: generic }); }
});

router.post("/reset-password", async (req: any, res: Response) => {
  try {
    const { token, password, confirmPassword } = req.body;
    const passwordIssue = passwordError(password);
    if (typeof token !== "string" || !token || passwordIssue || password !== confirmPassword) return res.status(400).json({ error: passwordIssue || "Passwords must match" });
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const passwordHash = await bcrypt.hash(password, 12);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE password_reset_tokens
         SET used_at = NOW()
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
         RETURNING user_id`,
        [hash]
      );
      if (!result.rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "This reset link is invalid or expired." });
      }
      const userId = result.rows[0].user_id;
      await client.query(
        `UPDATE users
         SET password_hash = $1,
             password_setup_required = false,
             email_verified = CASE WHEN password_setup_required THEN true ELSE email_verified END
         WHERE id = $2`,
        [passwordHash, userId]
      );
      await client.query("UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL", [userId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    res.json({ message: "Password saved successfully. You can now sign in." });
  } catch (error) { console.error("Reset password error:", error); res.status(500).json({ error: "Unable to reset password" }); }
});

router.post("/register", (_req, res: Response) => {
  res.status(403).json({ error: "Accounts can only be created by a Super Admin" });
});

// POST /api/auth/login
router.post("/login", async (req, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!isEmail(email) || typeof password !== "string" || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    const result = await pool.query(
      `SELECT u.*, d.name as department
       FROM users u
       LEFT JOIN departments d ON u.department_id = d.id
       WHERE u.email = $1`,
      [email.trim().toLowerCase()]
    );
    if (result.rows.length === 0) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const user = result.rows[0];
    if (!user.is_active) {
      res.status(403).json({ error: "This account has been deactivated. Contact your Super Admin." });
      return;
    }
    if (user.password_setup_required) {
      res.status(403).json({ error: "Set up your password using the link sent to your email before signing in." });
      return;
    }
    const settings = await pool.query("SELECT maintenance_mode FROM system_settings WHERE id = 1");
    if (settings.rows[0]?.maintenance_mode && user.role !== "super_admin") {
      res.status(503).json({ error: "The platform is temporarily unavailable for maintenance." });
      return;
    }
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
      `SELECT ${publicUserFields()}
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

router.get("/me/stats", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const taskScope = req.userRole === "super_admin"
      ? ""
      : req.userRole === "dept_head"
        ? "AND t.assigned_dept_id = (SELECT department_id FROM users WHERE id = $1)"
        : "AND (t.assigned_to_id = $1 OR t.assigned_dept_id = (SELECT department_id FROM users WHERE id = $1))";
    const taskValues = req.userRole === "super_admin" ? [] : [req.userId];
    const [taskResult, eventResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::integer AS total,
                COUNT(*) FILTER (WHERE t.status = 'Completed')::integer AS completed,
                COUNT(*) FILTER (WHERE t.status NOT IN ('Completed', 'Rejected', 'Cancelled'))::integer AS pending
         FROM tasks t WHERE t.deleted_at IS NULL ${taskScope}`,
        taskValues
      ),
      pool.query(
        `SELECT COUNT(*)::integer AS total
         FROM events
         WHERE deleted_at IS NULL AND start_date >= NOW() AND status NOT IN ('Cancelled', 'Completed')`
      ),
    ]);
    res.json({
      total_tasks: Number(taskResult.rows[0]?.total || 0),
      completed_tasks: Number(taskResult.rows[0]?.completed || 0),
      pending_tasks: Number(taskResult.rows[0]?.pending || 0),
      upcoming_events: Number(eventResult.rows[0]?.total || 0),
    });
  } catch (error) {
    console.error("Profile statistics error:", error);
    res.status(500).json({ error: "Unable to load profile statistics" });
  }
});

// PUT /api/auth/me
router.put("/me", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const {
      name,
      email,
      department,
      semester,
      employee_id,
      designation,
      phone_number,
      bio,
      sms_notifications,
      email_notifications,
      push_notifications,
      task_assignment_notifications,
      task_deadline_notifications,
      event_reminder_notifications,
      task_status_notifications,
      current_password,
      new_password,
    } = req.body;

    if (department !== undefined && req.userRole !== "super_admin") {
      res.status(403).json({ error: "Department transfers must be performed by a Super Admin" });
      return;
    }

    if ((new_password !== undefined || current_password !== undefined) && (typeof new_password !== "string" || !new_password || typeof current_password !== "string" || !current_password)) {
      return res.status(400).json({ error: "Current and new passwords are required" });
    }
    if (new_password !== undefined) {
      const passwordIssue = passwordError(new_password);
      if (passwordIssue) {
        return res.status(400).json({ error: passwordIssue });
      }
      const userResult = await pool.query(
        "SELECT password_hash FROM users WHERE id = $1",
        [req.userId]
      );
      if (!userResult.rows.length) return res.status(404).json({ error: "User not found" });
      const valid = await bcrypt.compare(
        current_password,
        userResult.rows[0].password_hash
      );
      if (!valid) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }
      const hash = await bcrypt.hash(new_password, 12);
      await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, req.userId]);
    }

    const queryParts: string[] = [];
    const params: unknown[] = [];
    let emailChanged = false;
    const addField = (column: string, value: unknown) => {
      params.push(value);
      queryParts.push(`${column} = $${params.length}`);
    };

    if (name !== undefined) {
      if (!isNonEmptyString(name) || [...name.trim()].length < 2 || [...name.trim()].length > 100 || !/^[\p{L}\p{M}]+(?:[ '\u2019.-][\p{L}\p{M}]+)*$/u.test(name.trim())) {
        return res.status(400).json({ error: "Enter a name between 2 and 100 characters using letters, spaces, apostrophes, periods, or hyphens." });
      }
      addField("name", name.trim());
    }
    if (email !== undefined) {
      if (!validProfileEmail(email)) return res.status(400).json({ error: "Enter a valid email address" });
      const normalizedEmail = email.trim().toLowerCase();
      const duplicate = await pool.query("SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2", [normalizedEmail, req.userId]);
      if (duplicate.rows.length) return res.status(409).json({ error: "That email address is already in use" });
      const current = await pool.query("SELECT email FROM users WHERE id = $1", [req.userId]);
      emailChanged = current.rows[0]?.email.toLowerCase() !== normalizedEmail;
      if (emailChanged) {
        addField("email", normalizedEmail);
        addField("email_verified", false);
      }
    }

    if (department !== undefined) {
      if (department === null || department === "") {
        addField("department_id", null);
      } else {
        if (typeof department !== "string" || !department.trim() || department.trim().length > 100) return res.status(400).json({ error: "Department is invalid" });
        const deptRes = await pool.query("SELECT id FROM departments WHERE name = $1", [department.trim()]);
        if (!deptRes.rows.length) return res.status(400).json({ error: "Department was not found" });
        addField("department_id", deptRes.rows[0].id);
      }
    }

    if (semester !== undefined) {
      if (semester !== null && (typeof semester !== "string" || semester.length > 20)) return res.status(400).json({ error: "Semester must be 20 characters or fewer" });
      addField("semester", semester);
    }
    if (employee_id !== undefined) {
      if (employee_id !== null && employee_id !== "" && (typeof employee_id !== "string" || employee_id.trim().length > 40)) return res.status(400).json({ error: "Employee ID must be 40 characters or fewer" });
      const normalizedId = typeof employee_id === "string" ? employee_id.trim().toUpperCase() || null : null;
      if (normalizedId && !/^[\p{L}\p{N}][\p{L}\p{N}._/-]*$/u.test(normalizedId)) {
        return res.status(400).json({ error: "Employee ID may contain letters, numbers, periods, underscores, hyphens, or slashes." });
      }
      if (normalizedId) {
        const duplicate = await pool.query("SELECT id FROM users WHERE LOWER(employee_id) = LOWER($1) AND id <> $2", [normalizedId, req.userId]);
        if (duplicate.rows.length) return res.status(409).json({ error: "That employee ID is already in use" });
      }
      addField("employee_id", normalizedId);
    }
    if (designation !== undefined) {
      if (designation !== null && typeof designation !== "string") return res.status(400).json({ error: "Designation must be text" });
      const value = typeof designation === "string" ? designation.trim() : "";
      if (value.length > 120) return res.status(400).json({ error: "Designation must be 120 characters or fewer" });
      if (value && !/^[\p{L}\p{M}\p{N}](?:[\p{L}\p{M}\p{N} &.,'’()/-]*[\p{L}\p{M}\p{N}])?$/u.test(value)) {
        return res.status(400).json({ error: "Designation contains unsupported characters" });
      }
      addField("designation", value || null);
    }
    if (phone_number !== undefined) {
      if (phone_number !== null && typeof phone_number !== "string") return res.status(400).json({ error: "Phone number must be text" });
      const value = typeof phone_number === "string" ? phone_number.trim() : "";
      if (value && !validProfilePhone(value)) return res.status(400).json({ error: "Enter a valid Indian mobile number: +91 followed by 10 digits starting with 7, 8, or 9." });
      addField("phone_number", value || null);
    }
    if (bio !== undefined) {
      if (bio !== null && typeof bio !== "string") return res.status(400).json({ error: "About me must be text" });
      const value = typeof bio === "string" ? bio.trim() : "";
      if (value.length > 500) return res.status(400).json({ error: "About me must be 500 characters or fewer" });
      if (hasUnsupportedControlCharacters(value)) return res.status(400).json({ error: "About me contains unsupported control characters" });
      addField("bio", value || null);
    }

    const booleanFields: Array<[string, unknown]> = [
      ["sms_notifications", sms_notifications],
      ["email_notifications", email_notifications],
      ["push_notifications", push_notifications],
      ["task_assignment_notifications", task_assignment_notifications],
      ["task_deadline_notifications", task_deadline_notifications],
      ["event_reminder_notifications", event_reminder_notifications],
      ["task_status_notifications", task_status_notifications],
    ];
    for (const [field, value] of booleanFields) {
      if (value === undefined) continue;
      if (typeof value !== "boolean") return res.status(400).json({ error: `${field} must be boolean` });
      addField(field, value);
    }

    if (queryParts.length) {
      params.push(req.userId);
      await pool.query(`UPDATE users SET ${queryParts.join(", ")} WHERE id = $${params.length}`, params);
    }
    if (emailChanged) {
      try {
        const userResult = await pool.query("SELECT id, name, email FROM users WHERE id = $1", [req.userId]);
        await issueVerification(userResult.rows[0]);
      } catch (error) {
        console.error("Profile email verification delivery error:", error);
        return res.status(502).json({ error: "Your email was updated, but the verification email could not be sent. Use the resend verification option to try again." });
      }
    }
    const userRes = await pool.query(
      `SELECT ${publicUserFields()} FROM users u
       LEFT JOIN departments d ON u.department_id = d.id
       WHERE u.id = $1`,
      [req.userId]
    );
    res.json({ ...userRes.rows[0], email_verification_required: emailChanged });
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put(
  "/me/photo",
  authenticate,
  (req: Request, res: Response, next: NextFunction) => {
    profilePhotoUpload.single("photo")(req, res, (error: unknown) => {
      if (!error) return next();
      const isSizeError = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE";
      res.status(isSizeError ? 413 : 400).json({
        error: isSizeError ? "Profile photos must be 5 MB or smaller" : error instanceof Error ? error.message : "Unable to upload profile photo",
      });
    });
  },
  async (req: AuthRequest, res: Response) => {
    if (!req.file) return res.status(400).json({ error: "Select a JPG, PNG, or WebP image" });
    try {
      const fileBytes = await fs.promises.readFile(req.file.path);
      const imageType = profilePhotoTypes[req.file.mimetype];
      const signatureMatches = imageType.signature.every((byte, index) => fileBytes[index] === byte);
      const webpHeaderMatches = req.file.mimetype !== "image/webp" || fileBytes.toString("ascii", 8, 12) === "WEBP";
      if (!signatureMatches || !webpHeaderMatches) {
        await fs.promises.unlink(req.file.path);
        return res.status(400).json({ error: "The selected file is not a valid image of the declared type" });
      }
      const photoUrl = `/uploads/profile/${req.file.filename}`;
      const previous = await pool.query("SELECT profile_photo FROM users WHERE id = $1", [req.userId]);
      if (!previous.rows.length) {
        await fs.promises.unlink(req.file.path);
        return res.status(404).json({ error: "User not found" });
      }
      await pool.query("UPDATE users SET profile_photo = $1 WHERE id = $2", [photoUrl, req.userId]);
      await removeProfilePhoto(previous.rows[0].profile_photo);
      res.json({ profile_photo: photoUrl });
    } catch (error) {
      await fs.promises.unlink(req.file.path).catch(() => undefined);
      console.error("Profile photo upload error:", error);
      res.status(500).json({ error: "Unable to save profile photo" });
    }
  }
);

router.delete("/me/photo", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const previous = await pool.query("SELECT profile_photo FROM users WHERE id = $1", [req.userId]);
    if (!previous.rows.length) return res.status(404).json({ error: "User not found" });
    await pool.query("UPDATE users SET profile_photo = NULL WHERE id = $1", [req.userId]);
    await removeProfilePhoto(previous.rows[0].profile_photo);
    res.json({ profile_photo: null });
  } catch (error) {
    console.error("Profile photo removal error:", error);
    res.status(500).json({ error: "Unable to remove profile photo" });
  }
});

export default router;
