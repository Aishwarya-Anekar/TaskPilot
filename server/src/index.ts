import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import cluster from "cluster";
import os from "os";
import { initDb } from "./db.js";
import authRoutes from "./routes/auth.js";
import tasksRoutes from "./routes/tasks.js";
import messagesRoutes from "./routes/messages.js";
import adminRoutes from "./routes/admin.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = parseInt(process.env.PORT || "5000");

// Middleware
app.use(cors({ origin: "*" }));
app.use(express.json());

// Serve uploaded files
const uploadsDir = path.join(__dirname, "../uploads");
app.use("/uploads", express.static(uploadsDir));

// Create uploads directory if it doesn't exist
import fs from "fs";
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/tasks", tasksRoutes);
app.use("/api/issues", tasksRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/admin", adminRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Start server
async function start() {
  const isClusterMode = process.env.ENABLE_CLUSTER === "true";

  if (isClusterMode) {
    const isPrimary = cluster.isPrimary || (cluster as any).isMaster;

    if (isPrimary) {
      console.log(`🚀 Primary server process ${process.pid} is running`);
      try {
        await initDb();
        console.log("Database initialized. Forking workers...");

        // Fork workers based on CPU core availability (cap at 4 for local safety)
        const numCPUs = os.cpus().length || 2;
        const workersCount = Math.min(numCPUs, 4);
        console.log(`Starting ${workersCount} cluster workers...`);

        for (let i = 0; i < workersCount; i++) {
          cluster.fork();
        }

        cluster.on("exit", (worker) => {
          console.log(`Worker process ${worker.process.pid} died. Forking a new one...`);
          cluster.fork();
        });
      } catch (err) {
        console.error("Failed to initialize database on primary process:", err);
        process.exit(1);
      }
    } else {
      // Worker processes run the Express server
      app.listen(PORT, () => {
        console.log(`🚀 Worker process ${process.pid} listening on http://localhost:${PORT}`);
      });
    }
  } else {
    // Single instance mode (default)
    try {
      await initDb();
      app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
      });
    } catch (err) {
      console.error("Failed to start server:", err);
      process.exit(1);
    }
  }
}

start();
