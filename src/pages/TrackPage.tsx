import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageTransition } from "@/components/motion/PageTransition";
import { apiDelete, apiGet } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
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
  is_overdue: boolean;
  event_title: string | null;
  assigned_to_name: string | null;
  assigned_dept_name: string | null;
}

interface EventItem {
  id: number;
  title: string;
}

interface EventDetail extends EventItem {
  description?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string;
  coordinator_name?: string | null;
  task_stats?: {
    total_tasks: number;
    completed_tasks: number;
    pending_tasks: number;
    under_review_tasks: number;
    overdue_tasks: number;
    completion_percent: number;
  };
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
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const initialStatus = searchParams.get("status") || "All";
    return tabs.includes(initialStatus) ? initialStatus : "All";
  });
  const [selectedEventId, setSelectedEventId] = useState(searchParams.get("event_id") || "");
  const [deletingEvent, setDeletingEvent] = useState(false);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";

  const { data: events = [] } = useQuery<EventItem[]>({
    queryKey: ["allEventsForFilter"],
    queryFn: () => apiGet("/tasks/events/all"),
  });

  const { data: selectedEvent } = useQuery<EventDetail | null>({
    queryKey: ["eventDetails", selectedEventId],
    queryFn: () => apiGet<EventDetail>(`/tasks/events/${selectedEventId}`),
    enabled: !!selectedEventId,
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

  const handleDeleteEvent = async () => {
    if (!selectedEventId) return;
    const event = selectedEvent ?? events.find((item) => String(item.id) === String(selectedEventId)) as EventDetail | undefined;
    if (!event) return;
    if (!window.confirm(`Delete event "${event.title}"? This will remove it from active listings while preserving task records and audit history.`)) {
      return;
    }

    setDeletingEvent(true);
    try {
      await apiDelete(`/tasks/events/${selectedEventId}`);
      setSelectedEventId("");
      await queryClient.invalidateQueries({ queryKey: ["allEventsForFilter"] });
      await queryClient.invalidateQueries({ queryKey: ["myTasksList"] });
      toast({ title: "Event deleted", description: `${event.title} was removed from active event listings.`, variant: "default" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete event";
      toast({ title: "Delete failed", description: message, variant: "destructive" });
    } finally {
      setDeletingEvent(false);
    }
  };

  const handleDeleteTask = async (taskId: number, taskTitle: string) => {
    if (!window.confirm(`Delete task "${taskTitle}"? This will remove it from active task listings while leaving the parent event and other tasks unchanged.`)) {
      return;
    }

    try {
      await apiDelete(`/tasks/${taskId}`);
      await queryClient.invalidateQueries({ queryKey: ["myTasksList"] });
      await queryClient.invalidateQueries({ queryKey: ["taskDetails"] });
      toast({ title: "Task deleted", description: `${taskTitle} was removed from active listings.`, variant: "default" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete task";
      toast({ title: "Delete failed", description: message, variant: "destructive" });
    }
  };

  return (
    <PageTransition>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-foreground">Events & Tasks</h1>

          <div className="flex items-center gap-2 flex-wrap justify-end">
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
            {isSuperAdmin && selectedEventId && (
              <button
                type="button"
                onClick={handleDeleteEvent}
                disabled={deletingEvent}
                className="rounded-lg border border-destructive/60 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deletingEvent ? "Deleting..." : "Delete Event"}
              </button>
            )}
          </div>
        </div>

        {selectedEvent && (
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Selected event</p>
                <h2 className="mt-1 text-lg font-semibold text-foreground">{selectedEvent.title}</h2>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${statusColors[selectedEvent.status] || "bg-secondary text-foreground"}`}>
                  {selectedEvent.status}
                </span>
                {isSuperAdmin && (
                  <button
                    type="button"
                    onClick={handleDeleteEvent}
                    disabled={deletingEvent}
                    className="rounded-lg border border-destructive/60 bg-destructive/10 px-3 py-2 text-[11px] font-semibold text-destructive disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deletingEvent ? "Deleting..." : "Delete Event"}
                  </button>
                )}
              </div>
            </div>
            <div className="mt-3 grid gap-3 text-xs text-muted-foreground sm:grid-cols-2 md:grid-cols-4">
              <div><span className="font-semibold text-foreground">Date:</span> {selectedEvent.start_date ? new Date(selectedEvent.start_date).toLocaleString() : "Not set"}</div>
              <div><span className="font-semibold text-foreground">Location:</span> {selectedEvent.location || "Not set"}</div>
              <div><span className="font-semibold text-foreground">Coordinator:</span> {selectedEvent.coordinator_name || "Unassigned"}</div>
              <div><span className="font-semibold text-foreground">Linked tasks:</span> {selectedEvent.task_stats?.total_tasks ?? 0}</div>
            </div>
          </div>
        )}

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
                        {task.is_overdue && <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded bg-destructive/10 text-destructive">Overdue</span>}
                      </div>
                      <h3 className="font-semibold text-sm text-foreground">
                        {task.title}
                      </h3>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-1 leading-relaxed">{task.description}</p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground mt-2">
                        <p>Assignee: <span className="font-semibold text-foreground">{task.assigned_to_name || "Unassigned"}</span></p>
                        <p>Department: <span className="font-semibold text-foreground">{task.assigned_dept_name || "Unassigned"}</span></p>
                        {task.due_date && (
                          <p>Due: <span className="font-semibold text-foreground">{new Date(task.due_date).toLocaleString()}</span></p>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-center">
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
                      {isSuperAdmin && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void handleDeleteTask(task.id, task.title);
                          }}
                          className="cursor-pointer rounded-lg border border-destructive/60 bg-destructive/10 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-destructive transition-colors hover:bg-destructive/15"
                        >
                          Delete Task
                        </button>
                      )}
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
