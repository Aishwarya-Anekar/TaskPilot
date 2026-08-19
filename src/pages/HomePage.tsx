import { ArrowRight, FileText, Search, Shield, LayoutGrid, Calendar, MessageSquare, ListTodo, FileSpreadsheet } from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import heroIllustration from "@/assets/hero-illustration.png";
import { PageTransition } from "@/components/motion/PageTransition";
import { AnimatedCard } from "@/components/motion/AnimatedCard";
import { StaggeredList, StaggeredItem } from "@/components/motion/StaggeredList";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { formatDistanceToNow } from "date-fns";

const statusColors: Record<string, string> = {
  "In Progress": "bg-info/10 text-info",
  "Resolved": "bg-success/10 text-success",
  "Completed": "bg-success/10 text-success",
  "Fixed": "bg-success/10 text-success",
  "Under Review": "bg-warning/10 text-warning",
  "Pending": "bg-secondary text-muted-foreground",
  "Reported": "bg-warning/10 text-warning",
  "Rejected": "bg-destructive/10 text-destructive",
};

interface LatestUpdate {
  id: number;
  title: string;
  short_desc: string;
  status: string;
  created_at: string;
}

interface StatsData {
  total: number;
  solved_percent: number;
  pending: number;
  rejected: number; // mapped to total events for simplicity
  total_events?: number;
  total_departments?: number;
  total_employees?: number;
}

