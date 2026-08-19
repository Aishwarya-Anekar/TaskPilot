import { useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { PageTransition } from "@/components/motion/PageTransition";
import { apiGet } from "@/lib/api";
import { formatDistanceToNow } from "date-fns";

const tabs = ["All", "Pending", "In Progress", "Under Review", "Completed"];

interface Task {
  id: number;
  title: string;
  description: string;
  status: string;
  progress: number;
  priority: string;
  due_date: string;
  event_title: string | null;
  assigned_to_name: string | null;
  assigned_dept_name: string | null;
}

interface EventItem {
  id: number;
  title: string;
}

const statusColors: Record<string, string> = {
  "In Progress": "bg-info/10 text-info",
  "Completed": "bg-success/10 text-success",
  "Under Review": "bg-warning/10 text-warning",
  "Pending": "bg-secondary text-muted-foreground",
  "Rejected": "bg-destructive/10 text-destructive",
};

const progressColors: Record<string, string> = {
  "In Progress": "bg-info",
  "Completed": "bg-success",
  "Under Review": "bg-warning",
  "Pending": "bg-secondary-foreground/20",
  "Rejected": "bg-destructive",
};

export default function TrackPage() {
  const [activeTab, setActiveTab] = useState("All");
  const [selectedEventId, setSelectedEventId] = useState("");

  const { data: events = [] } = useQuery<EventItem[]>({
    queryKey: ["allEventsForFilter"],
    queryFn: () => apiGet("/tasks/events/all"),
  });

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ["myTasksList", activeTab, selectedEventId],
    queryFn: () => {
      let url = `/tasks?status=${activeTab}`;
      if (selectedEventId) {
        url += `&event_id=${selectedEventId}`;
      }
      return apiGet(url);
    },
  });

  return (
    <PageTransition>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-foreground">Events & Tasks</h1>
          
          {/* Event Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Filter Event:</span>
            <select
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
              className="text-xs font-medium px-3 py-2 rounded-lg bg-card border border-border text-foreground focus:outline-none cursor-pointer shadow-sm"
            >
              <option value="">All Events</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.title}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Tabs */}
        <LayoutGroup>
          <div className="flex flex-wrap gap-2">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200 ${
                  activeTab === t ? "text-primary-foreground" : "bg-card text-foreground hover:bg-secondary card-shadow"
                }`}
              >
                {activeTab === t && (
                  <motion.div
                    layoutId="tab-active"
                    className="absolute inset-0 btn-gradient rounded-lg shadow-md"
                    transition={{ type: "spring", stiffness: 350, damping: 30 }}
                  />
                )}
                <span className="relative z-10">{t}</span>
              </button>
            ))}
          </div>
        </LayoutGroup>

        {/* Task List */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`${activeTab}-${selectedEventId}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="space-y-3"
          >
            {isLoading ? (
              <div className="bg-card rounded-xl card-shadow p-8 text-center text-muted-foreground text-sm">
                Loading tasks database...
              </div>
            ) : tasks.length === 0 ? (
              <div className="bg-card rounded-xl card-shadow p-8 text-center text-muted-foreground text-sm">
                No active tasks found matching this criteria.
              </div>
            ) : (
              tasks.map((task, i) => (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  whileHover={{ y: -1 }}
                  className="bg-card rounded-xl card-shadow p-5 hover:card-shadow-hover transition-shadow border-l-4 border-l-primary"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <span className="text-[10px] font-bold tracking-wider uppercase bg-secondary text-foreground px-2 py-0.5 rounded">
                          {task.event_title || "General Event"}
                        </span>
                        <span className={`text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded ${
                          task.priority === "High" ? "bg-destructive/10 text-destructive" : task.priority === "Medium" ? "bg-warning/10 text-warning" : "bg-success/10 text-success"
                        }`}>
                          {task.priority} Priority
                        </span>
                      </div>
                      <h3 className="font-semibold text-sm text-foreground">
                        {task.title}
                      </h3>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-1 leading-relaxed">{task.description}</p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground mt-2">
                        {task.assigned_to_name && (
                          <p>Assignee: <span className="font-semibold text-foreground">{task.assigned_to_name}</span></p>
                        )}
                        {task.assigned_dept_name && (
                          <p>Department: <span className="font-semibold text-foreground">{task.assigned_dept_name}</span></p>
                        )}
                        {task.due_date && (
                          <p>Due: <span className="font-semibold text-foreground">{new Date(task.due_date).toLocaleString()}</span></p>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3 flex-shrink-0 self-end sm:self-center">
                      <motion.span
                        layout
                        className={`text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-full ${statusColors[task.status] || "bg-secondary"}`}
                      >
                        {task.status}
                      </motion.span>
                      <Link
                        to={`/track/${task.id}`}
                        className="text-xs font-semibold text-accent hover:underline flex items-center gap-1"
                      >
                        View Details →
                      </Link>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className="mt-3.5 h-1.5 bg-secondary rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${task.progress}%` }}
                      transition={{ duration: 0.8, delay: i * 0.05 + 0.2, ease: [0.22, 1, 0.36, 1] }}
                      className={`h-full rounded-full ${progressColors[task.status] || "bg-primary"}`}
                    />
                  </div>
                </motion.div>
              ))
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </PageTransition>
  );
}
