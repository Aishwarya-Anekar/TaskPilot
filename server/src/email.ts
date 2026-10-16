import nodemailer from "nodemailer";
import dotenv from "dotenv";
import pool from "./db.js";
import { renderNotificationEmail, renderVisitorInvitationEmail, renderWelcomeEmail, VisitorInvitationData } from "./emailTemplates.js";

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

type EmailFailure = Error & { code?: string; responseCode?: number; command?: string; response?: string };

function configurationProblem() {
  if (!enabled) return "EMAIL_NOTIFICATIONS_ENABLED is false";
  const required = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"] as const;
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) return `Missing settings: ${missing.join(", ")}`;
  const port = Number(process.env.SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return "SMTP_PORT must be an integer between 1 and 65535";
  return null;
}

function redactEmailDiagnostics(value: string) {
  let safe = value;
  for (const secret of [process.env.SMTP_PASSWORD, process.env.SMTP_USER, process.env.EMAIL_FROM]) {
    if (secret) safe = safe.split(secret).join("[REDACTED]");
  }
  return safe
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 300);
}

export function logEmailFailure(context: string, error: unknown) {
  const failure = error instanceof Error ? error as EmailFailure : null;
  console.error(`${context}: ${JSON.stringify({
    name: failure?.name || "UnknownError",
    code: failure?.code || null,
    responseCode: Number.isInteger(failure?.responseCode) ? failure?.responseCode : null,
    command: failure?.command ? redactEmailDiagnostics(failure.command) : null,
    response: failure?.response ? redactEmailDiagnostics(failure.response) : null,
    message: failure?.message ? redactEmailDiagnostics(failure.message) : null,
  })}`);
}

export function visitorEmailFailureMessage(error: unknown) {
  const failure = error instanceof Error ? error as EmailFailure : null;
  const code = failure?.code || "";
  const responseCode = failure?.responseCode || 0;
  if (code === "EMAIL_DISABLED") return "Visitor invitation email is disabled on the server.";
  if (code === "EMAIL_CONFIG") return "Visitor invitation email is not fully configured on the server.";
  if (code === "EAUTH" || responseCode === 535) return "The email provider rejected SMTP authentication. Check SMTP_USER and SMTP_PASSWORD; Gmail requires an App Password.";
  if (["ENOTFOUND", "ECONNECTION", "ETIMEDOUT", "ESOCKET", "ECONNREFUSED"].includes(code)) return "The email provider could not be reached. Check SMTP_HOST, SMTP_PORT, and TLS settings.";
  if (code === "EENVELOPE" || [550, 553, 554].includes(responseCode)) return "The email provider rejected the sender or visitor address. Check EMAIL_FROM and the visitor email.";
  return "The email provider did not accept the invitation. Check the server mail log and retry.";
}

function createConfigurationError(problem: string | null) {
  const error = new Error(problem || "SMTP transport is unavailable") as EmailFailure;
  error.code = !enabled ? "EMAIL_DISABLED" : "EMAIL_CONFIG";
  return error;
}

function getTransporter() {
  const problem = configurationProblem();
  if (problem) {
    console.error(`Email transport unavailable: ${problem}`);
    return null;
  }
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT);
    const secure = process.env.SMTP_SECURE === "true";
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure,
      requireTLS: port === 587 && !secure,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }
  return transporter;
}

export async function verifySmtpConnection() {
  const mailer = getTransporter();
  if (!mailer) throw createConfigurationError(configurationProblem());
  await mailer.verify();
  return { host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT), secure: process.env.SMTP_SECURE === "true" };
}

export async function sendSmtpTestEmail() {
  const mailer = getTransporter();
  if (!mailer) throw createConfigurationError(configurationProblem());
  const recipient = process.env.SMTP_USER;
  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw createConfigurationError("SMTP_USER must be a valid test mailbox address");
  const result = await mailer.sendMail({
    from: process.env.EMAIL_FROM,
    to: recipient,
    subject: `TaskPilot SMTP configuration test ${new Date().toISOString()}`,
    text: "This is a TaskPilot SMTP configuration test. No visitor information is included.",
    html: "<p>This is a TaskPilot SMTP configuration test.</p><p>No visitor information is included.</p>",
  });
  if (!result.accepted.some((address: string) => address.toLowerCase() === recipient.toLowerCase())) {
    const error = new Error("SMTP provider did not accept the configured test mailbox") as EmailFailure;
    error.code = "EENVELOPE";
    error.responseCode = 550;
    throw error;
  }
  return { accepted: true };
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

export async function sendVisitorInvitationEmail(to: string, data: VisitorInvitationData) {
  const mailer = getTransporter();
  if (!mailer) throw createConfigurationError(configurationProblem());
  const invitation = renderVisitorInvitationEmail(data);
  const result = await mailer.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: invitation.subject.replace(/[\r\n]/g, " "),
    text: invitation.text,
    html: invitation.html,
  });
  if (!result.accepted.some((address: string) => address.toLowerCase() === to.toLowerCase())) {
    const error = new Error("Email provider did not accept the visitor recipient") as EmailFailure;
    error.code = "EENVELOPE";
    error.response = result.response;
    throw error;
  }
  return { accepted: true };
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

export async function sendAccountSetupEmail(user: { name: string; email: string }, token: string) {
  const mailer = getTransporter();
  if (!mailer) return false;
  const link = `${appUrl}/reset-password?mode=setup&token=${encodeURIComponent(token)}`;
  const safeName = user.name.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
  await mailer.sendMail({
    from: process.env.EMAIL_FROM,
    to: user.email,
    subject: "Set up your TaskPilot account",
    html: `<p>Hello ${safeName},</p><p>A Super Admin created a TaskPilot account for you. Use the link below to choose your password and activate your account.</p><p><a href="${link}">Set your password</a></p><p>This link expires in 24 hours. If you were not expecting this account, you can ignore this email.</p>`,
  });
  return true;
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