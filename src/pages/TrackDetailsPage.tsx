import { useParams, Link } from "react-router-dom";
import { CheckCircle, Circle, Loader2, Send, Upload, Plus, Award, ClipboardList, Clock, ShieldCheck, QrCode } from "lucide-react";
import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageTransition } from "@/components/motion/PageTransition";
import { apiGet, apiPost, apiPut, UPLOADS_BASE } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

const stepsList = ["Pending", "In Progress", "Under Review", "Completed"];

interface Subtask {
  id: number;
  title: string;
  is_completed: boolean;
  assigned_to_name: string | null;
}

interface Comment {
  id: number;
  text: string;
  created_at: string;
  author_name: string;
}

interface TaskDetails {
  id: number;
  event_id: number;
  title: string;
  description: string;
  proof_url: string | null;
  status: string;
  priority: string;
  progress: number;
  assigned_to_id: number | null;
  assigned_to_name: string | null;
  assigned_to_email: string | null;
  assigned_dept_name: string | null;
  due_date: string;
  subtasks: Subtask[];
  comments: Comment[];
  event_title: string;
  event_location: string;
  qr_code_key: string;
}

interface MeetingNote {
  id: number;
  title: string;
  notes: string;
  author_name: string;
  created_at: string;
}

function getStepIndex(status: string): number {
  switch (status) {
    case "Pending": return 0;
    case "In Progress": return 1;
    case "Under Review": return 2;
    case "Completed": return 3;
    default: return 0;
  }
}

