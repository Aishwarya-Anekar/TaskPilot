import { useState } from "react";
import { Loader2, Calendar, MapPin, AlignLeft, Info, HelpCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { PageTransition } from "@/components/motion/PageTransition";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface EventItem {
  id: number;
  title: string;
}

interface Department {
  id: number;
  name: string;
}

interface Employee {
  id: number;
  name: string;
  role: string;
  department: string | null;
}

interface EventTemplate {
  id: number;
  name: string;
  description: string;
  event_category?: string;
  default_location?: string;
  default_duration_minutes: number;
  tasks: { title: string }[];
}

export default function ReportPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "super_admin";
  const isDeptHead = user?.role === "dept_head";
  const isEmployee = user?.role === "employee";

  // Tab: 'event' or 'task'
  const [formType, setFormType] = useState<"event" | "task">(isAdmin ? "event" : "task");
  const [submitting, setSubmitting] = useState(false);

  // Event Form State
  const [eventTitle, setEventTitle] = useState("");
  const [eventCategory, setEventCategory] = useState("Department Meeting");
  const [eventDepartmentId, setEventDepartmentId] = useState("");
  const [eventDesc, setEventDesc] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [eventStart, setEventStart] = useState("");
  const [eventEnd, setEventEnd] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [recurrenceType, setRecurrenceType] = useState("");
  const [recurrenceInterval, setRecurrenceInterval] = useState("1");
  const [recurrenceUntil, setRecurrenceUntil] = useState("");
  const [eventApprovalRequired, setEventApprovalRequired] = useState(false);
  const [eventStatus, setEventStatus] = useState("Draft");

  // Task Form State
  const [taskTitle, setTaskTitle] = useState("");
  const [taskCategory, setTaskCategory] = useState("Administrative Work");
  const [taskDesc, setTaskDesc] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [taskPriority, setTaskPriority] = useState("Medium");
  const [assignType, setAssignType] = useState<"dept" | "user">("dept");
  const [assignedDeptId, setAssignedDeptId] = useState<string>("");
  const [assignedUserId, setAssignedUserId] = useState<string>("");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [verificationRequired, setVerificationRequired] = useState(false);

  // Fetch options
  const { data: events = [] } = useQuery<EventItem[]>({
    queryKey: ["allEvents"],
    queryFn: () => apiGet("/tasks/events/all"),
    enabled: !isEmployee,
  });

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["allDepartments"],
    queryFn: () => apiGet("/admin/departments"),
    enabled: !isEmployee,
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["allEmployees"],
    queryFn: () => apiGet("/admin/employees"),
    enabled: !isEmployee,
  });

  const { data: templates = [] } = useQuery<EventTemplate[]>({
    queryKey: ["eventTemplates"],
    queryFn: () => apiGet("/templates"),
    enabled: isAdmin,
  });

  // Handle Submit Event
  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventTitle.trim()) {
      toast.error("Please provide an event title");
      return;
    }
    if (!eventStart || !eventEnd) {
      toast.error("Please provide both start and end times for the event");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        title: eventTitle,
        category: eventCategory,
        department_id: eventDepartmentId ? Number(eventDepartmentId) : undefined,
        description: eventDesc,
        location: eventLocation,
        start_date: eventStart || undefined,
        end_date: eventEnd || undefined,
        status: eventStatus,
        approval_required: eventApprovalRequired,
        approval_status: eventApprovalRequired ? "Pending Approval" : "Not Required",
        recurrence_type: recurrenceType || undefined,
        recurrence_interval: recurrenceType ? Number(recurrenceInterval) : undefined,
        recurrence_until: recurrenceUntil || undefined,
      };
      if (selectedTemplateId) await apiPost(`/templates/${selectedTemplateId}/generate`, payload);
      else await apiPost("/tasks/events", payload);
      toast.success("Event created successfully");
      navigate("/report/success");
    } catch (err: any) {
      toast.error(err.message || "Failed to create event");
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Submit Task
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim() || !selectedEventId) {
      toast.error("Please provide task title and select an event");
      return;
    }
    setSubmitting(true);
    try {
      await apiPost("/tasks", {
        event_id: parseInt(selectedEventId),
        title: taskTitle,
        category: taskCategory,
        description: taskDesc,
        assigned_to_id: assignType === "user" && assignedUserId ? parseInt(assignedUserId) : undefined,
        assigned_dept_id: assignType === "dept" && assignedDeptId ? parseInt(assignedDeptId) : undefined,
        priority: taskPriority,
        due_date: taskDueDate || undefined,
        verification_required: verificationRequired,
      });
      toast.success("Task created and assigned successfully");
      navigate("/report/success");
    } catch (err: any) {
      toast.error(err.message || "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  };

  if (isEmployee) {
    return (
      <PageTransition>
        <div className="max-w-md mx-auto text-center py-20 bg-card rounded-xl card-elevated p-8">
          <Info size={40} className="text-warning mx-auto mb-4" />
          <h1 className="text-xl font-bold text-foreground mb-2">Access Denied</h1>
          <p className="text-sm text-muted-foreground">
            Only administrators and department heads have permission to plan events and orchestrate tasks.
          </p>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="max-w-2xl mx-auto">
        <div className="bg-card rounded-xl card-elevated p-6 md:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Orchestrate Workflow</h1>
              <p className="text-xs text-muted-foreground mt-0.5">Plan organizational activities and assign responsibilities</p>
            </div>
            {isAdmin && (
              <div className="flex bg-secondary p-1 rounded-lg self-start sm:self-center">
                <button
                  type="button"
                  onClick={() => setFormType("event")}
                  className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${
                    formType === "event" ? "btn-gradient text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Create Event
                </button>
                <button
                  type="button"
                  onClick={() => setFormType("task")}
                  className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${
                    formType === "task" ? "btn-gradient text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Create Task
                </button>
              </div>
            )}
          </div>

          <AnimatePresence mode="wait">
            {formType === "event" ? (
              <motion.form
                key="event-form"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                onSubmit={handleCreateEvent}
                className="space-y-5"
              >
                {/* Event Title */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Event Title</label>
                  <input
                    type="text"
                    value={eventTitle}
                    onChange={(e) => setEventTitle(e.target.value)}
                    placeholder="e.g., Annual Tech Summit 2026"
                    required
                    className="w-full px-4 py-2.5 rounded-lg input-focus text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Event Category</label>
                    <select value={eventCategory} onChange={(e) => setEventCategory(e.target.value)} className="w-full px-4 py-2.5 rounded-lg input-focus text-sm text-foreground focus:outline-none">
                      {[
                        "Department Meeting",
                        "Internal Examination",
                        "University Examination",
                        "College Festival or Technical Event",
                        "Faculty Training",
                        "Laboratory Inspection",
                        "Accreditation Documentation",
                        "Academic Activity",
                        "Administrative Work",
                        "Other",
                      ].map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Department</label>
                    <select value={eventDepartmentId} onChange={(e) => setEventDepartmentId(e.target.value)} className="w-full px-4 py-2.5 rounded-lg input-focus text-sm text-foreground focus:outline-none">
                      <option value="">College-wide</option>
                      {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Event Template</label>
                  <select value={selectedTemplateId} onChange={(e) => { const value = e.target.value; setSelectedTemplateId(value); const template = templates.find((item) => String(item.id) === value); if (template) { setEventTitle(template.name); setEventCategory(template.event_category || "Department Meeting"); setEventDesc(template.description || ""); setEventLocation(template.default_location || ""); } }} className="w-full px-4 py-2.5 rounded-lg input-focus text-sm text-foreground focus:outline-none">
                    <option value="">Start from scratch</option>
                    {templates.map((template) => <option key={template.id} value={template.id}>{template.name} ({template.tasks.length} tasks)</option>)}
                  </select>
                  {selectedTemplateId && <p className="text-[11px] text-muted-foreground mt-1">Tasks and checklists will be copied into this event. You can edit them after generation.</p>}
                </div>

                {/* Event Location */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Location</label>
                  <div className="relative">
                    <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      value={eventLocation}
                      onChange={(e) => setEventLocation(e.target.value)}
                      placeholder="e.g., Main Auditorium / Online"
                      className="w-full pl-10 pr-4 py-2.5 rounded-lg input-focus text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                    />
                  </div>
                </div>

                {/* Event Dates */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Start Date & Time</label>
                    <input
                      type="datetime-local"
                      value={eventStart}
                      onChange={(e) => setEventStart(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-lg input-focus text-sm text-foreground focus:outline-none cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">End Date & Time</label>
                    <input
                      type="datetime-local"
                      value={eventEnd}
                      onChange={(e) => setEventEnd(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-lg input-focus text-sm text-foreground focus:outline-none cursor-pointer"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div><label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Recurrence</label><select value={recurrenceType} onChange={(e) => setRecurrenceType(e.target.value)} className="w-full px-3 py-2.5 rounded-lg input-focus text-sm text-foreground"><option value="">One-time</option><option value="yearly">Yearly</option><option value="monthly">Monthly</option><option value="custom">Custom interval</option></select></div>
                  {recurrenceType && <><div><label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Every</label><input type="number" min="1" value={recurrenceInterval} onChange={(e) => setRecurrenceInterval(e.target.value)} className="w-full px-3 py-2.5 rounded-lg input-focus text-sm text-foreground" /></div><div><label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Repeat Until</label><input type="date" value={recurrenceUntil} onChange={(e) => setRecurrenceUntil(e.target.value)} className="w-full px-3 py-2.5 rounded-lg input-focus text-sm text-foreground" /></div></>}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Event Status</label>
                    <select value={eventStatus} onChange={(e) => setEventStatus(e.target.value)} className="w-full px-4 py-2.5 rounded-lg input-focus text-sm text-foreground focus:outline-none">
                      <option>Draft</option>
                      <option>Active</option>
                      <option>Completed</option>
                      <option>Cancelled</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <label className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-3 text-sm text-foreground">
                      <span>Requires approval</span>
                      <input type="checkbox" checked={eventApprovalRequired} onChange={(e) => setEventApprovalRequired(e.target.checked)} className="h-4 w-4 accent-blue-600" />
                    </label>
                  </div>
                </div>

                {/* Event Description */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Description</label>
                  <textarea
                    value={eventDesc}
                    onChange={(e) => setEventDesc(e.target.value)}
                    rows={4}
                    placeholder="Provide a summary of event goals, schedules, and coordinators..."
                    className="w-full px-4 py-2.5 rounded-lg input-focus text-sm text-foreground placeholder:text-muted-foreground focus:outline-none resize-none leading-relaxed"
                  />
                </div>

                {/* Actions */}
                <div className="flex justify-between pt-4 border-t border-border">
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    type="button"
                    onClick={() => navigate(-1)}
                    className="px-5 py-2.5 rounded-lg border border-border text-foreground hover:bg-secondary transition-colors text-xs font-semibold"
                  >
                    Cancel
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    type="submit"
                    disabled={submitting}
                    className="px-6 py-2.5 rounded-lg btn-gradient text-primary-foreground text-xs font-semibold shadow-md hover:shadow-lg transition-shadow disabled:opacity-70 flex items-center gap-2"
                  >
                    {submitting && <Loader2 size={14} className="animate-spin" />}
                    {submitting ? "Orchestrating..." : "Create Event"}
                  </motion.button>
                </div>
              </motion.form>
            ) : (
              <motion.form
                key="task-form"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                onSubmit={handleCreateTask}
                className="space-y-5"
              >
                {/* Linked Event selection */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Linked Event</label>
                  <select
                    value={selectedEventId}
                    onChange={(e) => setSelectedEventId(e.target.value)}
                    required
                    className="w-full px-4 py-2.5 rounded-lg input-focus text-sm text-foreground bg-background focus:outline-none cursor-pointer"
                  >
                    <option value="" disabled>Select parent event...</option>
                    {events.map((e) => (
                      <option key={e.id} value={e.id}>{e.title}</option>
                    ))}
                  </select>
                </div>

                {/* Task Title */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Task Title</label>
                  <input
                    type="text"
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    placeholder="e.g., Set up Auditorium Projector"
                    required
                    className="w-full px-4 py-2.5 rounded-lg input-focus text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Task Category</label>
                    <select value={taskCategory} onChange={(e) => setTaskCategory(e.target.value)} className="w-full px-4 py-2.5 rounded-lg input-focus text-sm text-foreground focus:outline-none">
                      {[
                        "Academic Work",
                        "Examination",
                        "Documentation",
                        "Meeting Preparation",
                        "Event Preparation",
                        "Laboratory Maintenance",
                        "Administrative Work",
                        "Student Activity",
                        "Other",
                      ].map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </div>
                  <div className="flex items-end">
                    <label className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-3 text-sm text-foreground">
                      <span>Verification required</span>
                      <input type="checkbox" checked={verificationRequired} onChange={(e) => setVerificationRequired(e.target.checked)} className="h-4 w-4 accent-blue-600" />
                    </label>
                  </div>
                </div>

                {/* Assignment Type */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Assign Responsibility To</label>
                    <div className="flex bg-secondary p-1 rounded-lg">
                      <button
                        type="button"
                        onClick={() => setAssignType("dept")}
                        className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-all ${
                          assignType === "dept" ? "btn-gradient text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Department
                      </button>
                      <button
                        type="button"
                        onClick={() => setAssignType("user")}
                        className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-all ${
                          assignType === "user" ? "btn-gradient text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Employee
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Selection</label>
                    {assignType === "dept" ? (
                      <select
                        value={assignedDeptId}
                        onChange={(e) => setAssignedDeptId(e.target.value)}
                        required
                        className="w-full px-4 py-2.5 rounded-lg input-focus text-sm text-foreground bg-background focus:outline-none cursor-pointer"
                      >
                        <option value="">Select department...</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    ) : (
                      <select
                        value={assignedUserId}
                        onChange={(e) => setAssignedUserId(e.target.value)}
                        required
                        className="w-full px-4 py-2.5 rounded-lg input-focus text-sm text-foreground bg-background focus:outline-none cursor-pointer"
                      >
                        <option value="">Select employee...</option>
                        {employees.map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.name} {emp.department ? `(${emp.department})` : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                {/* Priority & Due Date */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Task Priority</label>
                    <select
                      value={taskPriority}
                      onChange={(e) => setTaskPriority(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-lg input-focus text-sm text-foreground bg-background focus:outline-none cursor-pointer"
                    >
                      <option>High</option>
                      <option>Medium</option>
                      <option>Low</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Due Date & Time</label>
                    <input
                      type="datetime-local"
                      value={taskDueDate}
                      onChange={(e) => setTaskDueDate(e.target.value)}
                      required
                      className="w-full px-4 py-2.5 rounded-lg input-focus text-sm text-foreground focus:outline-none cursor-pointer"
                    />
                  </div>
                </div>

                {/* Task Description */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Task Description & Requirements</label>
                  <textarea
                    value={taskDesc}
                    onChange={(e) => setTaskDesc(e.target.value)}
                    rows={4}
                    placeholder="Describe the exact requirements and deliverables expected for this task..."
                    className="w-full px-4 py-2.5 rounded-lg input-focus text-sm text-foreground placeholder:text-muted-foreground focus:outline-none resize-none leading-relaxed"
                  />
                </div>

                {/* Actions */}
                <div className="flex justify-between pt-4 border-t border-border">
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    type="button"
                    onClick={() => navigate(-1)}
                    className="px-5 py-2.5 rounded-lg border border-border text-foreground hover:bg-secondary transition-colors text-xs font-semibold"
                  >
                    Cancel
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    type="submit"
                    disabled={submitting}
                    className="px-6 py-2.5 rounded-lg btn-gradient text-primary-foreground text-xs font-semibold shadow-md hover:shadow-lg transition-shadow disabled:opacity-70 flex items-center gap-2"
                  >
                    {submitting && <Loader2 size={14} className="animate-spin" />}
                    {submitting ? "Orchestrating..." : "Create & Assign"}
                  </motion.button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </div>
    </PageTransition>
  );
}
