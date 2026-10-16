type TemplateData = {
  name: string;
  title: string;
  message: string;
  link: string;
  task?: { title: string; due_date?: string; priority?: string; status?: string; event_title?: string };
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
}

export function renderNotificationEmail(data: TemplateData) {
  const taskDetails = data.task ? `
    <p><strong>Task:</strong> ${escapeHtml(data.task.title)}</p>
    ${data.task.event_title ? `<p><strong>Event:</strong> ${escapeHtml(data.task.event_title)}</p>` : ""}
    ${data.task.due_date ? `<p><strong>Deadline:</strong> ${escapeHtml(new Date(data.task.due_date).toLocaleString())}</p>` : ""}
    ${data.task.priority ? `<p><strong>Priority:</strong> ${escapeHtml(data.task.priority)}</p>` : ""}
    ${data.task.status ? `<p><strong>Status:</strong> ${escapeHtml(data.task.status)}</p>` : ""}` : "";
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5">
    <h2>${escapeHtml(data.title)}</h2><p>Hello ${escapeHtml(data.name)},</p>
    <p>${escapeHtml(data.message)}</p>${taskDetails}
    <p><a href="${escapeHtml(data.link)}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:white;text-decoration:none;border-radius:6px">Open TaskPilot</a></p>
    <p style="color:#6b7280;font-size:12px">This is an automated TaskPilot notification.</p>
  </body></html>`;
}

export function renderWelcomeEmail(name: string, link: string) {
  return renderNotificationEmail({
    name,
    title: "Welcome to TaskPilot",
    message: "Your TaskPilot account has been created successfully. You can now sign in and manage your work.",
    link,
  });
}

export interface VisitorInvitationData {
  visitorName: string;
  organization?: string | null;
  purpose: string;
  visitDateTime: string;
  hostName: string;
  eventName?: string | null;
  location?: string | null;
  passCode: string;
  collegeName: string;
  supportEmail?: string | null;
}

export function renderVisitorInvitationEmail(data: VisitorInvitationData) {
  const detailRows = [
    ["Visitor", data.visitorName],
    ...(data.organization ? [["Organization", data.organization]] : []),
    ["Purpose", data.purpose],
    ["Visit date and time", data.visitDateTime],
    ["Host", data.hostName],
    ...(data.eventName ? [["Event", data.eventName]] : []),
    ...(data.location ? [["Location", data.location]] : []),
    ["Visitor pass", data.passCode],
  ];
  const text = [
    `Dear ${data.visitorName},`,
    "",
    `Your visit to ${data.collegeName} has been scheduled.`,
    "",
    "VISIT DETAILS",
    ...detailRows.map(([label, value]) => `${label}: ${value}`),
    "",
    "Please present this visitor pass to authorized college staff at the entrance.",
    ...(data.supportEmail ? [`For corrections, contact ${data.supportEmail}.`] : []),
    "",
    `Regards, ${data.collegeName}`,
    "Visitor Management System | TaskPilot",
  ].join("\n");
  const rows = detailRows.map(([label, value]) => `<tr><th align="left" style="padding:9px 12px;color:#475569;border-bottom:1px solid #e2e8f0">${escapeHtml(label)}</th><td style="padding:9px 12px;color:#0f172a;border-bottom:1px solid #e2e8f0">${escapeHtml(value)}</td></tr>`).join("");
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a;line-height:1.55"><div style="max-width:620px;margin:24px auto;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden"><div style="padding:22px 26px;background:#10243a;color:#fff"><p style="margin:0;font-size:12px;letter-spacing:1px;text-transform:uppercase">TaskPilot Visitor Management</p><h1 style="margin:8px 0 0;font-size:21px">Visitor Invitation</h1></div><div style="padding:24px 26px"><p>Dear ${escapeHtml(data.visitorName)},</p><p>Your visit to <strong>${escapeHtml(data.collegeName)}</strong> has been scheduled.</p><h2 style="margin:22px 0 8px;font-size:14px">Visit details</h2><table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px">${rows}</table><p style="margin-top:22px">Please present this visitor pass to authorized college staff at the entrance.</p>${data.supportEmail ? `<p>If your visit details need correction, contact <a href="mailto:${escapeHtml(data.supportEmail)}">${escapeHtml(data.supportEmail)}</a>.</p>` : ""}<p style="margin-top:24px">Regards,<br><strong>${escapeHtml(data.collegeName)}</strong><br><span style="color:#64748b;font-size:12px">Visitor Management System | TaskPilot</span></p></div></div></body></html>`;
  return { subject: `Visitor Invitation — ${data.collegeName} | ${data.visitDateTime}`, html, text };
}