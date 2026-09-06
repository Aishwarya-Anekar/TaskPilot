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