import { useState, useRef, useEffect } from "react";
import { Send, Megaphone, MessageSquare, Plus, Loader2, Search, Pin, Archive, Check, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageTransition } from "@/components/motion/PageTransition";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { formatDistanceToNow, format } from "date-fns";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Announcement {
  id: number;
  created_by: number;
  title: string;
  content: string;
  category: string;
  priority: "Normal" | "Important" | "Urgent";
  audience: string;
  status: string;
  target_dept_id: number | null;
  published_at: string;
  expires_at: string | null;
  acknowledgement_required: boolean;
  is_pinned: boolean;
  is_read?: boolean;
  is_acknowledged?: boolean;
  acknowledged_count?: number | null;
  eligible_count?: number | null;
  related_event_id?: number | null;
  related_task_id?: number | null;
  recipient_user_ids?: number[] | null;
  outstanding_recipients?: Array<{ id: number; name: string; role: string }> | null;
  event_title?: string | null;
  task_title?: string | null;
  author_name: string;
  author_role: string;
  department_name: string | null;
  created_at: string;
}

interface Contact {
  id: number;
  name: string;
  last_message: string;
  last_message_time: string | null;
}

interface Message {
  id: number;
  text: string;
  sent_by_user: boolean;
  created_at: string;
}

interface Channel {
  id: number;
  name: string;
  channel_type: "department" | "event";
  department_id: number | null;
  event_id: number | null;
  department_name: string | null;
  event_title: string | null;
  last_message: string | null;
  last_message_time: string | null;
  unread_count: number;
}

interface ChannelMessage {
  id: number;
  conversation_id: number;
  user_id: number | null;
  sender_name: string;
  text: string;
  created_at: string;
}

interface ChannelMessagePage {
  channel: Channel;
  messages: ChannelMessage[];
  next_before_id: number | null;
}

interface Department {
  id: number;
  name: string;
}

