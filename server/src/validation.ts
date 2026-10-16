export const EVENT_CATEGORIES = [
  "Department Meeting",
  "Internal Examination",
  "University Examination",
  "College Festival or Technical Event",
  "Faculty Training",
  "Laboratory Inspection",
  "Accreditation Documentation",
  "Academic Activity",
  "Administrative Work",
  "Other",
] as const;

export const EVENT_STATUSES = ["Draft", "Active", "Completed", "Cancelled", "Pending Approval", "Approved", "Rejected"] as const;
export const TASK_PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
export const TASK_CATEGORIES = [
  "Academic Work",
  "Examination",
  "Documentation",
  "Meeting Preparation",
  "Event Preparation",
  "Laboratory Maintenance",
  "Administrative Work",
  "Student Activity",
  "Other",
] as const;
export const TASK_STATUSES = [
  "Pending",
  "In Progress",
  "Under Review",
  "Submitted for Review",
  "Completed",
  "Approved",
  "Rework Required",
  "Rejected",
  "Cancelled",
] as const;
export const APPROVAL_STATUSES = ["Not Required", "Pending Approval", "Approved", "Rejected"] as const;
export const USER_ROLES = ["super_admin", "dept_head", "employee"] as const;

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parsePositiveId(value: unknown): number | null {
  const id = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function validateDateRange(start: unknown, end: unknown, required = true): string | null {
  if (!start && !end && !required) return null;
  if (start == null || end == null || start === "" || end === "") return "Both start and end dates are required";
  const startTime = parseTimestamp(start);
  const endTime = parseTimestamp(end);
  if (startTime === null || endTime === null) return "Start and end dates must be valid timestamps";
  if (endTime < startTime) return "End date/time cannot be earlier than start date/time";
  return null;
}

export function isEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function passwordError(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/[0-9]/.test(value) || !/[^A-Za-z0-9]/.test(value)) {
    return "Password must include uppercase, lowercase, number, and special character";
  }
  return null;
}

export function isOneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === "string" && values.includes(value as T[number]);
}

export function validationError(res: { status: (code: number) => { json: (body: unknown) => unknown } }, message: string) {
  return res.status(400).json({ error: message });
}
