import { useState } from "react";
import { Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageTransition } from "@/components/motion/PageTransition";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import { toast } from "sonner";

interface TemplateTask { title: string; description: string; priority: string; subtasks: string[]; }
interface EventTemplate { id: number; name: string; description: string; default_duration_minutes: number; tasks: TemplateTask[]; }

export default function EventTemplatesPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState("120");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPriority, setTaskPriority] = useState("Medium");
  const [subtasks, setSubtasks] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const { data: templates = [], isLoading } = useQuery<EventTemplate[]>({ queryKey: ["eventTemplates"], queryFn: () => apiGet("/templates") });
  const save = useMutation({
    mutationFn: () => { const body = { name, description, default_duration_minutes: Number(duration), tasks: taskTitle ? [{ title: taskTitle, priority: taskPriority, subtasks: subtasks.split(",").map((item) => item.trim()).filter(Boolean) }] : [] }; return editingId ? apiPut(`/templates/${editingId}`, body) : apiPost("/templates", body); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["eventTemplates"] }); setName(""); setDescription(""); setTaskTitle(""); setSubtasks(""); setEditingId(null); toast.success("Event template saved"); },
    onError: (error: any) => toast.error(error.message || "Failed to create template"),
  });
  const remove = async (id: number) => { try { await apiDelete(`/templates/${id}`); queryClient.invalidateQueries({ queryKey: ["eventTemplates"] }); toast.success("Template deleted"); } catch (error: any) { toast.error(error.message || "Failed to delete template"); } };
  const duplicate = async (id: number) => { try { await apiPost(`/templates/${id}/duplicate`, {}); queryClient.invalidateQueries({ queryKey: ["eventTemplates"] }); toast.success("Template duplicated"); } catch (error: any) { toast.error(error.message || "Failed to duplicate template"); } };
  const edit = (template: EventTemplate) => { const task = template.tasks[0]; setEditingId(template.id); setName(template.name); setDescription(template.description); setDuration(String(template.default_duration_minutes)); setTaskTitle(task?.title || ""); setTaskPriority(task?.priority || "Medium"); setSubtasks(task?.subtasks?.join(", ") || ""); };

  return <PageTransition><div className="max-w-5xl mx-auto space-y-6">
    <div><p className="text-sm text-accent font-semibold">Reusable workflows</p><h1 className="text-2xl font-bold text-foreground">Event Templates</h1><p className="text-xs text-muted-foreground mt-1">Build repeatable event structures with default tasks and checklists.</p></div>
    <div className="grid lg:grid-cols-5 gap-6">
      <form onSubmit={(event) => { event.preventDefault(); save.mutate(); }} className="lg:col-span-2 bg-card rounded-xl card-elevated p-5 space-y-4">
        <h2 className="font-bold text-sm text-foreground">{editingId ? "Edit template" : "Create template"}</h2>
        <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Template name" className="w-full px-3 py-2.5 rounded-lg input-focus text-sm text-foreground" />
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" rows={3} className="w-full px-3 py-2.5 rounded-lg input-focus text-sm text-foreground resize-none" />
        <label className="block text-xs text-muted-foreground">Default duration (minutes)<input type="number" min="1" value={duration} onChange={(event) => setDuration(event.target.value)} className="mt-1 w-full px-3 py-2.5 rounded-lg input-focus text-sm text-foreground" /></label>
        <div className="pt-3 border-t border-border space-y-3"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Default task</p><input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Task title (optional)" className="w-full px-3 py-2.5 rounded-lg input-focus text-sm text-foreground" /><select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value)} className="w-full px-3 py-2.5 rounded-lg input-focus text-sm text-foreground"><option>Low</option><option>Medium</option><option>High</option></select><input value={subtasks} onChange={(event) => setSubtasks(event.target.value)} placeholder="Checklist items, separated by commas" className="w-full px-3 py-2.5 rounded-lg input-focus text-sm text-foreground" /></div>
        <button disabled={save.isPending} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg btn-gradient text-primary-foreground text-sm font-semibold">{save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} {editingId ? "Save changes" : "Create template"}</button>
        {editingId && <button type="button" onClick={() => { setEditingId(null); setName(""); setDescription(""); setTaskTitle(""); setSubtasks(""); }} className="w-full text-xs text-muted-foreground hover:text-foreground">Cancel editing</button>}
      </form>
      <div className="lg:col-span-3 space-y-3">{isLoading && <p className="text-sm text-muted-foreground">Loading templates...</p>}{!isLoading && templates.length === 0 && <div className="bg-card border border-dashed border-border rounded-xl p-10 text-center text-sm text-muted-foreground">No templates created yet.</div>}{templates.map((template) => <div key={template.id} className="bg-card rounded-xl card-elevated p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-bold text-foreground">{template.name}</h2><p className="text-xs text-muted-foreground mt-1">{template.description || "No description"} · {template.default_duration_minutes} minutes</p></div><div className="flex gap-1"><button title="Edit template" onClick={() => edit(template)} className="px-2 py-1 rounded-lg hover:bg-secondary text-xs text-muted-foreground">Edit</button><button title="Duplicate template" onClick={() => duplicate(template.id)} className="p-2 rounded-lg hover:bg-secondary text-muted-foreground"><Copy size={16} /></button><button title="Delete template" onClick={() => remove(template.id)} className="p-2 rounded-lg hover:bg-destructive/10 text-destructive"><Trash2 size={16} /></button></div></div><div className="mt-4 space-y-2">{template.tasks.map((task) => <div key={task.title} className="bg-secondary/40 rounded-lg p-3"><div className="flex justify-between text-xs"><span className="font-semibold text-foreground">{task.title}</span><span className="text-muted-foreground">{task.priority}</span></div>{task.subtasks?.length > 0 && <p className="text-[11px] text-muted-foreground mt-1">Checklist: {task.subtasks.join(", ")}</p>}</div>)}</div></div>)}</div>
    </div>
  </div></PageTransition>;
}
