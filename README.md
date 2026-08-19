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

## 🚀 Getting Started

### Prerequisites
- Node.js installed
- PostgreSQL server running locally

### Environment Configuration

Create a `.env` file inside the `server/` directory:
```env
DATABASE_URL=postgresql://<user>:<password>@localhost:5432/campus_connect
JWT_SECRET=campus-connect-jwt-secret-2024
PORT=5001
```

> **Note:** The server is configured to use port `5001` to prevent conflicts with local Python/Flask installations using port `5000`.

---

### Installation & Run Instructions

#### 1. Setup Backend Server
Open a terminal, navigate to the `server/` directory, and install dependencies:
```bash
cd server
npm install
```
Start the backend development server:
```bash
npm run dev
```
*On first startup, the server will check if the database `campus_connect` exists on your PostgreSQL server. If not, it will automatically create the database, build all schema tables, and seed initial support departments and administrators.*

#### 2. Setup Frontend Client
Open a second terminal in the project's root folder, install dependencies:
```bash
npm install
```
Start the frontend development server:
```bash
npm run dev
```
The client will run on **http://localhost:8080**.

---

## 🔑 Default Login Credentials
Once the database has seeded, you can sign in using:

### Super Administrator
- **Email:** `superadmin@taskpilot.com`
- **Password:** `admin123`

### Administrator
- **Email:** `admin@taskpilot.com`
- **Password:** `admin123`

### Department Head
- **Email:** `depthead@taskpilot.com`
- **Password:** `admin123`

### Employee
- **Email:** `employee@taskpilot.com`
- **Password:** `admin123`
