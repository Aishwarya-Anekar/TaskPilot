import pg from "pg";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config();

// PG Connection Pool for TaskPilot
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export default pool;

export async function initDb() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL environment variable is not defined");
  }

  // Parse dbName and get a connection string for the default 'postgres' database
  const match = dbUrl.match(/^(postgres(?:ql)?:\/\/[^/]+)\/([^?]+)(\?.*)?$/);
  if (match) {
    const baseUri = match[1];
    const dbName = match[2];
    const queryParams = match[3] || "";
    const defaultDbUri = `${baseUri}/postgres${queryParams}`;

    const tempClient = new pg.Client({ connectionString: defaultDbUri });
    try {
      await tempClient.connect();
      const res = await tempClient.query(
        "SELECT 1 FROM pg_database WHERE datname = $1",
        [dbName]
      );
      if (res.rows.length === 0) {
        console.log(`Database '${dbName}' does not exist. Creating...`);
        await tempClient.query(`CREATE DATABASE "${dbName}"`);
        console.log(`Database '${dbName}' created successfully.`);
      }
    } catch (err) {
      console.error("Failed to check/create database:", err);
      throw err;
    } finally {
      await tempClient.end();
    }
  }

  const client = await pool.connect();
  try {
    console.log("Reinitializing database schema for TaskPilot...");

    // Drop old tables first to ensure clean migration
    await client.query(`
      DROP TABLE IF EXISTS activity_logs CASCADE;
      DROP TABLE IF EXISTS attendance CASCADE;
      DROP TABLE IF EXISTS meeting_notes CASCADE;
      DROP TABLE IF EXISTS event_feedback CASCADE;
      DROP TABLE IF EXISTS announcements CASCADE;
      DROP TABLE IF EXISTS task_comments CASCADE;
      DROP TABLE IF EXISTS resource_bookings CASCADE;
      DROP TABLE IF EXISTS resources CASCADE;
      DROP TABLE IF EXISTS subtasks CASCADE;
      DROP TABLE IF EXISTS tasks CASCADE;
      DROP TABLE IF EXISTS events CASCADE;
      DROP TABLE IF EXISTS work_logs CASCADE;
      DROP TABLE IF EXISTS messages CASCADE;
      DROP TABLE IF EXISTS contacts CASCADE;
      DROP TABLE IF EXISTS issues CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
      DROP TABLE IF EXISTS departments CASCADE;
      DROP TABLE IF EXISTS notifications CASCADE;
      DROP TABLE IF EXISTS email_deliveries CASCADE;
      DROP TABLE IF EXISTS task_escalations CASCADE;
      DROP TABLE IF EXISTS escalation_settings CASCADE;
      DROP TABLE IF EXISTS event_template_subtasks CASCADE;
      DROP TABLE IF EXISTS event_template_tasks CASCADE;
      DROP TABLE IF EXISTS event_templates CASCADE;
      DROP TABLE IF EXISTS password_reset_tokens CASCADE;
      DROP TABLE IF EXISTS visitor_activity CASCADE;
      DROP TABLE IF EXISTS visitors CASCADE;
      DROP TABLE IF EXISTS email_verification_tokens CASCADE;
    `);

    // Create Departments Table
    await client.query(`
      CREATE TABLE departments (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create Users Table
    await client.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'employee', -- 'super_admin', 'admin', 'dept_head', 'employee'
        department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
        semester VARCHAR(20), -- keep for compatibility if needed
        sms_notifications BOOLEAN DEFAULT true,
        email_notifications BOOLEAN DEFAULT true,
        push_notifications BOOLEAN DEFAULT false,
        email_verified BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE email_verification_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash CHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX email_verification_tokens_user_idx ON email_verification_tokens (user_id, created_at DESC);
      CREATE INDEX email_verification_tokens_expiry_idx ON email_verification_tokens (expires_at) WHERE used_at IS NULL;
    `);

    await client.query(`
      CREATE TABLE event_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        description TEXT DEFAULT '',
        default_duration_minutes INTEGER NOT NULL DEFAULT 120 CHECK (default_duration_minutes > 0),
        suggested_department_ids INTEGER[] DEFAULT '{}',
        default_responsible_role VARCHAR(30),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE event_template_tasks (
        id SERIAL PRIMARY KEY,
        template_id INTEGER NOT NULL REFERENCES event_templates(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT DEFAULT '',
        priority VARCHAR(20) DEFAULT 'Medium',
        responsible_role VARCHAR(30),
        responsible_department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
        relative_due_hours INTEGER DEFAULT 24,
        sort_order INTEGER DEFAULT 0
      );
      CREATE TABLE event_template_subtasks (
        id SERIAL PRIMARY KEY,
        template_task_id INTEGER NOT NULL REFERENCES event_template_tasks(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        sort_order INTEGER DEFAULT 0
      );
      CREATE INDEX event_template_tasks_template_idx ON event_template_tasks (template_id, sort_order);
    `);

    await client.query(`
      CREATE TABLE password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash CHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id, created_at DESC);
      CREATE INDEX password_reset_tokens_expiry_idx ON password_reset_tokens (expires_at) WHERE used_at IS NULL;
    `);

    // In-app notifications are private to each recipient and deduplicated by key.
    await client.query(`
      CREATE TABLE notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        entity_type VARCHAR(30),
        entity_id INTEGER,
        dedupe_key VARCHAR(255) NOT NULL,
        read_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (user_id, dedupe_key)
      );
      CREATE INDEX notifications_user_unread_idx
        ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
      CREATE INDEX notifications_user_created_idx
        ON notifications (user_id, created_at DESC);
    `);

    await client.query(`
      CREATE TABLE email_deliveries (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        dedupe_key VARCHAR(255) NOT NULL,
        last_attempt_at TIMESTAMP,
        sent_at TIMESTAMP,
        failed_at TIMESTAMP,
        UNIQUE (user_id, dedupe_key)
      );
      CREATE INDEX email_deliveries_pending_idx
        ON email_deliveries (last_attempt_at) WHERE sent_at IS NULL;
    `);

    // Create Events Table
    await client.query(`
      CREATE TABLE events (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        location VARCHAR(255),
        start_date TIMESTAMP,
        end_date TIMESTAMP,
        coordinator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR(30) DEFAULT 'Draft', -- 'Draft', 'Active', 'Completed', 'Cancelled'
        qr_code_key VARCHAR(100),
        recurrence_type VARCHAR(20),
        recurrence_interval INTEGER,
        recurrence_until TIMESTAMP,
        recurrence_next_at TIMESTAMP,
        template_id INTEGER REFERENCES event_templates(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE visitors (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        contact VARCHAR(150) NOT NULL,
        organization VARCHAR(150),
        purpose TEXT NOT NULL,
        event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
        host_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        expected_arrival TIMESTAMP NOT NULL,
        check_in_at TIMESTAMP,
        check_out_at TIMESTAMP,
        status VARCHAR(20) NOT NULL DEFAULT 'Expected' CHECK (status IN ('Expected','Checked In','Checked Out','Cancelled')),
        pass_code VARCHAR(80) NOT NULL UNIQUE,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX visitors_arrival_idx ON visitors (expected_arrival);
      CREATE INDEX visitors_status_idx ON visitors (status);
      CREATE INDEX visitors_event_idx ON visitors (event_id);
      CREATE INDEX visitors_host_idx ON visitors (host_id);
      CREATE TABLE visitor_activity (
        id SERIAL PRIMARY KEY,
        visitor_id INTEGER NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
        action VARCHAR(30) NOT NULL,
        performed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        details TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX visitor_activity_visitor_idx ON visitor_activity (visitor_id, created_at DESC);
    `);

    // Create Tasks Table
    await client.query(`
      CREATE TABLE tasks (
        id SERIAL PRIMARY KEY,
        event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        assigned_to_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        assigned_dept_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
        priority VARCHAR(20) DEFAULT 'Medium', -- 'Low', 'Medium', 'High'
        status VARCHAR(30) DEFAULT 'Pending', -- 'Pending', 'In Progress', 'Under Review', 'Completed', 'Rejected'
        progress INTEGER DEFAULT 0,
        due_date TIMESTAMP,
        is_overdue BOOLEAN DEFAULT false,
        overdue_at TIMESTAMP,
        proof_url VARCHAR(500),
        approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE escalation_settings (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        stage_2_hours INTEGER NOT NULL DEFAULT 24 CHECK (stage_2_hours > 0),
        stage_3_hours INTEGER NOT NULL DEFAULT 48 CHECK (stage_3_hours > 0),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );
      INSERT INTO escalation_settings (id) VALUES (1);
      CREATE TABLE task_escalations (
        id SERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        stage INTEGER NOT NULL CHECK (stage BETWEEN 1 AND 3),
        recipient_role VARCHAR(30) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (task_id, stage)
      );
      CREATE INDEX task_escalations_task_idx ON task_escalations (task_id, created_at DESC);
    `);

    // Create Subtasks Table
    await client.query(`
      CREATE TABLE subtasks (
        id SERIAL PRIMARY KEY,
        task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        assigned_to_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        is_completed BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create Resources Table
    await client.query(`
      CREATE TABLE resources (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        type VARCHAR(50) NOT NULL, -- 'Room', 'Equipment', 'Service'
        status VARCHAR(30) DEFAULT 'Available' -- 'Available', 'Maintenance', 'Unavailable'
      );
    `);

    // Create Resource Bookings Table
    await client.query(`
      CREATE TABLE resource_bookings (
        id SERIAL PRIMARY KEY,
        resource_id INTEGER REFERENCES resources(id) ON DELETE CASCADE,
        event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
        booked_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        status VARCHAR(30) DEFAULT 'Approved', -- 'Pending', 'Approved', 'Cancelled'
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create Task Comments (Collaboration Forum) Table
    await client.query(`
      CREATE TABLE task_comments (
        id SERIAL PRIMARY KEY,
        task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create Announcements Table (Announcement Board)
    await client.query(`
      CREATE TABLE announcements (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
        target_dept_id INTEGER REFERENCES departments(id) ON DELETE CASCADE, -- NULL for all
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create Event Feedback Table
    await client.query(`
      CREATE TABLE event_feedback (
        id SERIAL PRIMARY KEY,
        event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        comments TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create Meeting Notes Table
    await client.query(`
      CREATE TABLE meeting_notes (
        id SERIAL PRIMARY KEY,
        event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        notes TEXT NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create Attendance Table (QR attendance)
    await client.query(`
      CREATE TABLE attendance (
        id SERIAL PRIMARY KEY,
        event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        scanned_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create Activity Logs Table
    await client.query(`
      CREATE TABLE activity_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action VARCHAR(255) NOT NULL,
        details TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create Messages Table
    await client.query(`
      CREATE TABLE messages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        contact_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        sent_by_user BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX users_name_search_idx ON users (LOWER(name));
      CREATE INDEX users_email_search_idx ON users (LOWER(email));
      CREATE INDEX departments_name_search_idx ON departments (LOWER(name));
      CREATE INDEX tasks_title_search_idx ON tasks (LOWER(title));
      CREATE INDEX events_title_search_idx ON events (LOWER(title));
      CREATE INDEX tasks_assigned_to_idx ON tasks (assigned_to_id);
      CREATE INDEX tasks_assigned_dept_idx ON tasks (assigned_dept_id);
    `);

    console.log("✅ Database tables created successfully");

    // Seed default departments
    await client.query(`
      INSERT INTO departments (name, description) VALUES
        ('IT Support', 'Coordinates tech hardware, networks, servers, and general computer issues.'),
        ('Operations', 'Manages facilities maintenance, cleaning, setup, and logistics.'),
        ('Human Resources', 'Handles staffing, payroll, employee relationships, and registrations.'),
        ('Events Team', 'Responsible for planning, coordination, and executing public and corporate events.')
    `);
    console.log("✅ Seeded default departments");

    const deptResult = await client.query("SELECT id, name FROM departments");
    const depts: Record<string, number> = {};
    deptResult.rows.forEach((d) => {
      depts[d.name] = d.id;
    });

    // Seed users
    const hash = await bcrypt.hash("admin123", 10);

    // 1. Super Admin
    const superAdmin = await client.query(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES ('Super Admin', 'superadmin@taskpilot.com', $1, 'super_admin')
      RETURNING id
    `, [hash]);

    // 2. Admin
    const adminUser = await client.query(`
      INSERT INTO users (name, email, password_hash, role, department_id)
      VALUES ('Admin User', 'admin@taskpilot.com', $1, 'admin', $2)
      RETURNING id
    `, [hash, depts["Operations"]]);

    // 3. Dept Head
    const deptHead = await client.query(`
      INSERT INTO users (name, email, password_hash, role, department_id)
      VALUES ('Dept Head (IT)', 'depthead@taskpilot.com', $1, 'dept_head', $2)
      RETURNING id
    `, [hash, depts["IT Support"]]);

    // 4. Employee
    const employee = await client.query(`
      INSERT INTO users (name, email, password_hash, role, department_id)
      VALUES ('Employee (IT)', 'employee@taskpilot.com', $1, 'employee', $2)
      RETURNING id
    `, [hash, depts["IT Support"]]);

    console.log("✅ Seeded user roles successfully");

    // Seed resources
    await client.query(`
      INSERT INTO resources (name, type, status) VALUES
        ('Conference Room A', 'Room', 'Available'),
        ('Main Auditorium', 'Room', 'Available'),
        ('High-Def Projector', 'Equipment', 'Available'),
        ('PA Audio System', 'Equipment', 'Available')
    `);
    console.log("✅ Seeded resources");

    // Seed an initial event
    const event = await client.query(`
      INSERT INTO events (title, description, location, start_date, end_date, coordinator_id, status, qr_code_key)
      VALUES ('Annual Tech Summit 2026', 'A large tech summit with workshops and seminars.', 'Main Auditorium', NOW() + INTERVAL '2 days', NOW() + INTERVAL '3 days', $1, 'Active', 'tech_summit_2026_qr')
      RETURNING id
    `, [adminUser.rows[0].id]);
    const eventId = event.rows[0].id;

    // Seed resource booking
    await client.query(`
      INSERT INTO resource_bookings (resource_id, event_id, booked_by, start_time, end_time)
      VALUES ((SELECT id FROM resources WHERE name='Main Auditorium'), $1, $2, NOW() + INTERVAL '2 days', NOW() + INTERVAL '3 days')
    `, [eventId, adminUser.rows[0].id]);

    // Seed tasks for this event
    const task1 = await client.query(`
      INSERT INTO tasks (event_id, title, description, assigned_to_id, assigned_dept_id, priority, status, progress, due_date)
      VALUES ($1, 'Set up Tech Network', 'Configure routers and switches for high-speed Wi-Fi access for guests.', $2, $3, 'High', 'In Progress', 40, NOW() + INTERVAL '1 day')
      RETURNING id
    `, [eventId, employee.rows[0].id, depts["IT Support"]]);

    const task2 = await client.query(`
      INSERT INTO tasks (event_id, title, description, assigned_dept_id, priority, status, progress, due_date)
      VALUES ($1, 'Auditorium Seating Arrangement', 'Set up chairs and presentation standee.', $2, 'Medium', 'Pending', 0, NOW() + INTERVAL '2 days')
      RETURNING id
    `, [eventId, depts["Operations"]]);

    // Seed subtasks
    await client.query(`
      INSERT INTO subtasks (task_id, title, assigned_to_id, is_completed) VALUES
        ($1, 'Install Routers', $2, true),
        ($1, 'Configure SSIDs', $2, false),
        ($1, 'Test Bandwidth Limit', $2, false)
    `, [task1.rows[0].id, employee.rows[0].id]);

    // Seed task comment
    await client.query(`
      INSERT INTO task_comments (task_id, user_id, text) VALUES
        ($1, $2, 'Installed the router in the main hallway. Getting good signals.')
    `, [task1.rows[0].id, employee.rows[0].id]);

    // Seed announcements
    await client.query(`
      INSERT INTO announcements (title, content, created_by) VALUES
        ('Welcome to TaskPilot Operations', 'TaskPilot has launched today. All organizational workflows are now orchestrated digitally. Please complete your tasks accordingly.', $1)
    `, [adminUser.rows[0].id]);

    // Seed system log
    await client.query(`
      INSERT INTO activity_logs (user_id, action, details) VALUES
        ($1, 'Initialize Organization', 'TaskPilot organization details were initialized with pre-seeded demo files.')
    `, [superAdmin.rows[0].id]);

    console.log("✅ Database seeded with default events/tasks/resources!");

  } catch (err) {
    console.error("Failed to reinitialize database:", err);
    throw err;
  } finally {
    client.release();
  }
}
