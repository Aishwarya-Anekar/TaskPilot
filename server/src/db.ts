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
    console.log("Database connection established. Checking TaskPilot schema...");

    // Create Departments Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create Users Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'employee', -- 'super_admin', 'dept_head', 'employee'
        department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
        semester VARCHAR(20), -- keep for compatibility if needed
        password_setup_required BOOLEAN NOT NULL DEFAULT false,
        is_active BOOLEAN NOT NULL DEFAULT true,
        sms_notifications BOOLEAN DEFAULT true,
        email_notifications BOOLEAN DEFAULT true,
        push_notifications BOOLEAN DEFAULT false,
        email_verified BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_setup_required BOOLEAN NOT NULL DEFAULT false");
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true");
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS college_role VARCHAR(40)");
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id VARCHAR(40)");
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS designation VARCHAR(120)");
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(40)");
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_joining DATE");
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS bio VARCHAR(500)");
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo VARCHAR(255)");
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS task_assignment_notifications BOOLEAN NOT NULL DEFAULT true");
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS task_deadline_notifications BOOLEAN NOT NULL DEFAULT true");
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS event_reminder_notifications BOOLEAN NOT NULL DEFAULT true");
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS task_status_notifications BOOLEAN NOT NULL DEFAULT true");
    await client.query(`
      UPDATE users SET college_role = CASE role
        WHEN 'super_admin' THEN 'super_admin'
        WHEN 'dept_head' THEN 'hod'
        ELSE 'staff'
      END WHERE college_role IS NULL;
      ALTER TABLE users ALTER COLUMN college_role SET DEFAULT 'staff';
      ALTER TABLE users ALTER COLUMN college_role SET NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS users_employee_id_unique
        ON users (employee_id) WHERE employee_id IS NOT NULL;
    `);

    await client.query("ALTER TABLE departments ADD COLUMN IF NOT EXISTS department_code VARCHAR(30)");
    await client.query("ALTER TABLE departments ADD COLUMN IF NOT EXISTS department_type VARCHAR(20) NOT NULL DEFAULT 'administrative'");
    await client.query("ALTER TABLE departments ADD COLUMN IF NOT EXISTS hod_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL");
    await client.query("ALTER TABLE departments ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255)");
    await client.query("ALTER TABLE departments ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true");
    await client.query(`
      UPDATE departments d SET hod_user_id = (
        SELECT u.id FROM users u WHERE u.department_id = d.id AND u.role = 'dept_head'
        ORDER BY u.created_at ASC, u.id ASC LIMIT 1
      ) WHERE d.hod_user_id IS NULL AND EXISTS (
        SELECT 1 FROM users u WHERE u.department_id = d.id AND u.role = 'dept_head'
      );
      CREATE UNIQUE INDEX IF NOT EXISTS departments_code_unique
        ON departments (LOWER(department_code)) WHERE department_code IS NOT NULL AND department_code <> '';
      CREATE UNIQUE INDEX IF NOT EXISTS departments_hod_unique
        ON departments (hod_user_id) WHERE hod_user_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS users_hod_department_unique
        ON users (department_id) WHERE role = 'dept_head' AND department_id IS NOT NULL;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        maintenance_mode BOOLEAN NOT NULL DEFAULT false,
        enable_audit BOOLEAN NOT NULL DEFAULT true,
        enable_notifications BOOLEAN NOT NULL DEFAULT true,
        organization_name VARCHAR(160) NOT NULL DEFAULT 'TaskPilot Organization',
        support_email VARCHAR(255) NOT NULL DEFAULT 'support@taskpilot.com',
        institution_code VARCHAR(40),
        college_address TEXT,
        timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Kolkata',
        academic_year VARCHAR(30),
        academic_term VARCHAR(40),
        working_days SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::smallint[],
        working_hours_start TIME NOT NULL DEFAULT '09:00',
        working_hours_end TIME NOT NULL DEFAULT '17:00',
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      INSERT INTO system_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
    `);
    await client.query("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS institution_code VARCHAR(40)");
    await client.query("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS college_address TEXT");
    await client.query("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Kolkata'");
    await client.query("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS academic_year VARCHAR(30)");
    await client.query("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS academic_term VARCHAR(40)");
    await client.query("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS working_days SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::smallint[]");
    await client.query("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS working_hours_start TIME NOT NULL DEFAULT '09:00'");
    await client.query("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS working_hours_end TIME NOT NULL DEFAULT '17:00'");

    const initialAdminName = process.env.INITIAL_SUPER_ADMIN_NAME?.trim();
    const initialAdminEmail = process.env.INITIAL_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
    const initialAdminPassword = process.env.INITIAL_SUPER_ADMIN_PASSWORD;
    const bootstrapValues = [initialAdminName, initialAdminEmail, initialAdminPassword];
    if (bootstrapValues.some(Boolean) && !bootstrapValues.every(Boolean)) {
      throw new Error("Set INITIAL_SUPER_ADMIN_NAME, INITIAL_SUPER_ADMIN_EMAIL, and INITIAL_SUPER_ADMIN_PASSWORD together.");
    }
    if (initialAdminName && initialAdminEmail && initialAdminPassword) {
      if (initialAdminName.length > 100 || !/^\S+@\S+\.\S+$/.test(initialAdminEmail)) {
        throw new Error("INITIAL_SUPER_ADMIN_NAME or INITIAL_SUPER_ADMIN_EMAIL is invalid.");
      }
      if (initialAdminPassword.length < 16) {
        throw new Error("INITIAL_SUPER_ADMIN_PASSWORD must contain at least 16 characters.");
      }
      const existingSuperAdmin = await client.query("SELECT id FROM users WHERE role = 'super_admin' LIMIT 1");
      if (!existingSuperAdmin.rows.length) {
        const passwordHash = await bcrypt.hash(initialAdminPassword, 12);
        await client.query(
          `INSERT INTO users (name, email, password_hash, role, email_verified, password_setup_required)
           VALUES ($1, $2, $3, 'super_admin', true, false)
           ON CONFLICT (email) DO NOTHING`,
          [initialAdminName, initialAdminEmail, passwordHash]
        );
        const bootstrappedAdmin = await client.query("SELECT id FROM users WHERE role = 'super_admin' LIMIT 1");
        if (!bootstrappedAdmin.rows.length) {
          throw new Error("Initial Super Admin could not be created; the configured email may already belong to another account.");
        }
      }
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS email_verification_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash CHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx ON email_verification_tokens (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS email_verification_tokens_expiry_idx ON email_verification_tokens (expires_at) WHERE used_at IS NULL;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS event_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        description TEXT DEFAULT '',
        event_category VARCHAR(60) DEFAULT 'Other',
        default_duration_minutes INTEGER NOT NULL DEFAULT 120 CHECK (default_duration_minutes > 0),
        default_location VARCHAR(255) DEFAULT '',
        suggested_department_ids INTEGER[] DEFAULT '{}',
        default_responsible_role VARCHAR(30),
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query("ALTER TABLE event_templates ADD COLUMN IF NOT EXISTS event_category VARCHAR(60) DEFAULT 'Other'");
    await client.query("ALTER TABLE event_templates ADD COLUMN IF NOT EXISTS default_location VARCHAR(255) DEFAULT ''");
    await client.query("ALTER TABLE event_templates ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true");
    await client.query(`
      CREATE TABLE IF NOT EXISTS event_template_tasks (
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

      CREATE TABLE IF NOT EXISTS event_template_subtasks (
        id SERIAL PRIMARY KEY,
        template_task_id INTEGER NOT NULL REFERENCES event_template_tasks(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        sort_order INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS event_template_tasks_template_idx ON event_template_tasks (template_id, sort_order);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash CHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry_idx ON password_reset_tokens (expires_at) WHERE used_at IS NULL;
    `);

    // In-app notifications are private to each recipient and deduplicated by key.
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
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
      CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
        ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
      CREATE INDEX IF NOT EXISTS notifications_user_created_idx
        ON notifications (user_id, created_at DESC);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS email_deliveries (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        dedupe_key VARCHAR(255) NOT NULL,
        last_attempt_at TIMESTAMP,
        sent_at TIMESTAMP,
        failed_at TIMESTAMP,
        UNIQUE (user_id, dedupe_key)
      );
      CREATE INDEX IF NOT EXISTS email_deliveries_pending_idx
        ON email_deliveries (last_attempt_at) WHERE sent_at IS NULL;
    `);

    // Create Events Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        location VARCHAR(255),
        category VARCHAR(60) DEFAULT 'Other',
        department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
        start_date TIMESTAMP,
        end_date TIMESTAMP,
        coordinator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR(30) DEFAULT 'Draft', -- 'Draft', 'Active', 'Completed', 'Cancelled', 'Pending Approval'
        approval_required BOOLEAN NOT NULL DEFAULT false,
        approval_status VARCHAR(30) NOT NULL DEFAULT 'Not Required',
        approval_notes TEXT,
        qr_code_key VARCHAR(100),
        recurrence_type VARCHAR(20),
        recurrence_interval INTEGER,
        recurrence_until TIMESTAMP,
        recurrence_next_at TIMESTAMP,
        template_id INTEGER REFERENCES event_templates(id) ON DELETE SET NULL,
        deleted_at TIMESTAMP,
        deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query("ALTER TABLE events ADD COLUMN IF NOT EXISTS category VARCHAR(60) DEFAULT 'Other'");
    await client.query("ALTER TABLE events ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL");
    await client.query("ALTER TABLE events ADD COLUMN IF NOT EXISTS approval_required BOOLEAN NOT NULL DEFAULT false");
    await client.query("ALTER TABLE events ADD COLUMN IF NOT EXISTS approval_status VARCHAR(30) NOT NULL DEFAULT 'Not Required'");
    await client.query("ALTER TABLE events ADD COLUMN IF NOT EXISTS approval_notes TEXT");
    await client.query("ALTER TABLE events ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP");
    await client.query("ALTER TABLE events ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL");
    await client.query("CREATE INDEX IF NOT EXISTS events_active_idx ON events (deleted_at, start_date)");

    await client.query(`
      CREATE TABLE IF NOT EXISTS visitors (
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
        email_status VARCHAR(20) NOT NULL DEFAULT 'Not Applicable',
        email_last_attempt_at TIMESTAMP,
        email_attempt_count INTEGER NOT NULL DEFAULT 0,
        email_last_error TEXT,
        email_request_key UUID,
        registration_key UUID,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS visitors_arrival_idx ON visitors (expected_arrival);
      CREATE INDEX IF NOT EXISTS visitors_status_idx ON visitors (status);
      CREATE INDEX IF NOT EXISTS visitors_event_idx ON visitors (event_id);
      CREATE INDEX IF NOT EXISTS visitors_host_idx ON visitors (host_id);
      CREATE TABLE IF NOT EXISTS visitor_activity (
        id SERIAL PRIMARY KEY,
        visitor_id INTEGER NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
        action VARCHAR(30) NOT NULL,
        performed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        details TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS visitor_activity_visitor_idx ON visitor_activity (visitor_id, created_at DESC);
    `);
    await client.query("ALTER TABLE visitors ADD COLUMN IF NOT EXISTS email_status VARCHAR(20) NOT NULL DEFAULT 'Not Applicable'");
    await client.query("ALTER TABLE visitors ADD COLUMN IF NOT EXISTS email_last_attempt_at TIMESTAMP");
    await client.query("ALTER TABLE visitors ADD COLUMN IF NOT EXISTS email_attempt_count INTEGER NOT NULL DEFAULT 0");
    await client.query("ALTER TABLE visitors ADD COLUMN IF NOT EXISTS email_last_error TEXT");
    await client.query("ALTER TABLE visitors ADD COLUMN IF NOT EXISTS email_request_key UUID");
    await client.query("ALTER TABLE visitors ADD COLUMN IF NOT EXISTS registration_key UUID");
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS visitors_registration_key_unique ON visitors (registration_key) WHERE registration_key IS NOT NULL");

    // Create Tasks Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(40) DEFAULT 'Administrative Work',
        assigned_to_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        assigned_dept_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
        priority VARCHAR(20) DEFAULT 'Medium', -- 'Low', 'Medium', 'High', 'Urgent'
        status VARCHAR(30) DEFAULT 'Pending', -- 'Pending', 'In Progress', 'Submitted for Review', 'Approved', 'Rework Required', 'Cancelled'
        progress INTEGER DEFAULT 0,
        due_date TIMESTAMP,
        verification_required BOOLEAN NOT NULL DEFAULT false,
        completion_notes TEXT,
        rework_reason TEXT,
        submitted_at TIMESTAMP,
        reviewed_at TIMESTAMP,
        deleted_at TIMESTAMP,
        deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        is_overdue BOOLEAN DEFAULT false,
        overdue_at TIMESTAMP,
        proof_url VARCHAR(500),
        approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS category VARCHAR(40) DEFAULT 'Administrative Work'");
    await client.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS verification_required BOOLEAN NOT NULL DEFAULT false");
    await client.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completion_notes TEXT");
    await client.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rework_reason TEXT");
    await client.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP");
    await client.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP");
    await client.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP");
    await client.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL");
    await client.query("CREATE INDEX IF NOT EXISTS tasks_active_idx ON tasks (deleted_at, due_date)");

    await client.query(`
      CREATE TABLE IF NOT EXISTS escalation_settings (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        stage_2_hours INTEGER NOT NULL DEFAULT 24 CHECK (stage_2_hours > 0),
        stage_3_hours INTEGER NOT NULL DEFAULT 48 CHECK (stage_3_hours > 0),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );
      INSERT INTO escalation_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
      CREATE TABLE IF NOT EXISTS task_escalations (
        id SERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        stage INTEGER NOT NULL CHECK (stage BETWEEN 1 AND 3),
        recipient_role VARCHAR(30) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (task_id, stage)
      );
      CREATE INDEX IF NOT EXISTS task_escalations_task_idx ON task_escalations (task_id, created_at DESC);
    `);

    // Create Subtasks Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS subtasks (
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
      CREATE TABLE IF NOT EXISTS resources (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        type VARCHAR(50) NOT NULL, -- 'Room', 'Equipment', 'Service'
        status VARCHAR(30) DEFAULT 'Available', -- 'Available', 'Maintenance', 'Unavailable'
        resource_code VARCHAR(40),
        department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
        building_location VARCHAR(160),
        capacity INTEGER CHECK (capacity IS NULL OR capacity >= 0),
        quantity INTEGER CHECK (quantity IS NULL OR quantity >= 0),
        condition_status VARCHAR(30) NOT NULL DEFAULT 'Good',
        description TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        maintenance_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await client.query("ALTER TABLE resources ADD COLUMN IF NOT EXISTS resource_code VARCHAR(40)");
    await client.query("ALTER TABLE resources ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL");
    await client.query("ALTER TABLE resources ADD COLUMN IF NOT EXISTS building_location VARCHAR(160)");
    await client.query("ALTER TABLE resources ADD COLUMN IF NOT EXISTS capacity INTEGER CHECK (capacity IS NULL OR capacity >= 0)");
    await client.query("ALTER TABLE resources ADD COLUMN IF NOT EXISTS quantity INTEGER CHECK (quantity IS NULL OR quantity >= 0)");
    await client.query("ALTER TABLE resources ADD COLUMN IF NOT EXISTS condition_status VARCHAR(30) NOT NULL DEFAULT 'Good'");
    await client.query("ALTER TABLE resources ADD COLUMN IF NOT EXISTS description TEXT");
    await client.query("ALTER TABLE resources ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true");
    await client.query("ALTER TABLE resources ADD COLUMN IF NOT EXISTS maintenance_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL");
    await client.query("ALTER TABLE resources ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()");
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS resources_code_unique ON resources (LOWER(resource_code)) WHERE resource_code IS NOT NULL AND resource_code <> ''");

    // Create Resource Bookings Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS resource_bookings (
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
      CREATE TABLE IF NOT EXISTS task_comments (
        id SERIAL PRIMARY KEY,
        task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create Announcements Table (Announcement Board)
    await client.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
        target_dept_id INTEGER REFERENCES departments(id) ON DELETE CASCADE, -- NULL for all
        category VARCHAR(40) NOT NULL DEFAULT 'General Notice',
        priority VARCHAR(20) NOT NULL DEFAULT 'Normal',
        audience VARCHAR(30) NOT NULL DEFAULT 'college',
        status VARCHAR(20) NOT NULL DEFAULT 'published',
        published_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP,
        acknowledgement_required BOOLEAN NOT NULL DEFAULT false,
        is_pinned BOOLEAN NOT NULL DEFAULT false,
        related_event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
        related_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
        archived_at TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query("ALTER TABLE announcements ADD COLUMN IF NOT EXISTS category VARCHAR(40) NOT NULL DEFAULT 'General Notice'");
    await client.query("ALTER TABLE announcements ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'Normal'");
    await client.query("ALTER TABLE announcements ADD COLUMN IF NOT EXISTS audience VARCHAR(30) NOT NULL DEFAULT 'college'");
    await client.query("ALTER TABLE announcements ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'published'");
    await client.query("ALTER TABLE announcements ADD COLUMN IF NOT EXISTS published_at TIMESTAMP NOT NULL DEFAULT NOW()");
    await client.query("ALTER TABLE announcements ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP");
    await client.query("ALTER TABLE announcements ADD COLUMN IF NOT EXISTS acknowledgement_required BOOLEAN NOT NULL DEFAULT false");
    await client.query("ALTER TABLE announcements ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false");
    await client.query("ALTER TABLE announcements ADD COLUMN IF NOT EXISTS related_event_id INTEGER REFERENCES events(id) ON DELETE SET NULL");
    await client.query("ALTER TABLE announcements ADD COLUMN IF NOT EXISTS related_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL");
    await client.query("ALTER TABLE announcements ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP");
    await client.query("ALTER TABLE announcements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()");

    await client.query(`
      CREATE TABLE IF NOT EXISTS announcement_recipients (
        announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (announcement_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS announcement_reads (
        announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        read_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (announcement_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS announcement_acknowledgements (
        announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        acknowledged_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (announcement_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS announcements_active_idx
        ON announcements (status, published_at DESC, is_pinned DESC);
      CREATE INDEX IF NOT EXISTS announcements_department_idx
        ON announcements (target_dept_id, published_at DESC);
      CREATE INDEX IF NOT EXISTS announcements_expiry_idx
        ON announcements (expires_at) WHERE status = 'published';
    `);

    // Create Event Feedback Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS event_feedback (
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
      CREATE TABLE IF NOT EXISTS meeting_notes (
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
      CREATE TABLE IF NOT EXISTS attendance (
        id SERIAL PRIMARY KEY,
        event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        scanned_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create Activity Logs Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action VARCHAR(255) NOT NULL,
        details TEXT,
        entity_type VARCHAR(40),
        entity_id INTEGER,
        outcome VARCHAR(30) NOT NULL DEFAULT 'success',
        before_data JSONB,
        after_data JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query("ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS entity_type VARCHAR(40)");
    await client.query("ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS entity_id INTEGER");
    await client.query("ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS outcome VARCHAR(30) NOT NULL DEFAULT 'success'");
    await client.query("ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS before_data JSONB");
    await client.query("ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS after_data JSONB");
    await client.query("CREATE INDEX IF NOT EXISTS activity_logs_created_idx ON activity_logs (created_at DESC, id DESC)");
    await client.query("CREATE INDEX IF NOT EXISTS activity_logs_entity_idx ON activity_logs (entity_type, entity_id, created_at DESC)");

    // Create Messages Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        contact_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        sent_by_user BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        channel_type VARCHAR(20) NOT NULL CHECK (channel_type IN ('department', 'event')),
        department_id INTEGER REFERENCES departments(id) ON DELETE RESTRICT,
        event_id INTEGER REFERENCES events(id) ON DELETE RESTRICT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CHECK (
          (channel_type = 'department' AND department_id IS NOT NULL AND event_id IS NULL)
          OR (channel_type = 'event' AND event_id IS NOT NULL AND department_id IS NULL)
        )
      );
      CREATE UNIQUE INDEX IF NOT EXISTS conversations_department_unique
        ON conversations (department_id) WHERE channel_type = 'department';
      CREATE UNIQUE INDEX IF NOT EXISTS conversations_event_unique
        ON conversations (event_id) WHERE channel_type = 'event';
      CREATE TABLE IF NOT EXISTS conversation_members (
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        last_read_at TIMESTAMP,
        joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (conversation_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS conversation_members_user_idx
        ON conversation_members (user_id, conversation_id);
      CREATE TABLE IF NOT EXISTS conversation_messages (
        id SERIAL PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        sender_name VARCHAR(100) NOT NULL,
        text TEXT NOT NULL CHECK (length(trim(text)) > 0),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS conversation_messages_page_idx
        ON conversation_messages (conversation_id, id DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS users_name_search_idx ON users (LOWER(name));
      CREATE INDEX IF NOT EXISTS users_email_search_idx ON users (LOWER(email));
      CREATE INDEX IF NOT EXISTS departments_name_search_idx ON departments (LOWER(name));
      CREATE INDEX IF NOT EXISTS tasks_title_search_idx ON tasks (LOWER(title));
      CREATE INDEX IF NOT EXISTS events_title_search_idx ON events (LOWER(title));
      CREATE INDEX IF NOT EXISTS tasks_assigned_to_idx ON tasks (assigned_to_id);
      CREATE INDEX IF NOT EXISTS tasks_assigned_dept_idx ON tasks (assigned_dept_id);
      CREATE INDEX IF NOT EXISTS resource_bookings_resource_time_idx
        ON resource_bookings (resource_id, start_time, end_time, status);
    `);

    console.log("Database schema checked successfully. Missing tables and indexes were created; existing data preserved.");

    // Seed defaults only when their stable identifiers do not already exist.
    const defaultDepartments = [
      ["IT Support", "Coordinates tech hardware, networks, servers, and general computer issues."],
      ["Operations", "Manages facilities maintenance, cleaning, setup, and logistics."],
      ["Human Resources", "Handles staffing, payroll, employee relationships, and registrations."],
      ["Events Team", "Responsible for planning, coordination, and executing public and corporate events."],
    ];
    for (const [name, description] of defaultDepartments) {
      await client.query(
        "INSERT INTO departments (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
        [name, description]
      );
    }

    const deptResult = await client.query("SELECT id, name FROM departments");
    const depts: Record<string, number> = {};
    deptResult.rows.forEach((d) => {
      depts[d.name] = d.id;
    });

    // Demo accounts and sample workflow data are opt-in and never created in production.
    if (process.env.NODE_ENV !== "production" && process.env.SEED_DEMO_DATA === "true") {
    if (!process.env.SEED_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD.length < 12) {
      throw new Error("SEED_ADMIN_PASSWORD must be configured with at least 12 characters when SEED_DEMO_DATA is enabled.");
    }
    // Seed users
    const hash = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD, 12);

    const ensureUser = async (name: string, email: string, role: string, departmentId?: number) => {
      await client.query(
        `INSERT INTO users (name, email, password_hash, role, department_id)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING`,
        [name, email, hash, role, departmentId || null]
      );
      const result = await client.query("SELECT id FROM users WHERE email = $1", [email]);
      return result.rows[0].id as number;
    };

    const superAdminId = await ensureUser("Super Admin", "superadmin@taskpilot.com", "super_admin");
    await ensureUser("Dept Head (IT)", "depthead@taskpilot.com", "dept_head", depts["IT Support"]);
    const employeeId = await ensureUser("Employee (IT)", "employee@taskpilot.com", "employee", depts["IT Support"]);

    // Seed resources
    const defaultResources = [
      ["Conference Room A", "Room"],
      ["Main Auditorium", "Room"],
      ["High-Def Projector", "Equipment"],
      ["PA Audio System", "Equipment"],
    ];
    for (const [name, type] of defaultResources) {
      const existing = await client.query("SELECT id FROM resources WHERE name = $1 LIMIT 1", [name]);
      if (!existing.rows.length) {
        await client.query("INSERT INTO resources (name, type, status) VALUES ($1, $2, 'Available')", [name, type]);
      }
    }

    // Seed an initial event
    const existingEvent = await client.query("SELECT id FROM events WHERE qr_code_key = $1 LIMIT 1", ["tech_summit_2026_qr"]);
    if (existingEvent.rows.length) {
      console.log("Seed data checked successfully; existing demo data was preserved.");
    } else {
      const event = await client.query(`
        INSERT INTO events (title, description, location, start_date, end_date, coordinator_id, status, qr_code_key)
        VALUES ('Annual Tech Summit 2026', 'A large tech summit with workshops and seminars.', 'Main Auditorium', NOW() + INTERVAL '2 days', NOW() + INTERVAL '3 days', $1, 'Active', 'tech_summit_2026_qr')
        RETURNING id
      `, [superAdminId]);
      const eventId = event.rows[0].id;

    // Seed resource booking
    await client.query(`
      INSERT INTO resource_bookings (resource_id, event_id, booked_by, start_time, end_time)
      VALUES ((SELECT id FROM resources WHERE name='Main Auditorium'), $1, $2, NOW() + INTERVAL '2 days', NOW() + INTERVAL '3 days')
      `, [eventId, superAdminId]);

    // Seed tasks for this event
    const task1 = await client.query(`
      INSERT INTO tasks (event_id, title, description, assigned_to_id, assigned_dept_id, priority, status, progress, due_date)
      VALUES ($1, 'Set up Tech Network', 'Configure routers and switches for high-speed Wi-Fi access for guests.', $2, $3, 'High', 'In Progress', 40, NOW() + INTERVAL '1 day')
      RETURNING id
      `, [eventId, employeeId, depts["IT Support"]]);

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
      `, [task1.rows[0].id, employeeId]);

    // Seed task comment
    await client.query(`
      INSERT INTO task_comments (task_id, user_id, text) VALUES
        ($1, $2, 'Installed the router in the main hallway. Getting good signals.')
      `, [task1.rows[0].id, employeeId]);

    // Seed announcements
    await client.query(`
      INSERT INTO announcements (title, content, created_by) VALUES
        ('Welcome to TaskPilot Operations', 'TaskPilot has launched today. All organizational workflows are now orchestrated digitally. Please complete your tasks accordingly.', $1)
      `, [superAdminId]);

    // Seed system log
    await client.query(`
      INSERT INTO activity_logs (user_id, action, details) VALUES
        ($1, 'Initialize Organization', 'TaskPilot organization details were initialized with pre-seeded demo files.')
      `, [superAdminId]);

      console.log("Default demo event, task, and related data created.");
    }
    }
    console.log("Seed data checked successfully. Existing database data preserved.");

  } catch (err) {
    console.error("Failed to initialize database:", err);
    throw err;
  } finally {
    client.release();
  }
}
