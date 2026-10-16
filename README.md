# TaskPilot 🚀📋

TaskPilot is a digital framework for team collaboration and workflow orchestration. It serves as a centralized organization operations workspace allowing admins, department heads, and employees to plan, delegate, execute, and monitor activities.

---

## 🛠️ Tech Stack

### Frontend
- **Framework:** React 18 with Vite
- **Language:** TypeScript
- **Styling:** Tailwind CSS & Shadcn UI (Radix Primitives)
- **Animations:** Framer Motion (premium SaaS transitions)
- **Data Fetching:** TanStack React Query
- **Charts:** Recharts

### Backend
- **Framework:** Express (Node.js)
- **Language:** TypeScript (`tsx` watcher)
- **Database client:** `pg` (node-postgres)
- **File Uploads:** Multer

### Database
- **Database:** PostgreSQL (equipped with automated schema creation & seeding on startup)

---

## ✨ Features

- **JWT Auth & Authorization:** Role-based access control supporting four roles: `super_admin`, `admin`, `dept_head`, and `employee`.
- **Role-based Dashboards:**
  - **Super Admin:** Configures system-wide toggles, logs system security audits, and registers administrators.
  - **Admin:** Creates events, assigns tasks, schedules deadlines, registers department profiles, and books organizational resources.
  - **Department Head:** Breaks down assigned events into task checklists, manages subtasks, and reviews deliverables before marking completed.
  - **Employee:** Executes assigned tasks, checks off subtasks, uploads proof files, and participates in task discussions.
- **Announcement Bulletin:** Allows broadcasting updates targeting specific departments or public bulletins.
- **QR Attendance:** Generates event QR codes for admins and allows simulated checkins for staff.
- **MoM & Feedback:** Minutes of Meetings notes log event decisions, and feedback forms record review scores.

---

# 🚀 Getting Started

## Prerequisites

Make sure you have the following installed:

* Node.js
* npm
* PostgreSQL

---

# 🗄️ Database Setup

Create a PostgreSQL database for TaskPilot.

Example:

```text
taskpilot
```

Configure the database connection inside the backend environment file.

```env
DATABASE_URL=postgresql://YOUR_USERNAME:YOUR_PASSWORD@localhost:5432/taskpilot
```

Replace:

* `YOUR_USERNAME`
* `YOUR_PASSWORD`
* Database name

according to your PostgreSQL configuration.

> The application uses safe database initialization. Existing tables and data are preserved during normal application startup.

---

# ⚙️ Environment Configuration

Create a `.env` file inside the `server/` directory.

Example:

```env
DATABASE_URL=postgresql://<user>:<password>@localhost:5432/campus_connect
JWT_SECRET=campus-connect-jwt-secret-2024
PORT=5000

APP_URL=http://localhost:8080

EMAIL_NOTIFICATIONS_ENABLED=false

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-username
SMTP_PASSWORD=your-smtp-password
EMAIL_FROM=TaskPilot <no-reply@example.com>
```

Set `EMAIL_NOTIFICATIONS_ENABLED=true` only after replacing the SMTP example values with credentials from a development mail provider such as Mailtrap, Ethereal, or a Gmail app password. Never commit `server/.env`; it is ignored by Git. Email delivery is recorded in the `email_deliveries` table and deduplicated per user and notification. Users can disable email notifications through their profile preference.

---

### Installation & Run Instructions

#### 1. Setup Backend Server
Open a terminal, navigate to the `server/` directory, and install dependencies:
```bash
cd server
```

Install dependencies:

```bash
npm install
```

Start the backend server:

```bash
npm run dev
```
*On first startup, the server will check if the database `campus_connect` exists on your PostgreSQL server. If not, it will automatically create the database, build all schema tables, and seed initial support departments and administrators.*

#### 2. Setup Frontend Client
Open a second terminal in the project's root folder, install dependencies:
```bash
npm install
```

Start the frontend:

```bash
npm run dev
```

The frontend will run at:

```text
http://localhost:8080
```

---

# 📧 Email Notifications

TaskPilot supports email notifications for important activities.

Examples include:

* Task assignments
* Task updates
* Deadline reminders
* Password reset
* Email verification

To enable email notifications:

```env
EMAIL_NOTIFICATIONS_ENABLED=true
```

For Gmail SMTP, configure valid Gmail credentials and a Google App Password.

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false

SMTP_USER=yourgmail@gmail.com
SMTP_PASSWORD=your_google_app_password

EMAIL_FROM="TaskPilot <yourgmail@gmail.com>"
```

⚠️ Never expose these credentials publicly.

---

# 🧪 Testing

Recommended manual testing scenarios:

* User login and authentication
* Role-based access control
* Create and manage users
* Create departments
* Create events
* Assign tasks
* Update task progress
* Complete and review tasks
* Upload task proofs
* Test notifications
* Test password reset
* Test email verification
* Test deadline reminders
* Test auto-escalation
* Test resource booking conflicts
* Test visitor check-in/check-out validation
* Generate reports
* Export PDF and Excel reports
* Restart backend and verify database persistence

---

# 📸 Screenshots

Add screenshots of the major TaskPilot modules to make the repository more visually informative.

Recommended screenshots:

## 🔐 Login

Add:

```text
docs/screenshots/login.png
```

## 📊 Admin Dashboard

Add:

```text
docs/screenshots/admin-dashboard.png
```

## 📋 Task Management

Add:

```text
docs/screenshots/task-management.png
```

## 📅 Calendar

Add:

```text
docs/screenshots/calendar.png
```

## 📈 Reports

Add:

```text
docs/screenshots/reports.png
```

## 🧑 Visitor Management

Add:

```text
docs/screenshots/visitor-management.png
```

## 🔔 Notifications

Add:

```text
docs/screenshots/notifications.png
```

After adding screenshots to the repository, reference them in Markdown like:

```markdown
![Admin Dashboard](docs/screenshots/admin-dashboard.png)
```

---

# 📁 Project Structure

```text
TaskPilot/
│
├── src/                        # Frontend source code
├── public/                     # Static frontend assets
│
├── server/
│   ├── src/                    # Backend source code
│   ├── uploads/                # Uploaded files
│   └── package.json
│
├── package.json
├── README.md
└── .gitignore
```

---

# 🎯 Project Domain

**Domain:** Full-Stack Web Application / Workflow Management / Organizational Collaboration

TaskPilot combines multiple organizational management domains:

* Workflow Management
* Task Management
* Event Management
* Team Collaboration
* Resource Management
* Visitor Management
* Organizational Operations

---

# 🔮 Future Enhancements

Potential future improvements include:

* Mobile application
* Real-time communication using WebSockets
* Advanced analytics
* Multi-organization support
* Cloud deployment
* External calendar integration
* Advanced notification preferences
----------------------------------------------------------------

## 🔐 Initial Account Provisioning

There are no public/default production login credentials. Bootstrap the first Super Admin using the protected deployment environment variables above, then remove them and use the Super Admin dashboard to register users. New users receive a one-time password setup link; configure a mail provider for delivery. If email delivery is unavailable during local development, the Super Admin dashboard provides the setup link to share securely.
