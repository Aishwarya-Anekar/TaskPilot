import { useState } from "react";
import { Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageTransition } from "@/components/motion/PageTransition";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import { toast } from "sonner";

interface TemplateTask {
  id?: number;
  title: string;
  description: string;
  priority: string;
  checklist: string[];
  relative_due_hours?: number;
  responsible_role?: string;
  responsible_department_id?: number | null;
}

interface EventTemplate {
  id: number;
  name: string;
  description: string;
  event_category?: string;
  default_location?: string;
  default_duration_minutes: number;
  is_active?: boolean;
  tasks: TemplateTask[];
}

const emptyTask = (): TemplateTask => ({
  title: "",
  description: "",
  priority: "Medium",
  checklist: [""],
  relative_due_hours: 24,
  responsible_role: "",
  responsible_department_id: null,
});

export default function EventTemplatesPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [eventCategory, setEventCategory] = useState("Department Meeting");
  const [defaultLocation, setDefaultLocation] = useState("");
  const [duration, setDuration] = useState("120");
  const [isActive, setIsActive] = useState(true);
  const [tasks, setTasks] = useState<TemplateTask[]>([emptyTask()]);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: templates = [], isLoading } = useQuery<EventTemplate[]>({
    queryKey: ["eventTemplates"],
    queryFn: () => apiGet("/templates"),
  });

  const updateTask = (index: number, field: keyof TemplateTask, value: string | number | string[] | null) => {
    setTasks((current) => current.map((task, i) => (i === index ? { ...task, [field]: value } : task)));
  };

  const addTask = () => setTasks((current) => [...current, emptyTask()]);
  const removeTask = (index: number) => setTasks((current) => (current.length === 1 ? [emptyTask()] : current.filter((_, i) => i !== index)));

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setDescription("");
    setEventCategory("Department Meeting");
    setDefaultLocation("");
    setDuration("120");
    setIsActive(true);
    setTasks([emptyTask()]);
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        description,
        event_category: eventCategory,
        default_duration_minutes: Number(duration) || 120,
        default_location: defaultLocation,
        is_active: isActive,
        tasks: tasks.map((task) => ({
          title: task.title,
          description: task.description,
          priority: task.priority,
          checklist: task.checklist.filter((item) => item.trim()),
          relative_due_hours: Number(task.relative_due_hours) || 24,
          responsible_role: task.responsible_role || null,
          responsible_department_id: task.responsible_department_id || null,
        })),
      };
      return editingId ? apiPut(`/templates/${editingId}`, body) : apiPost("/templates", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["eventTemplates"] });
      resetForm();
      toast.success("Event template saved");
    },
    onError: (error: any) => toast.error(error.message || "Failed to save template"),
  });

  const remove = async (id: number) => {
    try {
      await apiDelete(`/templates/${id}`);
      queryClient.invalidateQueries({ queryKey: ["eventTemplates"] });
      toast.success("Template deleted");
    } catch (error: any) {
      toast.error(error.message || "Failed to delete template");
    }
  };

  const duplicate = async (id: number) => {
    try {
      await apiPost(`/templates/${id}/duplicate`, {});
      queryClient.invalidateQueries({ queryKey: ["eventTemplates"] });
      toast.success("Template duplicated");
    } catch (error: any) {
      toast.error(error.message || "Failed to duplicate template");
    }
  };

  const edit = (template: EventTemplate) => {
    setEditingId(template.id);
    setName(template.name);
    setDescription(template.description || "");
    setEventCategory(template.event_category || "Department Meeting");
    setDefaultLocation(template.default_location || "");
    setDuration(String(template.default_duration_minutes || 120));
    setIsActive(template.is_active ?? true);
    setTasks(
      template.tasks && template.tasks.length
        ? template.tasks.map((task) => ({
            ...task,
            checklist: task.checklist && task.checklist.length ? task.checklist : [""],
          }))
        : [emptyTask()]
    );
  };

  return (
    <PageTransition>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <p className="text-sm text-accent font-semibold">Reusable workflows</p>
          <h1 className="text-2xl font-bold text-foreground">Event Templates</h1>
          <p className="text-xs text-muted-foreground mt-1">Build repeatable event structures with multiple default tasks and checklists.</p>
        </div>

        <div className="grid lg:grid-cols-5 gap-6">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
            className="lg:col-span-2 bg-card rounded-xl card-elevated p-5 space-y-4"
          >
            <h2 className="font-bold text-sm text-foreground">{editingId ? "Edit template" : "Create template"}</h2>

            <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Template name" className="w-full px-3 py-2.5 rounded-lg input-focus text-sm text-foreground" />
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" rows={3} className="w-full px-3 py-2.5 rounded-lg input-focus text-sm text-foreground resize-none" />

            <div className="grid gap-3 sm:grid-cols-2">
              <select value={eventCategory} onChange={(event) => setEventCategory(event.target.value)} className="w-full px-3 py-2.5 rounded-lg input-focus text-sm text-foreground">
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
                ].map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <input type="number" min="1" value={duration} onChange={(event) => setDuration(event.target.value)} placeholder="Duration minutes" className="w-full px-3 py-2.5 rounded-lg input-focus text-sm text-foreground" />
            </div>

            <input value={defaultLocation} onChange={(event) => setDefaultLocation(event.target.value)} placeholder="Default meeting or room location" className="w-full px-3 py-2.5 rounded-lg input-focus text-sm text-foreground" />

            <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-sm text-foreground">
              <span>Template active</span>
              <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} className="h-4 w-4 accent-blue-600" />
            </label>

            <div className="space-y-3 border-t border-border pt-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Default tasks</p>
                <button type="button" onClick={addTask} className="inline-flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-secondary">
                  <Plus size={14} /> Add task
                </button>
              </div>

              {tasks.map((task, index) => (
                <div key={`${index}-${task.title || "new"}`} className="space-y-3 rounded-xl border border-border bg-secondary/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Task {index + 1}</span>
                    <button type="button" onClick={() => removeTask(index)} className="text-destructive hover:text-red-500 text-xs">Remove</button>
                  </div>

                  <input value={task.title} onChange={(event) => updateTask(index, "title", event.target.value)} placeholder="Task title" className="w-full px-3 py-2.5 rounded-lg input-focus text-sm text-foreground" />
                  <textarea value={task.description} onChange={(event) => updateTask(index, "description", event.target.value)} rows={2} placeholder="Task description" className="w-full px-3 py-2.5 rounded-lg input-focus text-sm text-foreground resize-none" />

                  <div className="grid sm:grid-cols-2 gap-3">
                    <select value={task.priority} onChange={(event) => updateTask(index, "priority", event.target.value)} className="w-full px-3 py-2.5 rounded-lg input-focus text-sm text-foreground">
                      <option>Low</option>
                      <option>Medium</option>
                      <option>High</option>
                      <option>Urgent</option>
                    </select>
                    <input type="number" min="1" value={task.relative_due_hours ?? 24} onChange={(event) => updateTask(index, "relative_due_hours", Number(event.target.value) || 24)} className="w-full px-3 py-2.5 rounded-lg input-focus text-sm text-foreground" placeholder="Due offset hours" />
                  </div>

                  <input value={task.responsible_role || ""} onChange={(event) => updateTask(index, "responsible_role", event.target.value)} placeholder="Responsible role or department" className="w-full px-3 py-2.5 rounded-lg input-focus text-sm text-foreground" />

                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Checklist items</label>
                    <textarea
                      rows={3}
                      value={task.checklist.join("\n")}
                      onChange={(event) => updateTask(index, "checklist", event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))}
                      placeholder="One checklist item per line"
                      className="w-full px-3 py-2.5 rounded-lg input-focus text-sm text-foreground resize-none"
                    />
                  </div>
                </div>
              ))}
            </div>

            <button disabled={save.isPending} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg btn-gradient text-primary-foreground text-sm font-semibold">
              {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} {editingId ? "Save changes" : "Create template"}
            </button>
            {editingId && (
              <button type="button" onClick={resetForm} className="w-full text-xs text-muted-foreground hover:text-foreground">
                Cancel editing
              </button>
            )}
          </form>

          <div className="lg:col-span-3 space-y-3">
            {isLoading && <p className="text-sm text-muted-foreground">Loading templates...</p>}
            {!isLoading && templates.length === 0 && (
              <div className="bg-card border border-dashed border-border rounded-xl p-10 text-center text-sm text-muted-foreground">
                No templates created yet.
              </div>
            )}
            {templates.map((template) => (
              <div key={template.id} className="bg-card rounded-xl card-elevated p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-bold text-foreground">{template.name}</h2>
                    <p className="text-xs text-muted-foreground mt-1">
                      {template.event_category || "Other"} · {template.default_duration_minutes} min · {template.is_active === false ? "Inactive" : "Active"}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button title="Edit template" onClick={() => edit(template)} className="px-2 py-1 rounded-lg hover:bg-secondary text-xs text-muted-foreground">Edit</button>
                    <button title="Duplicate template" onClick={() => duplicate(template.id)} className="p-2 rounded-lg hover:bg-secondary text-muted-foreground"><Copy size={16} /></button>
                    <button title="Delete template" onClick={() => remove(template.id)} className="p-2 rounded-lg hover:bg-destructive/10 text-destructive"><Trash2 size={16} /></button>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {template.tasks && template.tasks.length > 0 ? (
                    template.tasks.map((task, idx) => (
                      <div key={`${template.id}-${idx}-${task.title || "task"}`} className="bg-secondary/40 rounded-lg p-3">
                        <div className="flex justify-between text-xs">
                          <span className="font-semibold text-foreground">{task.title}</span>
                          <span className="text-muted-foreground">{task.priority}</span>
                        </div>
                        {task.description && <p className="text-[11px] text-muted-foreground mt-1">{task.description}</p>}
                        {task.checklist && task.checklist.length > 0 && (
                          <p className="text-[11px] text-muted-foreground mt-1">Checklist: {task.checklist.join(", ")}</p>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No default tasks configured.</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
