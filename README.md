# 🚀 TaskPilot

### A Digital Framework for Team Collaboration and Workflow Orchestration

TaskPilot is a full-stack web-based platform designed to streamline organizational workflow, task management, event coordination, and team collaboration.

It provides a centralized workspace where administrators, department heads, and employees can plan activities, assign responsibilities, monitor progress, manage resources, collaborate with team members, and track organizational operations efficiently.

TaskPilot is designed to be adaptable for organizations such as:

* 🏫 Schools and Colleges
* 🏢 Corporate Organizations
* 🎓 Training Institutes
* 🤝 NGOs
* 🎉 Event Management Teams
* 🏥 Hospitals and Institutions

---

# 🏗️ Project Architecture

```text
┌─────────────────────┐
│   React Frontend    │
│ Vite + TypeScript   │
└──────────┬──────────┘
           │
           │ REST API / HTTP
           ▼
┌─────────────────────┐
│   Express Backend   │
│ Node.js + TypeScript│
└──────────┬──────────┘
           │
           │ SQL Queries
           ▼
┌─────────────────────┐
│ PostgreSQL Database │
└─────────────────────┘
```

---

# 🛠️ Tech Stack

## Frontend

* **Framework:** React 18 with Vite
* **Language:** TypeScript
* **Styling:** Tailwind CSS
* **UI Components:** Shadcn UI and Radix UI
* **Animations:** Framer Motion
* **Data Fetching:** TanStack React Query
* **Forms:** React Hook Form
* **Validation:** Zod
* **Charts:** Recharts
* **Report Generation:** jsPDF
* **Excel Export:** SheetJS

## Backend

* **Runtime:** Node.js
* **Framework:** Express.js
* **Language:** TypeScript
* **Authentication:** JWT
* **Password Security:** bcrypt
* **Database Client:** node-postgres (`pg`)
* **File Uploads:** Multer
* **Email Notifications:** Nodemailer

## Database

* **Database:** PostgreSQL
* **Schema Initialization:** Safe database initialization
* **Data Persistence:** Existing data is preserved during normal server restarts
* **Seed Data:** Default data is inserted safely without unnecessary duplication

---

# ✨ Features

## 🔐 Authentication and Authorization

* JWT-based authentication
* Role-Based Access Control (RBAC)
* Secure password hashing
* Forgot password functionality
* Password reset functionality
* Email verification
* Change password functionality
* Backend validation
* Protected routes
* Secure access based on user roles

---

## 👥 Role-Based User Management

TaskPilot supports four primary user roles:

### 👑 Super Admin

* Manage administrators
* Monitor system activity
* View security and activity logs
* Manage system-level settings
* Monitor organizational operations

### 🛠️ Admin

* Manage users and employees
* Manage departments
* Create and manage events
* Create and assign tasks
* Monitor organizational progress
* Manage resources
* Create announcements
* Generate reports

### 👨‍💼 Department Head

* Monitor department tasks
* Manage subtasks and checklists
* Review task completion
* Approve or reject deliverables
* Monitor department progress

### 👨‍💻 Employee

* View assigned tasks
* Update task progress
* Complete subtasks and checklists
* Upload task completion proofs
* Participate in task discussions
* View notifications and deadlines

---

# 📅 Event Management

TaskPilot supports the planning and management of organizational events such as:

* Independence Day
* Republic Day
* Annual Gatherings
* College Festivals
* Workshops
* Seminars
* Hackathons
* Sports Events
* Placement Drives

### Features

* Create and manage events
* Set event dates and schedules
* Assign event coordinators
* Track event status
* Create event-related tasks
* Event templates
* Recurring events
* Meeting notes
* Event feedback
* QR attendance

---

# 📋 Task Management

The Task Management module helps organizations efficiently assign and monitor responsibilities.

### Features

* Create tasks
* Assign tasks to users
* Assign tasks to departments
* Set deadlines
* Set task priorities
* Track task progress
* Update task status
* Create subtasks
* Create checklists
* Task-specific discussions
* Upload completion proofs
* Task review and approval workflow

### Task Status Workflow

```text
Not Started
In Progress
Under Review
Completed
Rejected
```

### Task Priority

```text
High
Medium
Low
```

---

# 📊 Dashboard and Analytics

TaskPilot provides role-based dashboards for monitoring organizational activities.

### Dashboard Features

* Total tasks
* Pending tasks
* Completed tasks
* Overdue tasks
* Upcoming deadlines
* Upcoming events
* Department-wise progress
* Task completion statistics
* Performance analytics
* Charts and reports

---

# 🔔 Notification System

The system provides notifications for important organizational activities.

### Notifications Include

* New task assignments
* Task updates
* Task completion
* Task approval or rejection
* Upcoming deadlines
* Overdue tasks
* Event reminders
* Important announcements

### Supported Channels

* In-app notifications
* Email notifications