export default function HomePage() {
  const { user } = useAuth();
  const role = user?.role || "employee";

  const { data: latestUpdates = [] } = useQuery<LatestUpdate[]>({
    queryKey: ["latestTasks"],
    queryFn: () => apiGet("/tasks/latest"),
  });

  const { data: stats } = useQuery<StatsData>({
    queryKey: ["dashboardStats"],
    queryFn: () => apiGet("/admin/stats"),
  });

  // Role-specific customizations
  const getRoleDisplay = () => {
    switch (role) {
      case "super_admin":
        return {
          title: "Super Admin",
          desc: "Manage organizations settings, administrators registry, and track overall system audit trails.",
          actionText: "Manage Settings",
          actionPath: "/admin",
          actions: [
            { title: "System Logs", desc: "View security logs & system audits", icon: Shield, path: "/admin?tab=logs", color: "btn-gradient-accent" },
            { title: "Organization Toggles", desc: "Configure global system flags", icon: LayoutGrid, path: "/admin?tab=settings", color: "bg-info" },
            { title: "Manage Admins", desc: "Register and audit platform admins", icon: FileSpreadsheet, path: "/admin?tab=employees", color: "btn-gradient" },
          ],
        };
      case "admin":
        return {
          title: "Operations Admin",
          desc: "Orchestrate events, create workflows, book core resources, and track progress dashboard.",
          actionText: "Create Event",
          actionPath: "/report",
          actions: [
            { title: "Create Task/Event", desc: "Initialize workflow assignments", icon: FileText, path: "/report", color: "btn-gradient" },
            { title: "Resource Bookings", desc: "Manage conference rooms & tech tools", icon: Calendar, path: "/admin?tab=resources", color: "bg-info" },
            { title: "Employees Register", desc: "Manage departments & user roles", icon: FileSpreadsheet, path: "/admin?tab=employees", color: "btn-gradient-accent" },
          ],
        };
      case "dept_head":
        return {
          title: "Department Head",
          desc: `Manage ${user?.department || "your"} department tasks, audit subtask checklists, and review work logs.`,
          actionText: "Verify Submissions",
          actionPath: "/track",
          actions: [
            { title: "Task Board", desc: "Audit department workflows", icon: ListTodo, path: "/track", color: "btn-gradient-accent" },
            { title: "Team Announcements", desc: "Broadcast department alerts", icon: MessageSquare, path: "/communication", color: "btn-gradient" },
            { title: "Review Progress", desc: "Track employee timesheets & logs", icon: Search, path: "/track", color: "bg-info" },
          ],
        };
      case "employee":
      default:
        return {
          title: "Team Member",
          desc: "Access your assigned tasks, update subtask checklists, upload proofs, and collaborate with your head.",
          actionText: "My Tasks Board",
          actionPath: "/track",
          actions: [
            { title: "My Tasks", desc: "View task details and due dates", icon: ListTodo, path: "/track", color: "btn-gradient" },
            { title: "Team Chat", desc: "Discussions and group messaging", icon: MessageSquare, path: "/communication", color: "btn-gradient-accent" },
            { title: "Mark Attendance", desc: "Scan event QR codes for attendance", icon: Calendar, path: "/profile", color: "bg-info" },
          ],
        };
    }
  };

  const dashboardInfo = getRoleDisplay();

  const renderStats = () => {
    if (role === "super_admin") {
      return [
        { label: "Active Events", value: stats?.rejected ?? 0, color: "text-foreground" },
        { label: "Task Completion", value: `${stats?.solved_percent ?? 0}%`, color: "text-success" },
        { label: "Registered Admins", value: stats?.total_employees ?? 0, color: "text-info" },
      ];
    } else if (role === "admin") {
      return [
        { label: "Total Events", value: stats?.rejected ?? 0, color: "text-foreground" },
        { label: "Active Tasks", value: stats?.pending ?? 0, color: "text-warning" },
        { label: "Completion Rate", value: `${stats?.solved_percent ?? 0}%`, color: "text-success" },
      ];
    } else if (role === "dept_head") {
      return [
        { label: "Department Tasks", value: stats?.total ?? 0, color: "text-foreground" },
        { label: "Pending Approvals", value: stats?.pending ?? 0, color: "text-warning" },
        { label: "Task Solved Rate", value: `${stats?.solved_percent ?? 0}%`, color: "text-success" },
      ];
    } else {
      // Employee
      return [
        { label: "My Assigned Tasks", value: stats?.pending ?? 0, color: "text-warning" },
        { label: "Tasks Finished", value: stats?.total ? Math.round(stats.total * (stats.solved_percent / 100)) : 0, color: "text-success" },
        { label: "Completion Percentage", value: `${stats?.solved_percent ?? 0}%`, color: "text-success" },
      ];
    }
  };

  const activeStats = renderStats();

  return (
    <PageTransition>
      <div className="space-y-8">
        {/* Hero */}
        <AnimatedCard className="bg-card rounded-xl card-elevated p-6 md:p-10 flex flex-col md:flex-row items-center gap-8">
          <div className="flex-1 space-y-4">
            <div className="space-y-1.5">
              <span className="text-xs font-semibold bg-accent/10 text-accent px-3 py-1 rounded-full capitalize">
                {dashboardInfo.title}
              </span>
              <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground leading-tight">
                Welcome back, <span className="text-accent">{user?.name?.split(" ")[0] || "User"}</span>!
              </h1>
            </div>
            <p className="text-muted-foreground max-w-lg leading-relaxed text-sm">
              {dashboardInfo.desc}
            </p>
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="pt-2">
              <Link
                to={dashboardInfo.actionPath}
                className="inline-flex items-center gap-2 btn-gradient-accent text-accent-foreground px-6 py-3 rounded-lg font-semibold shadow-lg shadow-accent/20 transition-shadow hover:shadow-xl hover:shadow-accent/30 text-sm"
              >
                {dashboardInfo.actionText} <ArrowRight size={16} />
              </Link>
            </motion.div>
          </div>
          <motion.img
            src={heroIllustration}
            alt="TaskPilot orchestration dashboard illustration"
            width={320}
            height={240}
            className="w-64 md:w-80"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          />
        </AnimatedCard>

        {/* Stats */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Workspace Analytics</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {activeStats.map((stat, i) => (
              <AnimatedCard key={stat.label} delay={i * 0.08} className="bg-card rounded-xl card-elevated p-5">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">{stat.label}</p>
                <motion.p
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 200, delay: 0.2 + i * 0.1 }}
                  className={`text-3xl font-bold mt-1.5 ${stat.color}`}
                >
                  {stat.value}
                </motion.p>
              </AnimatedCard>
            ))}
          </div>
        </section>

        {/* Quick Actions */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Quick Orchestration Actions</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {dashboardInfo.actions.map((a, i) => (
              <AnimatedCard key={a.title} delay={i * 0.08} className="bg-card rounded-xl card-shadow p-6 group cursor-pointer hover:card-shadow-hover transition-all duration-300">
                <Link to={a.path} className="block">
                  <div className={`w-11 h-11 ${a.color} rounded-lg flex items-center justify-center mb-4 transition-transform group-hover:scale-110 duration-200`}>
                    <a.icon size={20} className="text-primary-foreground" />
                  </div>
                  <h3 className="font-semibold text-sm text-foreground mb-1 group-hover:text-accent transition-colors">{a.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{a.desc}</p>
                </Link>
              </AnimatedCard>
            ))}
          </div>
        </section>

        {/* Latest Activity Updates */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Latest Workspace Updates</h2>
          <div className="bg-card rounded-xl card-shadow divide-y divide-border overflow-hidden">
            {latestUpdates.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                No active updates or tasks assigned. You are all caught up!
              </div>
            ) : (
              <StaggeredList>
                {latestUpdates.map((u) => (
                  <StaggeredItem key={u.id}>
                    <Link to={`/track/${u.id}`} className="block">
                      <div className="p-4 md:p-5 flex items-center justify-between gap-4 hover:bg-secondary/50 transition-colors duration-200">
                        <div className="min-w-0">
                          <h4 className="font-medium text-sm text-foreground truncate">{u.title}</h4>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{u.short_desc}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">
                            Updated {formatDistanceToNow(new Date(u.created_at), { addSuffix: true })}
                          </p>
                        </div>
                        <motion.span
                          initial={{ scale: 0.8 }}
                          animate={{ scale: 1 }}
                          className={`text-[10px] font-semibold tracking-wider uppercase px-2.5 py-1 rounded-full whitespace-nowrap ${statusColors[u.status] || "bg-secondary text-secondary-foreground"}`}
                        >
                          {u.status}
                        </motion.span>
                      </div>
                    </Link>
                  </StaggeredItem>
                ))}
              </StaggeredList>
            )}
          </div>
        </section>
      </div>
    </PageTransition>
  );
}