export default function TrackDetailsPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // States
  const [commentText, setCommentText] = useState("");
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [submittingSubtask, setSubmittingSubtask] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [loggingAttendance, setLoggingAttendance] = useState(false);

  // Event Meeting Notes States
  const [showNotesForm, setShowNotesForm] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);

  const { data: task, isLoading } = useQuery<TaskDetails>({
    queryKey: ["taskDetails", id],
    queryFn: () => apiGet(`/tasks/${id}`),
    enabled: !!id,
  });

  const { data: meetingNotes = [] } = useQuery<MeetingNote[]>({
    queryKey: ["eventMeetingNotes", task?.event_id],
    queryFn: () => apiGet(`/tasks/events/${task?.event_id}/meeting-notes`),
    enabled: !!task?.event_id,
  });

  if (isLoading) {
    return (
      <PageTransition>
        <div className="text-center py-20 text-muted-foreground text-sm">Loading task details...</div>
      </PageTransition>
    );
  }

  if (!task) {
    return (
      <PageTransition>
        <div className="text-center py-20 text-muted-foreground text-sm">Task not found</div>
      </PageTransition>
    );
  }

  const isCoordinator = task.assigned_to_id === user?.id;
  const isDeptHead = user?.role === "dept_head";
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const currentStep = getStepIndex(task.status);

  // Post Comment
  const handleSendComment = async () => {
    if (!commentText.trim()) return;
    setSubmittingComment(true);
    try {
      await apiPost(`/tasks/${task.id}/comments`, { text: commentText });
      setCommentText("");
      queryClient.invalidateQueries({ queryKey: ["taskDetails", id] });
      toast.success("Comment posted");
    } catch {
      toast.error("Failed to post comment");
    } finally {
      setSubmittingComment(false);
    }
  };

  // Toggle Subtask
  const handleToggleSubtask = async (subtaskId: number, currentStatus: boolean) => {
    try {
      await apiPut(`/tasks/subtasks/${subtaskId}`, { is_completed: !currentStatus });
      queryClient.invalidateQueries({ queryKey: ["taskDetails", id] });
      toast.success("Checklist updated");
    } catch {
      toast.error("Failed to update checklist item");
    }
  };

  // Add Subtask
  const handleAddSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubtaskTitle.trim()) return;
    setSubmittingSubtask(true);
    try {
      await apiPost(`/tasks/${task.id}/subtasks`, { title: newSubtaskTitle });
      setNewSubtaskTitle("");
      queryClient.invalidateQueries({ queryKey: ["taskDetails", id] });
      toast.success("Checklist item added");
    } catch {
      toast.error("Failed to add checklist item");
    } finally {
      setSubmittingSubtask(false);
    }
  };

  // Upload Work Deliverable Proof
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingProof(true);
    const formData = new FormData();
    formData.append("proof", file);
    formData.append("status", "Under Review");
    formData.append("progress", "90");
    formData.append("comment", `Uploaded work proof: ${file.name}`);

    try {
      await apiPut(`/tasks/${task.id}`, formData);
      queryClient.invalidateQueries({ queryKey: ["taskDetails", id] });
      toast.success("Deliverable submitted for review!");
    } catch {
      toast.error("Failed to upload proof");
    } finally {
      setUploadingProof(false);
    }
  };

  // Review & Approve/Reject Deliverables
  const handleReviewTask = async (approve: boolean) => {
    setReviewing(true);
    const status = approve ? "Completed" : "In Progress";
    const progress = approve ? 100 : 50;
    try {
      await apiPut(`/tasks/${task.id}`, {
        status,
        progress,
        comment: `Review Resolution: ${approve ? 'APPROVED' : 'REJECTED FOR REVISION'}. Note: ${reviewComment || "No notes provided."}`
      });
      setReviewComment("");
      queryClient.invalidateQueries({ queryKey: ["taskDetails", id] });
      toast.success(`Task ${approve ? 'approved as complete!' : 'returned for revision'}`);
    } catch {
      toast.error("Failed to submit task review");
    } finally {
      setReviewing(false);
    }
  };

  // QR Attendance Simulation scan
  const handleMarkAttendance = async () => {
    setLoggingAttendance(true);
    try {
      const res = await apiPost<{ message: string }>(`/tasks/events/${task.event_id}/attendance`, {
        qr_code_key: task.qr_code_key
      });
      toast.success(res.message);
    } catch (err: any) {
      toast.error(err.message || "Failed to log QR attendance");
    } finally {
      setLoggingAttendance(false);
    }
  };

  // Submit Meeting Note
  const handleCreateMeetingNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteTitle.trim() || !noteContent.trim()) return;
    setSubmittingNote(true);
    try {
      await apiPost(`/tasks/events/${task.event_id}/meeting-notes`, {
        title: noteTitle,
        notes: noteContent,
      });
      setNoteTitle("");
      setNoteContent("");
      setShowNotesForm(false);
      queryClient.invalidateQueries({ queryKey: ["eventMeetingNotes", task.event_id] });
      toast.success("Minutes of Meeting saved successfully!");
    } catch {
      toast.error("Failed to save meeting notes");
    } finally {
      setSubmittingNote(false);
    }
  };

  return (
    <PageTransition>
      <div className="space-y-6 max-w-6xl mx-auto pb-12">
        <div className="flex items-center gap-2">
          <Link to="/track" className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors uppercase tracking-wider">← Back to Tracking Board</Link>
        </div>

        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-[10px] font-bold tracking-wider uppercase bg-secondary text-foreground px-2 py-0.5 rounded">
                Event: {task.event_title}
              </span>
              <span className={`text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded ${
                task.priority === "High" ? "bg-destructive/10 text-destructive" : task.priority === "Medium" ? "bg-warning/10 text-warning" : "bg-success/10 text-success"
              }`}>
                {task.priority} Priority
              </span>
            </div>
            <h1 className="text-2xl font-bold text-foreground">
              {task.title}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">Task ID: #{task.id} {task.due_date ? `• Due: ${new Date(task.due_date).toLocaleString()}` : ""}</p>
          </div>
          <span className="text-xs bg-accent/10 text-accent font-semibold px-3.5 py-1.5 rounded-full uppercase tracking-wider">
            {task.status}
          </span>
        </div>

        {/* Status Timeline */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-card rounded-xl card-elevated p-6"
        >
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">Orchestration Progress</h2>
          <div className="flex items-center justify-between">
            {stepsList.map((step, i) => (
              <div key={step} className="flex flex-col items-center flex-1">
                <div className="flex items-center w-full">
                  {i > 0 && (
                    <motion.div
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 0.5, delay: i * 0.15 }}
                      style={{ transformOrigin: "left" }}
                      className={`flex-1 h-0.5 ${i <= currentStep ? "bg-accent" : "bg-border"}`}
                    />
                  )}
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20, delay: i * 0.15 }}
                    className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 cursor-pointer transition-transform hover:scale-105 ${
                      i <= currentStep ? "bg-accent text-accent-foreground" : "bg-secondary text-muted-foreground"
                    }`}
                    title={step}
                  >
                    {i <= currentStep ? <CheckCircle size={16} /> : <Circle size={16} />}
                  </motion.div>
                  {i < stepsList.length - 1 && (
                    <motion.div
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 0.5, delay: i * 0.15 + 0.1 }}
                      style={{ transformOrigin: "left" }}
                      className={`flex-1 h-0.5 ${i < currentStep ? "bg-accent" : "bg-border"}`}
                    />
                  )}
                </div>
                <span className="text-[10px] uppercase tracking-wider font-semibold mt-2 text-muted-foreground">{step}</span>
              </div>
            ))}
          </div>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
            {/* Description & Proof details */}
            <motion.div
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-card rounded-xl card-elevated p-6 space-y-4"
            >
              <h2 className="font-bold text-foreground text-sm uppercase tracking-wider flex items-center gap-2">
                <ClipboardList size={18} className="text-accent" /> Task Details
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed font-light">{task.description}</p>
              
              <div className="grid grid-cols-2 gap-4 pt-2 text-xs border-t border-border/50">
                <div>
                  <p className="text-muted-foreground mb-0.5">Assigned To</p>
                  <p className="font-semibold text-foreground">{task.assigned_to_name || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-0.5">Assigned Department</p>
                  <p className="font-semibold text-foreground">{task.assigned_dept_name || "—"}</p>
                </div>
              </div>

              {/* Submitted Deliverable Proof */}
              <div className="pt-4 border-t border-border/50 space-y-2">
                <p className="text-xs font-bold text-foreground uppercase tracking-wider">Deliverable Proof</p>
                {task.proof_url ? (
                  <div className="border border-border rounded-lg overflow-hidden relative group bg-secondary/20">
                    {task.proof_url.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                      <img
                        src={`${UPLOADS_BASE}${task.proof_url}`}
                        alt="Task Proof Deliverable"
                        className="w-full max-h-60 object-cover"
                      />
                    ) : (
                      <div className="p-4 flex items-center justify-between text-xs text-foreground">
                        <span className="font-semibold truncate">{task.proof_url.split("/").pop()}</span>
                        <a
                          href={`${UPLOADS_BASE}${task.proof_url}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent font-bold hover:underline ml-2 flex-shrink-0"
                        >
                          Download File
                        </a>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No proof uploaded yet</p>
                )}
              </div>
            </motion.div>

            {/* Subtasks Checklist */}
            <motion.div
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.25 }}
              className="bg-card rounded-xl card-elevated p-6 space-y-4"
            >
              <h2 className="font-bold text-foreground text-sm uppercase tracking-wider flex items-center gap-2">
                <ClipboardList size={18} className="text-accent" /> Subtasks Checklist
              </h2>
              
              <div className="space-y-2">
                {(task.subtasks || []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No subtasks defined. Split workflows if needed.</p>
                ) : (
                  (task.subtasks || []).map((st) => (
                    <div
                      key={st.id}
                      onClick={() => handleToggleSubtask(st.id, st.is_completed)}
                      className="flex items-center gap-3 p-3 rounded-lg bg-secondary/40 border border-border/40 hover:bg-secondary/70 cursor-pointer transition-colors"
                    >
                      {st.is_completed ? (
                        <CheckCircle size={18} className="text-success shrink-0" />
                      ) : (
                        <Circle size={18} className="text-muted-foreground shrink-0" />
                      )}
                      <span className={`text-xs ${st.is_completed ? 'line-through text-muted-foreground' : 'text-foreground font-medium'}`}>
                        {st.title}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {(isDeptHead || isAdmin) && (
                <form onSubmit={handleAddSubtask} className="flex gap-2 pt-2">
                  <input
                    value={newSubtaskTitle}
                    onChange={(e) => setNewSubtaskTitle(e.target.value)}
                    placeholder="Add checklist item..."
                    required
                    className="flex-1 text-xs px-3.5 py-2.5 rounded-lg input-focus text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    type="submit"
                    disabled={submittingSubtask}
                    className="px-4 rounded-lg btn-gradient text-primary-foreground flex items-center justify-center gap-1.5 text-xs font-semibold"
                  >
                    {submittingSubtask ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
                  </motion.button>
                </form>
              )}
            </motion.div>

            {/* Event Meeting Notes */}
            <motion.div
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-card rounded-xl card-elevated p-6 space-y-4"
            >
              <div className="flex justify-between items-center border-b border-border/50 pb-2">
                <h2 className="font-bold text-foreground text-sm uppercase tracking-wider flex items-center gap-2">
                  <ClipboardList size={18} className="text-accent" /> Minutes of Meetings (MoM)
                </h2>
                {!showNotesForm && (isAdmin || isDeptHead) && (
                  <button
                    onClick={() => setShowNotesForm(true)}
                    className="text-xs font-semibold text-accent hover:underline flex items-center gap-0.5"
                  >
                    + Add MoM
                  </button>
                )}
              </div>

              {showNotesForm && (
                <form onSubmit={handleCreateMeetingNote} className="space-y-3 bg-secondary/20 p-4 rounded-lg border border-border">
                  <input
                    value={noteTitle}
                    onChange={(e) => setNoteTitle(e.target.value)}
                    placeholder="Meeting Agenda Title"
                    required
                    className="w-full text-xs px-3 py-2 rounded-lg input-focus text-foreground focus:outline-none"
                  />
                  <textarea
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    placeholder="Enter details of decisions, notes, and goals discussed..."
                    required
                    rows={3}
                    className="w-full text-xs px-3 py-2 rounded-lg input-focus text-foreground focus:outline-none resize-none"
                  />
                  <div className="flex justify-end gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setShowNotesForm(false)}
                      className="px-3 py-1.5 rounded border border-border text-foreground hover:bg-secondary"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submittingNote}
                      className="px-4 py-1.5 rounded btn-gradient text-primary-foreground font-semibold flex items-center gap-1"
                    >
                      {submittingNote && <Loader2 size={12} className="animate-spin" />} Save MoM
                    </button>
                  </div>
                </form>
              )}

              <div className="space-y-4 pt-1">
                {(meetingNotes || []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No meeting notes recorded for this parent event.</p>
                ) : (
                  (meetingNotes || []).map((note) => (
                    <div key={note.id} className="border-b border-border/30 pb-3 last:border-b-0">
                      <div className="flex justify-between items-center">
                        <h4 className="font-semibold text-xs text-foreground">{note.title}</h4>
                        <span className="text-[10px] text-muted-foreground">
                          {note.created_at ? format(new Date(note.created_at), "MMM dd, yyyy") : "—"} • by {note.author_name}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed whitespace-pre-line">{note.notes}</p>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>

          {/* Right Panel - Actions & Chat */}
          <div className="space-y-6">
            {/* User Submission Portal / Admin Review */}
            <motion.div
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-card rounded-xl card-elevated p-6 space-y-4"
            >
              <h2 className="font-bold text-foreground text-sm uppercase tracking-wider flex items-center gap-2">
                <Award size={18} className="text-accent" /> Action Console
              </h2>

              {/* Employee Submits Deliverable */}
              {isCoordinator && task.status !== "Completed" && task.status !== "Under Review" && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">Upload deliverables (documentation, images, zip files) to mark task complete.</p>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingProof}
                    className="w-full py-2.5 rounded-lg border-2 border-dashed border-accent/40 text-accent hover:border-accent hover:bg-accent/5 flex items-center justify-center gap-2 text-xs font-semibold transition-all"
                  >
                    {uploadingProof ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <>
                        <Upload size={16} /> Submit Work Deliverable
                      </>
                    )}
                  </motion.button>
                </div>
              )}

              {/* Admin/Head reviews submissions */}
              {(isDeptHead || isAdmin) && task.status === "Under Review" && (
                <div className="space-y-3 pt-2">
                  <p className="text-xs text-muted-foreground font-semibold flex items-center gap-1 text-warning">
                    <ShieldCheck size={16} /> Awaiting Review
                  </p>
                  <textarea
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    placeholder="Add review feedback notes (optional)..."
                    className="w-full text-xs px-3 py-2 rounded-lg input-focus text-foreground placeholder:text-muted-foreground focus:outline-none resize-none"
                    rows={3.5}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleReviewTask(false)}
                      disabled={reviewing}
                      className="flex-1 py-2 rounded-lg border border-destructive text-destructive hover:bg-destructive/5 text-xs font-semibold"
                    >
                      Request Revision
                    </button>
                    <button
                      onClick={() => handleReviewTask(true)}
                      disabled={reviewing}
                      className="flex-1 py-2 rounded-lg btn-gradient text-primary-foreground text-xs font-semibold"
                    >
                      Approve & Close
                    </button>
                  </div>
                </div>
              )}

              {task.status === "Completed" && (
                <div className="p-3 bg-success/10 rounded-lg text-center text-xs text-success font-semibold flex items-center justify-center gap-1">
                  <ShieldCheck size={16} /> Task Completed & Approved
                </div>
              )}

              {(!isCoordinator && task.status !== "Under Review" && task.status !== "Completed") && (
                <p className="text-xs text-muted-foreground italic text-center">Awaiting execution from assigned team members.</p>
              )}
            </motion.div>

            {/* QR Event Attendance simulator */}
            <motion.div
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.25 }}
              className="bg-card rounded-xl card-elevated p-6 space-y-4"
            >
              <h2 className="font-bold text-foreground text-sm uppercase tracking-wider flex items-center gap-2">
                <QrCode size={18} className="text-accent" /> Event Attendance
              </h2>
              
              {isAdmin ? (
                <div className="flex flex-col items-center justify-center p-3 border border-dashed border-border rounded-lg bg-secondary/10">
                  <div className="w-32 h-32 bg-white p-2 rounded shadow flex items-center justify-center relative">
                    {/* Simulated QR Code */}
                    <div className="w-full h-full bg-slate-900 flex flex-col items-center justify-center text-white text-[8px] font-bold p-1 text-center">
                      <QrCode size={40} className="mb-1 text-accent animate-pulse" />
                      TASKPILOT ATTENDANCE
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-3 text-center">
                    Share this QR Code with employees to register attendance.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Check in to this event using the system QR code scanning simulation.
                  </p>
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={handleMarkAttendance}
                    disabled={loggingAttendance}
                    className="w-full py-2.5 rounded-lg btn-gradient-accent text-accent-foreground flex items-center justify-center gap-2 text-xs font-semibold"
                  >
                    {loggingAttendance ? <Loader2 size={14} className="animate-spin" /> : <QrCode size={14} />} Mark Event Attendance
                  </motion.button>
                </div>
              )}
            </motion.div>

            {/* Task Discussion Collaboration */}
            <motion.div
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-card rounded-xl card-elevated p-5 flex flex-col h-[320px]"
            >
              <h2 className="font-bold text-foreground text-xs uppercase tracking-wider mb-3 flex items-center gap-2">
                <Send size={14} className="text-accent animate-pulse" /> Team Discussions
              </h2>
              
              <div className="flex-1 overflow-y-auto space-y-3.5 pr-1 text-xs">
                {(task.comments || []).length === 0 ? (
                  <p className="text-muted-foreground italic text-center py-10">No discussion entries. Start the chat!</p>
                ) : (
                  (task.comments || []).map((comm) => (
                    <div key={comm.id} className="space-y-1">
                      <div className="flex justify-between items-center text-[10px] font-bold">
                        <span className="text-foreground">{comm.author_name}</span>
                        <span className="text-muted-foreground font-light">
                          {(() => {
                            try {
                              return comm.created_at ? `${formatDistanceToNow(new Date(comm.created_at))} ago` : "some time";
                            } catch {
                              return "some time";
                            }
                          })()}
                        </span>
                      </div>
                      <p className="p-2.5 rounded-lg bg-secondary/40 text-foreground leading-relaxed">{comm.text}</p>
                    </div>
                  ))
                )}
              </div>

              <div className="pt-3 border-t border-border/50 flex gap-2">
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendComment()}
                  placeholder="Ask a question or update team..."
                  className="flex-1 text-xs px-3 py-2 rounded-lg bg-secondary text-foreground placeholder:text-muted-foreground focus:outline-none input-focus"
                />
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={handleSendComment}
                  disabled={submittingComment}
                  className="w-8 h-8 rounded-lg btn-gradient text-primary-foreground flex items-center justify-center"
                >
                  <Send size={14} />
                </motion.button>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