Users can manage notification preferences through their profile settings.

---

# ⏰ Deadline Reminders and Auto-Escalation

TaskPilot helps organizations prevent missed deadlines.

### Features

* Deadline reminders
* Overdue task detection
* Automatic escalation
* Administrative notifications
* Escalation tracking

---

# 📆 Calendar Management

The centralized calendar displays important organizational schedules.

### Calendar Includes

* Events
* Task deadlines
* Upcoming activities
* Important organizational dates

---

# 💬 Collaboration and Communication

TaskPilot improves communication between team members.

### Features

* Task-specific comments
* Task discussions
* Announcements
* Meeting notes
* Organizational communication
* Activity tracking

---

# 📁 File and Proof Management

Users can upload files related to tasks and organizational activities.

Supported file types may include:

* Images
* PDF documents
* Word documents
* Excel files
* Task completion proofs

---

# 🏢 Department Management

Administrators can create and manage departments.

Example departments:

* Administration
* Information Technology
* Sports
* Cultural
* Accounts
* Library
* Training

---

# 🪑 Resource Management and Booking

Organizations can manage shared resources such as:

* Projectors
* Meeting rooms
* Seminar halls
* Laboratories
* Speakers
* Vehicles
* Equipment

### Resource Booking Features

* Add and manage resources
* Check resource availability
* Create bookings
* Track booking status
* Prevent overlapping bookings
* Validate booking start and end times

The system prevents the same resource from being booked for overlapping time periods.

---

# 🧑‍🤝‍🧑 Visitor Management

TaskPilot provides visitor tracking functionality.

### Features

* Register visitors
* Store visitor details
* Track check-in time
* Track check-out time
* Associate visitors with events
* Maintain visitor records

The backend ensures that a visitor cannot be checked out before their check-in time.

---

# 📱 QR Attendance

TaskPilot supports QR-based attendance for events.

### Features

* Generate event QR codes
* Scan QR codes
* Record attendance
* Track event participation

---

# 📢 Announcement Bulletin

Administrators can publish organizational announcements.

Examples include:

* Important notices
* Circulars
* Holiday announcements
* Urgent updates
* Department announcements

Announcements can be targeted to specific departments or published organization-wide.

---

# 📝 Minutes of Meetings (MoM)

TaskPilot allows organizations to maintain meeting records.

### Features

* Store meeting details
* Record important decisions
* Document action points
* Associate meeting notes with events or activities

---

# ⭐ Feedback Management

Users can submit feedback after events or organizational activities.

### Features

* Event feedback
* Ratings
* Comments
* Review records

---

# 📈 Reports and Export

TaskPilot provides reporting and analytics capabilities.

### Available Reports

* Task reports
* Employee performance reports
* Department reports
* Event reports
* Pending task reports
* Completed task reports
* Overdue task reports

### Export Formats

* PDF
* Excel

---

# 🔍 Search Functionality

Users can quickly search for organizational information.

Supported search areas include:

* Users
* Tasks
* Events
* Departments
* Other relevant records

---

# 📜 Activity Logs

TaskPilot maintains activity records for important actions.

Activity logs can include:

* Task assignments
* Task updates
* Task completion
* Administrative actions
* User activities
* Important system events

This improves accountability and transparency.

---

# 🛡️ Backend Validation

Important business rules are validated on the backend to protect data integrity and prevent invalid requests.

### Events

* End date cannot be earlier than start date
* Invalid date values are rejected

### Tasks

* Progress must be between `0` and `100`
* Priority must contain a valid value
* Deadline data is validated
* Invalid status values are rejected

### Visitors

* Check-out cannot occur before check-in
* Required visitor information is validated

### Resource Bookings

* End time must be later than start time
* Invalid date/time ranges are rejected
* Overlapping bookings for the same resource are prevented

### Users

* Email format validation
* Duplicate email prevention
* Strong password validation
* Secure password handling

Frontend validation improves user experience, while backend validation remains the final authority.

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
DATABASE_URL=postgresql://YOUR_USERNAME:YOUR_PASSWORD@localhost:5432/taskpilot

JWT_SECRET=your_secure_jwt_secret

PORT=5000

APP_URL=http://localhost:8080

EMAIL_NOTIFICATIONS_ENABLED=false

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false

SMTP_USER=yourgmail@gmail.com
SMTP_PASSWORD=your_google_app_password

EMAIL_FROM="TaskPilot <yourgmail@gmail.com>"
```

## ⚠️ Important Security Note

Never commit your `.env` file to GitHub.

Do not expose:

* Database passwords
* JWT secrets
* SMTP passwords
* Google App Passwords
* API keys

---

# 🔧 Backend Setup

Open a terminal and navigate to the backend directory:

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

The backend will start on the configured port.

---

# 🎨 Frontend Setup

Open another terminal in the project root directory.

Install dependencies:

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
