import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import pool from "../db.js";

export interface AuthRequest extends Request {
  userId?: number;
  userRole?: string;
}

export function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "No token provided" });
    return;
  }
  const token = header.split(" ")[1];
  let payload: { userId: number };
  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "fallback-secret"
    );
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !Number.isInteger(decoded.userId) ||
      decoded.userId <= 0
    ) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }
    payload = { userId: decoded.userId };
  } catch {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  void pool.query(
    `SELECT u.role, u.is_active, s.maintenance_mode
     FROM users u CROSS JOIN system_settings s
     WHERE u.id = $1 AND s.id = 1`,
    [payload.userId]
  )
    .then((result) => {
      if (!result.rows.length) {
        res.status(401).json({ error: "Account no longer exists" });
        return;
      }
      if (!result.rows[0].is_active) {
        res.status(403).json({ error: "This account has been deactivated. Contact your Super Admin." });
        return;
      }
      req.userId = payload.userId;
      req.userRole = result.rows[0].role;
      if (result.rows[0].maintenance_mode && req.userRole !== "super_admin") {
        res.status(503).json({ error: "The platform is temporarily unavailable for maintenance." });
        return;
      }
      next();
    })
    .catch((error: unknown) => {
      console.error("Authentication account lookup error:", error);
      res.status(500).json({ error: "Unable to verify account" });
    });
}

export function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (req.userRole !== "super_admin") {
    res.status(403).json({ error: "Super Admin access required" });
    return;
  }
  next();
}