export default function CommunicationPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isSuperAdmin = user?.role === "super_admin";
  const isDeptHead = user?.role === "dept_head";
  const isAdminOrHead = isSuperAdmin || isDeptHead;

  const [activeTab, setActiveTab] = useState<"announcements" | "chat">("announcements");
  
  // Announcement states
  const [showAnnounceForm, setShowAnnounceForm] = useState(false);
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<number | null>(null);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const [announceTitle, setAnnounceTitle] = useState("");
  const [announceContent, setAnnounceContent] = useState("");
  const [targetDeptId, setTargetDeptId] = useState("");
  const [announceCategory, setAnnounceCategory] = useState("General Notice");
  const [announcePriority, setAnnouncePriority] = useState("Normal");
  const [announceAudience, setAnnounceAudience] = useState(isDeptHead ? "department" : "college");
  const [announcePublication, setAnnouncePublication] = useState("publish");
  const [recipientIds, setRecipientIds] = useState<number[]>([]);
  const [publishAt, setPublishAt] = useState("");
  const [expireAt, setExpireAt] = useState("");
  const [requiresAcknowledgement, setRequiresAcknowledgement] = useState(false);
  const [relatedEventId, setRelatedEventId] = useState("");
  const [relatedTaskId, setRelatedTaskId] = useState("");
  const [announcementSearch, setAnnouncementSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [announcementStatusFilter, setAnnouncementStatusFilter] = useState("published");
  const [submittingAnnounce, setSubmittingAnnounce] = useState(false);

  // Chat states
  const [chatMode, setChatMode] = useState<"channels" | "inbox">("channels");
  const [activeChannelId, setActiveChannelId] = useState<number | null>(null);
  const [activeContact, setActiveContact] = useState<number | null>(null);
  const [chatInput, setChatInput] = useState("");
  const olderScrollRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Announcements query
  const { data: announcements = [], isLoading: announcementsLoading, isError: announcementsFailed, error: announcementsError } = useQuery<Announcement[]>({
    queryKey: ["announcements", announcementSearch, categoryFilter, priorityFilter, isSuperAdmin ? announcementStatusFilter : "published"],
    queryFn: () => {
      const params = new URLSearchParams();
      if (announcementSearch.trim()) params.set("search", announcementSearch.trim());
      if (categoryFilter) params.set("category", categoryFilter);
      if (priorityFilter) params.set("priority", priorityFilter);
      if (isSuperAdmin && announcementStatusFilter) params.set("status", announcementStatusFilter);
      return apiGet(`/messages/announcements${params.size ? `?${params.toString()}` : ""}`);
    },
    refetchInterval: 5000,
  });

  // Departments for announcement targeting
  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["announceDepartments"],
    queryFn: () => apiGet("/admin/departments"),
    enabled: isAdminOrHead,
  });

  const { data: employees = [] } = useQuery<Array<{ id: number; name: string; role: string; department_id: number | null; is_active?: boolean }>>({
    queryKey: ["announcementRecipients"],
    queryFn: () => apiGet("/admin/employees"),
    enabled: isAdminOrHead,
  });

  const { data: events = [] } = useQuery<Array<{ id: number; title: string; department_id?: number | null }>>({
    queryKey: ["announcementEvents"],
    queryFn: () => apiGet("/tasks/events/all"),
    enabled: isAdminOrHead,
  });

  const { data: tasks = [] } = useQuery<Array<{ id: number; title: string; assigned_dept_id?: number | null }>>({
    queryKey: ["announcementTasks"],
    queryFn: () => apiGet("/tasks"),
    enabled: isAdminOrHead,
  });

  // Contacts query
  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["chatContacts"],
    queryFn: () => apiGet("/messages/contacts"),
    enabled: activeTab === "chat" && chatMode === "inbox",
  });

  // Auto-select first contact in chat tab
  useEffect(() => {
    if (activeTab === "chat" && chatMode === "inbox" && contacts.length > 0 && activeContact === null) {
      setActiveContact(contacts[0].id);
    }
  }, [contacts, activeContact, activeTab, chatMode]);

  const { data: channels = [], isLoading: channelsLoading, isError: channelsFailed } = useQuery<Channel[]>({
    queryKey: ["chatChannels"],
    queryFn: () => apiGet("/messages/channels"),
    enabled: activeTab === "chat" && chatMode === "channels",
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (activeTab === "chat" && chatMode === "channels" && channels.length > 0 && !channels.some((channel) => channel.id === activeChannelId)) {
      setActiveChannelId(channels[0].id);
    }
  }, [channels, activeChannelId, activeTab, chatMode]);

  // Messages query
  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: ["chatMessages", activeContact],
    queryFn: () => apiGet(`/messages/${activeContact}`),
    enabled: activeTab === "chat" && chatMode === "inbox" && activeContact !== null,
    refetchInterval: 3000,
  });

  const channelMessageQuery = useInfiniteQuery<ChannelMessagePage>({
    queryKey: ["channelMessages", activeChannelId],
    queryFn: ({ pageParam }) => apiGet(`/messages/channels/${activeChannelId}/messages?limit=50${pageParam ? `&before_id=${pageParam}` : ""}`),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.next_before_id || undefined,
    enabled: activeTab === "chat" && chatMode === "channels" && activeChannelId !== null,
    refetchInterval: 3000,
  });
  const channelMessages = channelMessageQuery.data?.pages.slice().reverse().flatMap((page) => page.messages) ?? [];
  const activeChannel = channels.find((channel) => channel.id === activeChannelId) || null;

  useEffect(() => {
    if (chatMode === "channels" && olderScrollRef.current) {
      olderScrollRef.current = false;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, channelMessageQuery.data, activeTab, chatMode]);

  // Submit announcement
  const handlePostAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!announceTitle.trim() || !announceContent.trim()) return;
    if (announceAudience === "department" && !targetDeptId) {
      toast.error("Choose a department for this announcement");
      return;
    }
    if (announceAudience === "selected_users" && recipientIds.length === 0) {
      toast.error("Choose at least one recipient");
      return;
    }
    if (publishAt && expireAt && new Date(expireAt) <= new Date(publishAt)) {
      toast.error("Expiry must be later than the publish date");
      return;
    }
    setSubmittingAnnounce(true);
    try {
      const payload = {
        title: announceTitle,
        content: announceContent,
        category: announceCategory,
        priority: announcePriority,
        audience: announceAudience,
        target_dept_id: announceAudience === "department" ? Number(targetDeptId) : null,
        recipient_user_ids: announceAudience === "selected_users" ? recipientIds : [],
        published_at: publishAt ? new Date(publishAt).toISOString() : undefined,
        expires_at: expireAt ? new Date(expireAt).toISOString() : undefined,
        acknowledgement_required: requiresAcknowledgement,
        related_event_id: relatedEventId ? Number(relatedEventId) : null,
        related_task_id: relatedTaskId ? Number(relatedTaskId) : null,
        status: announcePublication === "draft" ? "draft" : "published",
      };
      if (editingAnnouncementId) await apiPut(`/messages/announcements/${editingAnnouncementId}`, payload);
      else await apiPost("/messages/announcements", payload);
      resetAnnouncementForm();
      setShowAnnounceForm(false);
      queryClient.invalidateQueries({ queryKey: ["announcements"] });
      toast.success(editingAnnouncementId ? "Announcement updated" : "Announcement saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save announcement");
    } finally {
      setSubmittingAnnounce(false);
    }
  };

  const resetAnnouncementForm = () => {
    setEditingAnnouncementId(null);
    setAnnounceTitle("");
    setAnnounceContent("");
    setTargetDeptId("");
    setAnnounceCategory("General Notice");
    setAnnouncePriority("Normal");
    setAnnounceAudience(isDeptHead ? "department" : "college");
    setAnnouncePublication("publish");
    setRecipientIds([]);
    setPublishAt("");
    setExpireAt("");
    setRequiresAcknowledgement(false);
    setRelatedEventId("");
    setRelatedTaskId("");
  };

  const openAnnouncement = async (announcement: Announcement) => {
    try {
      const details = await apiGet<Announcement>(`/messages/announcements/${announcement.id}`);
      setSelectedAnnouncement({ ...announcement, ...details });
      queryClient.invalidateQueries({ queryKey: ["announcements"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to open announcement");
    }
  };

  const manageAnnouncement = async (announcement: Announcement) => {
    let details = announcement;
    try {
      details = await apiGet<Announcement>(`/messages/announcements/${announcement.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load announcement for editing");
      return;
    }
    setEditingAnnouncementId(announcement.id);
    setAnnounceTitle(details.title);
    setAnnounceContent(details.content);
    setTargetDeptId(details.target_dept_id ? String(details.target_dept_id) : "");
    setAnnounceCategory(details.category);
    setAnnouncePriority(details.priority);
    setAnnounceAudience(details.audience);
    setAnnouncePublication(details.status === "draft" ? "draft" : "publish");
    setRecipientIds(details.recipient_user_ids || []);
    setPublishAt(details.published_at ? format(new Date(details.published_at), "yyyy-MM-dd'T'HH:mm") : "");
    setExpireAt(details.expires_at ? format(new Date(details.expires_at), "yyyy-MM-dd'T'HH:mm") : "");
    setRequiresAcknowledgement(details.acknowledgement_required);
    setRelatedEventId(details.related_event_id ? String(details.related_event_id) : "");
    setRelatedTaskId(details.related_task_id ? String(details.related_task_id) : "");
    setSelectedAnnouncement(null);
    setShowAnnounceForm(true);
  };

  const togglePin = async (announcement: Announcement) => {
    try {
      await apiPost(`/messages/announcements/${announcement.id}/pin`, { is_pinned: !announcement.is_pinned });
      queryClient.invalidateQueries({ queryKey: ["announcements"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update pin");
    }
  };

  const archiveAnnouncement = async (announcement: Announcement) => {
    if (!window.confirm(`Archive “${announcement.title}”? It will remain in authorized history.`)) return;
    try {
      await apiPost(`/messages/announcements/${announcement.id}/archive`, {});
      setSelectedAnnouncement(null);
      queryClient.invalidateQueries({ queryKey: ["announcements"] });
      toast.success("Announcement archived");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to archive announcement");
    }
  };

  const acknowledgeAnnouncement = async (announcement: Announcement) => {
    try {
      await apiPost(`/messages/announcements/${announcement.id}/acknowledge`, {});
      setSelectedAnnouncement({ ...announcement, is_acknowledged: true });
      queryClient.invalidateQueries({ queryKey: ["announcements"] });
      toast.success("Acknowledgement recorded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to acknowledge announcement");
    }
  };

  // Submit chat message
  const handleSendChat = async () => {
    if (!chatInput.trim() || activeContact === null) return;
    const text = chatInput;
    setChatInput("");
    try {
      await apiPost(`/messages/${activeContact}`, { text });
      queryClient.invalidateQueries({ queryKey: ["chatMessages", activeContact] });
      queryClient.invalidateQueries({ queryKey: ["chatContacts"] });
    } catch {
      toast.error("Message delivery failed");
    }
  };

  const handleSendChannelMessage = async () => {
    const text = chatInput.trim();
    if (!text || activeChannelId === null) return;
    try {
      await apiPost(`/messages/channels/${activeChannelId}/messages`, { text });
      setChatInput("");
      queryClient.invalidateQueries({ queryKey: ["channelMessages", activeChannelId] });
      queryClient.invalidateQueries({ queryKey: ["chatChannels"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Message could not be sent");
    }
  };

  const loadOlderChannelMessages = async () => {
    if (!channelMessageQuery.hasNextPage || channelMessageQuery.isFetchingNextPage) return;
    olderScrollRef.current = true;
    await channelMessageQuery.fetchNextPage();
  };

  const activeContactName = contacts.find((c) => c.id === activeContact)?.name || "";

  const formatMsgTime = (dateStr: string) => {
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
    } catch {
      return dateStr;
    }
  };

  return (
    <PageTransition>
      <div className="h-[calc(100vh-8rem)] space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">Collaboration Workspace</h1>
          
          {/* Sub-tabs */}
          <div className="flex bg-secondary p-1 rounded-lg">
            <button
              onClick={() => setActiveTab("announcements")}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${
                activeTab === "announcements" ? "btn-gradient text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Megaphone size={14} /> Announcements
            </button>
            <button
              onClick={() => setActiveTab("chat")}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${
                activeTab === "chat" ? "btn-gradient text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <MessageSquare size={14} /> Team Chat
            </button>
          </div>
        </div>

        <div className="bg-card rounded-xl card-elevated flex h-[calc(100%-3rem)] overflow-hidden">
          <AnimatePresence mode="wait">
            {activeTab === "announcements" ? (
              <motion.div
                key="announcements-pane"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="flex-1 flex flex-col h-full overflow-hidden p-6 space-y-6"
              >
                <div className="flex flex-wrap justify-between items-center gap-3 border-b border-border pb-3">
                  <div>
                    <h2 className="font-bold text-sm text-foreground uppercase tracking-wider">Official College Notices</h2>
                    <p className="mt-1 text-[11px] text-muted-foreground">Published notices for your role and department</p>
                  </div>
                  {isAdminOrHead && (
                    <button
                      onClick={() => { resetAnnouncementForm(); setShowAnnounceForm(true); }}
                      className="px-4 py-2 rounded-lg btn-gradient text-primary-foreground text-xs font-semibold flex items-center gap-1 shadow-md"
                    >
                      <Plus size={14} /> Create Broadcast
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[minmax(220px,1fr)_170px_150px] gap-2">
                  <label className="relative">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input aria-label="Search announcements" value={announcementSearch} onChange={(e) => setAnnouncementSearch(e.target.value)} placeholder="Search title or content" className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-secondary text-xs text-foreground input-focus" />
                  </label>
                  <select aria-label="Filter by category" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="px-3 py-2.5 rounded-lg bg-secondary text-xs text-foreground input-focus">
                    <option value="">All categories</option>
                    {["General Notice", "Academic Notice", "Examination", "Department Meeting", "College Event", "Faculty Training", "Administrative Notice", "Urgent Notice", "Other"].map((category) => <option key={category}>{category}</option>)}
                  </select>
                  <select aria-label="Filter by priority" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="px-3 py-2.5 rounded-lg bg-secondary text-xs text-foreground input-focus">
                    <option value="">All priorities</option><option>Normal</option><option>Important</option><option>Urgent</option>
                  </select>
                </div>
                {isSuperAdmin && (
                  <div className="flex items-center gap-2 text-xs">
                    <label htmlFor="announcement-status" className="text-muted-foreground">History</label>
                    <select id="announcement-status" value={announcementStatusFilter} onChange={(e) => setAnnouncementStatusFilter(e.target.value)} className="px-3 py-2 rounded-lg bg-secondary text-foreground input-focus">
                      <option value="published">Published</option><option value="scheduled">Scheduled</option><option value="draft">Draft</option><option value="archived">Archived</option>
                    </select>
                  </div>
                )}

                <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
                  {announcementsLoading ? (
                    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading announcements...</div>
                  ) : announcementsFailed ? (
                    <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-8 text-center text-sm text-destructive">{announcementsError instanceof Error ? announcementsError.message : "Unable to load announcements."}</div>
                  ) : announcements.length === 0 ? (
                    <div className="border border-dashed border-border rounded-xl text-center py-16 text-muted-foreground text-sm">
                      No announcements match these filters.
                    </div>
                  ) : announcements.map((ann) => {
                    const canManage = isSuperAdmin || (isDeptHead && ann.created_by === user?.id);
                    const priorityStyle = ann.priority === "Urgent" ? "border-l-rose-500" : ann.priority === "Important" ? "border-l-amber-500" : "border-l-slate-300";
                    return (
                      <article key={ann.id} className={`rounded-lg border border-border border-l-4 ${priorityStyle} bg-background p-4 transition-colors hover:bg-secondary/20`}>
                        <div className="flex items-start justify-between gap-3">
                          <button onClick={() => void openAnnouncement(ann)} className="min-w-0 flex-1 text-left">
                            <div className="flex flex-wrap items-center gap-2">
                              {ann.is_pinned && <Pin size={13} className="text-accent" aria-label="Pinned" />}
                              <span className="text-[10px] font-semibold text-accent">{ann.category}</span>
                              <span className={`rounded px-2 py-0.5 text-[9px] font-bold uppercase ${ann.priority === "Urgent" ? "bg-rose-100 text-rose-700" : ann.priority === "Important" ? "bg-amber-100 text-amber-800" : "bg-secondary text-muted-foreground"}`}>{ann.priority}</span>
                              {ann.status !== "published" && <span className="text-[9px] uppercase text-muted-foreground">{ann.status}</span>}
                              {!ann.is_read && <span className="h-1.5 w-1.5 rounded-full bg-blue-600" aria-label="Unread" />}
                            </div>
                            <h3 className="mt-1.5 font-semibold text-sm text-foreground">{ann.title}</h3>
                            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{ann.content}</p>
                          </button>
                          {canManage && (
                            <div className="flex shrink-0 items-center gap-1">
                              <button title={ann.is_pinned ? "Unpin notice" : "Pin notice"} aria-label={ann.is_pinned ? "Unpin notice" : "Pin notice"} onClick={() => void togglePin(ann)} className={`rounded-md p-2 hover:bg-secondary ${ann.is_pinned ? "text-accent" : "text-muted-foreground"}`}><Pin size={15} /></button>
                              <button title="Edit notice" onClick={() => manageAnnouncement(ann)} className="rounded-md px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-secondary">Edit</button>
                              {ann.status !== "archived" && <button title="Archive notice" aria-label="Archive notice" onClick={() => void archiveAnnouncement(ann)} className="rounded-md p-2 text-muted-foreground hover:bg-secondary"><Archive size={15} /></button>}
                            </div>
                          )}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border pt-2 text-[10px] text-muted-foreground">
                          <span>{ann.author_name} · {ann.author_role.replace(/_/g, " ")}{ann.department_name ? ` · ${ann.department_name}` : ""}</span>
                          <span>{format(new Date(ann.published_at), "MMM d, yyyy · h:mm a")}</span>
                          <span>{ann.audience === "department" ? `For ${ann.department_name || "department"}` : `Audience: ${ann.audience.replace(/_/g, " ")}`}</span>
                          {ann.acknowledgement_required && ann.acknowledged_count != null && <span>Acknowledged {ann.acknowledged_count}/{ann.eligible_count ?? 0}</span>}
                          {ann.event_title && <a href="/calendar" className="inline-flex items-center gap-1 text-accent hover:underline"><ExternalLink size={11} />{ann.event_title}</a>}
                          {ann.task_title && <a href={ann.related_task_id ? `/track/${ann.related_task_id}` : "/track"} className="inline-flex items-center gap-1 text-accent hover:underline"><ExternalLink size={11} />{ann.task_title}</a>}
                        </div>
                      </article>
                    );
                  })}
                </div>

                <Dialog open={showAnnounceForm} onOpenChange={(open) => { setShowAnnounceForm(open); if (!open) resetAnnouncementForm(); }}>
                  <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>{editingAnnouncementId ? "Edit announcement" : "Create broadcast"}</DialogTitle>
                      <DialogDescription>Publish an official notice to an authorized audience.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handlePostAnnouncement} className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="text-xs font-medium text-foreground">Announcement title
                          <input value={announceTitle} onChange={(e) => setAnnounceTitle(e.target.value)} required maxLength={255} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm input-focus" />
                        </label>
                        <label className="text-xs font-medium text-foreground">Category
                          <select value={announceCategory} onChange={(e) => setAnnounceCategory(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm input-focus">
                            {["General Notice", "Academic Notice", "Examination", "Department Meeting", "College Event", "Faculty Training", "Administrative Notice", "Urgent Notice", "Other"].map((category) => <option key={category}>{category}</option>)}
                          </select>
                        </label>
                      </div>
                      <label className="block text-xs font-medium text-foreground">Announcement content
                        <textarea value={announceContent} onChange={(e) => setAnnounceContent(e.target.value)} required rows={5} className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2.5 text-sm leading-relaxed input-focus" />
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="text-xs font-medium text-foreground">Target audience
                          <select value={announceAudience} onChange={(e) => setAnnounceAudience(e.target.value)} disabled={isDeptHead} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm input-focus disabled:opacity-70">
                            {isDeptHead ? <option value="department">My department</option> : <>
                              <option value="college">Entire college</option><option value="super_admin">Super Admins</option><option value="dept_head">Department Heads</option><option value="employee">Employees (current role)</option><option value="department">Selected department</option>
                              <option value="selected_users">Selected eligible users</option>
                            </>}
                          </select>
                        </label>
                        <label className="text-xs font-medium text-foreground">Priority
                          <select value={announcePriority} onChange={(e) => setAnnouncePriority(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm input-focus"><option>Normal</option><option>Important</option><option>Urgent</option></select>
                        </label>
                      </div>
                      {announceAudience === "department" && (
                        <label className="block text-xs font-medium text-foreground">Department
                          <select value={targetDeptId} onChange={(e) => setTargetDeptId(e.target.value)} required className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm input-focus">
                            <option value="">Choose department</option>
                            {departments.filter((department) => !isDeptHead || department.name === user?.department).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                          </select>
                        </label>
                      )}
                      {isSuperAdmin && announceAudience === "selected_users" && (
                        <fieldset className="max-h-32 overflow-y-auto rounded-lg border border-border p-3">
                          <legend className="px-1 text-xs font-medium">Selected eligible users</legend>
                          {employees.filter((employee) => employee.is_active !== false).map((employee) => <label key={employee.id} className="flex items-center gap-2 py-1 text-xs text-foreground"><input type="checkbox" checked={recipientIds.includes(employee.id)} onChange={(e) => setRecipientIds((current) => e.target.checked ? [...current, employee.id] : current.filter((id) => id !== employee.id))} />{employee.name} · {employee.role.replace(/_/g, " ")}</label>)}
                        </fieldset>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="text-xs font-medium text-foreground">Publication state
                          <select value={announcePublication} onChange={(e) => setAnnouncePublication(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm input-focus"><option value="publish">Publish or schedule</option><option value="draft">Save as draft / unpublish</option></select>
                        </label>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="text-xs font-medium text-foreground">Publish date and time
                          <input type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm input-focus" />
                        </label>
                        <label className="text-xs font-medium text-foreground">Expiry date and time
                          <input type="datetime-local" min={publishAt || undefined} value={expireAt} onChange={(e) => setExpireAt(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm input-focus" />
                        </label>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="text-xs font-medium text-foreground">Related event
                          <select value={relatedEventId} onChange={(e) => setRelatedEventId(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm input-focus"><option value="">No related event</option>{events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select>
                        </label>
                        <label className="text-xs font-medium text-foreground">Related task
                          <select value={relatedTaskId} onChange={(e) => setRelatedTaskId(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm input-focus"><option value="">No related task</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select>
                        </label>
                      </div>
                      <label className="flex items-center justify-between rounded-lg border border-border px-3 py-3 text-sm text-foreground">
                        <span>Require recipient acknowledgement</span>
                        <input type="checkbox" checked={requiresAcknowledgement} onChange={(e) => setRequiresAcknowledgement(e.target.checked)} className="h-4 w-4 accent-blue-600" />
                      </label>
                      <div className="flex justify-end gap-2 border-t border-border pt-3">
                        <button type="button" onClick={() => { setShowAnnounceForm(false); resetAnnouncementForm(); }} className="rounded-lg border border-border px-4 py-2 text-xs text-foreground hover:bg-secondary">Cancel</button>
                        <button type="submit" disabled={submittingAnnounce} className="rounded-lg btn-gradient px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60">
                          {submittingAnnounce ? <Loader2 size={14} className="animate-spin" /> : announcePublication === "draft" ? "Save draft" : editingAnnouncementId ? "Save changes" : publishAt && new Date(publishAt) > new Date() ? "Schedule notice" : "Publish notice"}
                        </button>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>

                <Dialog open={Boolean(selectedAnnouncement)} onOpenChange={(open) => !open && setSelectedAnnouncement(null)}>
                  <DialogContent className="max-h-[90vh] overflow-y-auto">
                    {selectedAnnouncement && <>
                      <DialogHeader>
                        <div className="flex flex-wrap items-center gap-2 pr-8">
                          <span className="text-xs font-semibold text-accent">{selectedAnnouncement.category}</span>
                          <span className="rounded bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">{selectedAnnouncement.priority}</span>
                        </div>
                        <DialogTitle className="pt-2">{selectedAnnouncement.title}</DialogTitle>
                        <DialogDescription>{selectedAnnouncement.author_name} · {format(new Date(selectedAnnouncement.published_at), "MMMM d, yyyy 'at' h:mm a")}</DialogDescription>
                      </DialogHeader>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{selectedAnnouncement.content}</p>
                      <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                        <p>Audience: {selectedAnnouncement.audience.replace(/_/g, " ")}{selectedAnnouncement.department_name ? ` · ${selectedAnnouncement.department_name}` : ""}</p>
                        {selectedAnnouncement.expires_at && <p>Expires {format(new Date(selectedAnnouncement.expires_at), "MMM d, yyyy 'at' h:mm a")}</p>}
                        {selectedAnnouncement.event_title && <p>Related event: <a href="/calendar" className="text-accent hover:underline">{selectedAnnouncement.event_title}</a></p>}
                        {selectedAnnouncement.task_title && <p>Related task: <a href={selectedAnnouncement.related_task_id ? `/track/${selectedAnnouncement.related_task_id}` : "/track"} className="text-accent hover:underline">{selectedAnnouncement.task_title}</a></p>}
                        {selectedAnnouncement.acknowledgement_required && selectedAnnouncement.acknowledged_count != null && <p>Acknowledged {selectedAnnouncement.acknowledged_count} of {selectedAnnouncement.eligible_count ?? 0} eligible recipients</p>}
                        {selectedAnnouncement.acknowledgement_required && selectedAnnouncement.outstanding_recipients && selectedAnnouncement.outstanding_recipients.length > 0 && <p>Awaiting acknowledgement: {selectedAnnouncement.outstanding_recipients.map((recipient) => `${recipient.name} (${recipient.role.replace(/_/g, " ")})`).join(", ")}</p>}
                      </div>
                      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                        {selectedAnnouncement.acknowledgement_required && !selectedAnnouncement.is_acknowledged && selectedAnnouncement.created_by !== user?.id && <button onClick={() => void acknowledgeAnnouncement(selectedAnnouncement)} className="inline-flex items-center gap-1.5 rounded-lg btn-gradient px-3 py-2 text-xs font-semibold text-primary-foreground"><Check size={14} /> Acknowledge</button>}
                        {(isSuperAdmin || (isDeptHead && selectedAnnouncement.created_by === user?.id)) && <>
                          <button onClick={() => manageAnnouncement(selectedAnnouncement)} className="rounded-lg border border-border px-3 py-2 text-xs text-foreground hover:bg-secondary">Edit</button>
                          {selectedAnnouncement.status !== "archived" && <button onClick={() => void archiveAnnouncement(selectedAnnouncement)} className="rounded-lg border border-border px-3 py-2 text-xs text-foreground hover:bg-secondary">Archive</button>}
                        </>}
                      </div>
                    </>}
                  </DialogContent>
                </Dialog>
              </motion.div>
            ) : (
              <motion.div
                key="chat-pane"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="flex-1 flex min-h-0 flex-col overflow-hidden"
              >
                <div className="flex gap-1 border-b border-border p-2">
                  <button onClick={() => setChatMode("channels")} className={`rounded-md px-3 py-2 text-xs font-semibold ${chatMode === "channels" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>Department & event channels</button>
                  <button onClick={() => setChatMode("inbox")} className={`rounded-md px-3 py-2 text-xs font-semibold ${chatMode === "inbox" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>Campus Support inbox</button>
                </div>

                <div className="flex min-h-0 flex-1 overflow-hidden">
                  <div className="hidden w-72 shrink-0 flex-col border-r border-border md:flex">
                    <div className="border-b border-border p-3">
                      <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{chatMode === "channels" ? "Available channels" : "Support conversations"}</p>
                    </div>
                    <div className="flex-1 overflow-auto">
                      {chatMode === "channels" ? channels.map((channel) => (
                        <button key={channel.id} onClick={() => setActiveChannelId(channel.id)} className={`w-full border-b border-border p-4 text-left transition-colors ${activeChannelId === channel.id ? "bg-secondary" : "hover:bg-secondary/50"}`}>
                          <div className="flex items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-accent"><MessageSquare size={16} /></div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-semibold text-foreground">{channel.name}</p>
                              <p className="mt-0.5 truncate text-[10px] capitalize text-muted-foreground">{channel.channel_type}{channel.department_name ? ` · ${channel.department_name}` : ""}</p>
                              <p className="mt-1 truncate text-[10px] text-muted-foreground">{channel.last_message || "No messages yet"}</p>
                            </div>
                            {channel.unread_count > 0 && <span className="min-w-5 rounded-full bg-blue-100 px-1.5 py-0.5 text-center text-[9px] font-bold text-blue-800">{channel.unread_count}</span>}
                          </div>
                        </button>
                      )) : contacts.map((contact) => (
                        <button key={contact.id} onClick={() => setActiveContact(contact.id)} className={`w-full border-b border-border p-4 text-left transition-colors ${activeContact === contact.id ? "bg-secondary" : "hover:bg-secondary/50"}`}>
                          <p className="truncate text-xs font-semibold text-foreground">{contact.name}</p>
                          <p className="mt-1 truncate text-[10px] text-muted-foreground">{contact.last_message}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="border-b border-border p-3 md:hidden">
                      {chatMode === "channels" ? (
                        <select aria-label="Choose channel" value={activeChannelId ?? ""} onChange={(e) => setActiveChannelId(Number(e.target.value) || null)} className="w-full rounded-lg bg-secondary px-3 py-2 text-xs text-foreground">
                          {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
                        </select>
                      ) : (
                        <select aria-label="Choose support conversation" value={activeContact ?? ""} onChange={(e) => setActiveContact(Number(e.target.value))} className="w-full rounded-lg bg-secondary px-3 py-2 text-xs text-foreground">
                          {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
                        </select>
                      )}
                    </div>
                    <div className="border-b border-border px-4 py-3">
                      {chatMode === "channels" ? <>
                        <p className="text-xs font-semibold text-foreground">{activeChannel?.name || "Choose a channel"}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">{activeChannel?.channel_type === "event" ? `Event discussion · ${activeChannel.event_title || activeChannel.name}` : activeChannel?.department_name ? `Department channel · ${activeChannel.department_name}` : "Department and event coordination"}</p>
                        {activeChannel?.channel_type === "event" && activeChannel.event_id && <a href="/calendar" className="mt-1 inline-flex items-center gap-1 text-[10px] text-accent hover:underline"><ExternalLink size={11} /> Open event calendar</a>}
                      </> : <>
                        <p className="text-xs font-semibold text-foreground">{activeContactName || "Campus Support"}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">Private support conversation</p>
                      </>}
                    </div>

                    <div className="flex-1 space-y-3.5 overflow-auto p-4">
                      {chatMode === "channels" ? <>
                        {channelsLoading && <p className="py-8 text-center text-xs text-muted-foreground">Loading channels...</p>}
                        {channelsFailed && <p role="alert" className="py-8 text-center text-xs text-destructive">Unable to load channels.</p>}
                        {!channelsLoading && !channelsFailed && channels.length === 0 && <p className="py-12 text-center text-xs text-muted-foreground">No channels are available for your department or assigned events.</p>}
                        {channelMessageQuery.hasNextPage && <div className="text-center"><button disabled={channelMessageQuery.isFetchingNextPage} onClick={() => void loadOlderChannelMessages()} className="rounded-md border border-border px-3 py-1.5 text-[10px] text-muted-foreground hover:bg-secondary disabled:opacity-50">{channelMessageQuery.isFetchingNextPage ? "Loading older messages..." : "Load older messages"}</button></div>}
                        {channelMessages.map((message) => {
                          const ownMessage = message.user_id === user?.id;
                          return <div key={message.id} className={`flex ${ownMessage ? "justify-end" : "justify-start"}`}>
                            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs sm:max-w-[70%] ${ownMessage ? "btn-gradient rounded-br-md text-primary-foreground shadow-sm" : "rounded-bl-md bg-secondary text-secondary-foreground"}`}>
                              {!ownMessage && <p className="mb-1 text-[10px] font-semibold text-accent">{message.sender_name}</p>}
                              <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>
                              <p className={`mt-1 text-right text-[9px] ${ownMessage ? "text-primary-foreground/60" : "text-muted-foreground"}`}>{formatMsgTime(message.created_at)}</p>
                            </div>
                          </div>;
                        })}
                        {!channelMessages.length && !channelMessageQuery.isLoading && activeChannel && <p className="py-12 text-center text-xs text-muted-foreground">No messages in this channel yet.</p>}
                      </> : messages.map((message) => (
                        <div key={message.id} className={`flex ${message.sent_by_user ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs sm:max-w-[70%] ${message.sent_by_user ? "btn-gradient rounded-br-md text-primary-foreground shadow-sm" : "rounded-bl-md bg-secondary text-secondary-foreground"}`}>
                            <p className="leading-relaxed">{message.text}</p>
                            <p className={`mt-1 text-right text-[9px] ${message.sent_by_user ? "text-primary-foreground/60" : "text-muted-foreground"}`}>{formatMsgTime(message.created_at)}</p>
                          </div>
                        </div>
                      ))}
                      <div ref={bottomRef} />
                    </div>

                    <form onSubmit={(e) => { e.preventDefault(); void (chatMode === "channels" ? handleSendChannelMessage() : handleSendChat()); }} className="flex gap-2 border-t border-border p-3">
                      <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Write a message..." aria-label="Message" className="min-w-0 flex-1 rounded-lg bg-secondary px-4 py-2.5 text-xs text-foreground placeholder:text-muted-foreground input-focus" />
                      <button type="submit" disabled={!chatInput.trim() || (chatMode === "channels" ? activeChannelId === null : activeContact === null)} aria-label="Send message" title="Send message" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg btn-gradient text-primary-foreground shadow-sm disabled:opacity-50">
                        <Send size={16} />
                      </button>
                    </form>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </PageTransition>
  );
}
