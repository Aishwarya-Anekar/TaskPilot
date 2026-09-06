import nodemailer from "nodemailer";
import dotenv from "dotenv";
import pool from "./db.js";
import { renderNotificationEmail, renderWelcomeEmail } from "./emailTemplates.js";

dotenv.config();

type EmailNotification = {
  userId: number;
  title: string;
  message: string;
  dedupeKey: string;
  entityType?: string;
  entityId?: number;
};

const enabled = process.env.EMAIL_NOTIFICATIONS_ENABLED === "true";
const appUrl = (process.env.APP_URL || "http://localhost:8080").replace(/\/$/, "");
let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!enabled) return null;
  if (!process.env.SMTP_HOST || !process.env.SMTP_PORT || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD || !process.env.EMAIL_FROM) {
    console.error("Email notifications enabled but SMTP configuration is incomplete");
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    });
  }
  return transporter;
}

function linkFor(entityType?: string, entityId?: number) {
  if (entityType === "task" && entityId) return `${appUrl}/track/${entityId}`;
  if (entityType === "announcement") return `${appUrl}/communication`;
  return `${appUrl}/track`;
}

export async function sendNotificationEmail(notification: EmailNotification) {
  const mailer = getTransporter();
  if (!mailer) return;
  const userResult = await pool.query("SELECT name, email, email_notifications FROM users WHERE id = $1", [notification.userId]);
  const user = userResult.rows[0];
  if (!user?.email || user.email_notifications === false) return;

  const claim = await pool.query(
    `INSERT INTO email_deliveries (user_id, dedupe_key, last_attempt_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id, dedupe_key) DO UPDATE SET last_attempt_at = NOW()
     WHERE email_deliveries.sent_at IS NULL
       AND (email_deliveries.last_attempt_at IS NULL OR email_deliveries.last_attempt_at < NOW() - INTERVAL '5 minutes')
     RETURNING id`,
    [notification.userId, notification.dedupeKey]
  );
  if (!claim.rows.length) return;

  try {
    let task;
    if (notification.entityType === "task" && notification.entityId) {
      const taskResult = await pool.query(
        `SELECT t.title, t.due_date, t.priority, t.status, e.title AS event_title
         FROM tasks t LEFT JOIN events e ON e.id = t.event_id WHERE t.id = $1`, [notification.entityId]
      );
      task = taskResult.rows[0];
    }
    await mailer.sendMail({
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: notification.title,
      html: renderNotificationEmail({ name: user.name, title: notification.title, message: notification.message, link: linkFor(notification.entityType, notification.entityId), task }),
    });
    await pool.query("UPDATE email_deliveries SET sent_at = NOW() WHERE id = $1", [claim.rows[0].id]);
  } catch (err) {
    await pool.query("UPDATE email_deliveries SET failed_at = NOW() WHERE id = $1", [claim.rows[0].id]).catch(() => undefined);
    console.error("Email notification failed:", err instanceof Error ? err.message : "Unknown email error");
  }
}

export async function sendWelcomeEmail(user: { id: number; name: string; email: string }) {
  const mailer = getTransporter();
  if (!mailer || !user.email) return;
  const claim = await pool.query(
    `INSERT INTO email_deliveries (user_id, dedupe_key, last_attempt_at) VALUES ($1, $2, NOW())
     ON CONFLICT (user_id, dedupe_key) DO NOTHING RETURNING id`, [user.id, `welcome:${user.id}`]
  );
  if (!claim.rows.length) return;
  try {
    await mailer.sendMail({ from: process.env.EMAIL_FROM, to: user.email, subject: "Welcome to TaskPilot", html: renderWelcomeEmail(user.name, `${appUrl}/`) });
    await pool.query("UPDATE email_deliveries SET sent_at = NOW() WHERE id = $1", [claim.rows[0].id]);
  } catch (err) {
    await pool.query("UPDATE email_deliveries SET failed_at = NOW() WHERE id = $1", [claim.rows[0].id]).catch(() => undefined);
    console.error("Welcome email failed:", err instanceof Error ? err.message : "Unknown email error");
  }
}

export async function sendPasswordResetEmail(user: { name: string; email: string }, token: string) {
  const mailer = getTransporter();
  if (!mailer) return;
  const link = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  await mailer.sendMail({
    from: process.env.EMAIL_FROM, to: user.email, subject: "Reset your TaskPilot password",
    html: `<p>Hello ${user.name.replace(/[<>]/g, "")},</p><p>Use the button below to reset your TaskPilot password. This link expires in 30 minutes.</p><p><a href="${link}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
  });
}

export async function sendVerificationEmail(user: { name: string; email: string }, token: string) {
  const mailer = getTransporter();
  if (!mailer) return;
  const link = `${appUrl}/verify-email?token=${encodeURIComponent(token)}`;
  await mailer.sendMail({
    from: process.env.EMAIL_FROM, to: user.email, subject: "Verify your TaskPilot email",
    html: `<p>Hello ${user.name.replace(/[<>]/g, "")},</p><p>Verify your email address to activate your TaskPilot account.</p><p><a href="${link}">Verify email address</a></p><p>This link expires in 24 hours.</p>`,
  });
}