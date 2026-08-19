import { useState, useRef, useEffect } from "react";
import { Send, Megaphone, MessageSquare, Plus, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageTransition } from "@/components/motion/PageTransition";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { formatDistanceToNow, format } from "date-fns";
import { toast } from "sonner";

interface Announcement {
  id: number;
  title: string;
  content: string;
  author_name: string;
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

interface Department {
  id: number;
  name: string;
}

export default function CommunicationPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdminOrHead = user?.role === "admin" || user?.role === "super_admin" || user?.role === "dept_head";

  const [activeTab, setActiveTab] = useState<"announcements" | "chat">("announcements");
  
  // Announcement states
  const [showAnnounceForm, setShowAnnounceForm] = useState(false);
  const [announceTitle, setAnnounceTitle] = useState("");
  const [announceContent, setAnnounceContent] = useState("");
  const [targetDeptId, setTargetDeptId] = useState("");
  const [submittingAnnounce, setSubmittingAnnounce] = useState(false);

  // Chat states
  const [activeContact, setActiveContact] = useState<number | null>(null);
  const [chatInput, setChatInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Announcements query
  const { data: announcements = [] } = useQuery<Announcement[]>({
    queryKey: ["announcements"],
    queryFn: () => apiGet("/messages/announcements"),
    refetchInterval: 5000,
  });

  // Departments for announcement targeting
  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["announceDepartments"],
    queryFn: () => apiGet("/admin/departments"),
    enabled: isAdminOrHead,
  });

  // Contacts query
  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["chatContacts"],
    queryFn: () => apiGet("/messages/contacts"),
    enabled: activeTab === "chat",
  });

  // Auto-select first contact in chat tab
  useEffect(() => {
    if (activeTab === "chat" && contacts.length > 0 && activeContact === null) {
      setActiveContact(contacts[0].id);
    }
  }, [contacts, activeContact, activeTab]);

  // Messages query
  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: ["chatMessages", activeContact],
    queryFn: () => apiGet(`/messages/${activeContact}`),
    enabled: activeTab === "chat" && activeContact !== null,
    refetchInterval: 3000,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeTab]);

  // Submit announcement
  const handlePostAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!announceTitle.trim() || !announceContent.trim()) return;
    setSubmittingAnnounce(true);
    try {
      await apiPost("/messages/announcements", {
        title: announceTitle,
        content: announceContent,
        target_dept_id: targetDeptId ? parseInt(targetDeptId) : undefined,
      });
      setAnnounceTitle("");
      setAnnounceContent("");
      setTargetDeptId("");
      setShowAnnounceForm(false);
      queryClient.invalidateQueries({ queryKey: ["announcements"] });
      toast.success("Announcement broadcast successfully!");
    } catch {
      toast.error("Failed to broadcast announcement");
    } finally {
      setSubmittingAnnounce(false);
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
                <div className="flex justify-between items-center border-b border-border pb-3">
                  <h2 className="font-bold text-sm text-foreground uppercase tracking-wider">Announcement Bulletin Board</h2>
                  {!showAnnounceForm && isAdminOrHead && (
                    <button
                      onClick={() => setShowAnnounceForm(true)}
                      className="px-4 py-2 rounded-lg btn-gradient text-primary-foreground text-xs font-semibold flex items-center gap-1 shadow-md"
                    >
                      <Plus size={14} /> Create Broadcast
                    </button>
                  )}
                </div>

                {showAnnounceForm && (
                  <form onSubmit={handlePostAnnouncement} className="space-y-3 bg-secondary/20 p-5 rounded-lg border border-border">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Broadcast Title</label>
                        <input
                          value={announceTitle}
                          onChange={(e) => setAnnounceTitle(e.target.value)}
                          placeholder="Announce header..."
                          required
                          className="w-full text-xs px-3.5 py-2 rounded-lg input-focus text-foreground focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Target Department</label>
                        <select
                          value={targetDeptId}
                          onChange={(e) => setTargetDeptId(e.target.value)}
                          className="w-full text-xs px-3 py-2 rounded-lg input-focus text-foreground bg-background focus:outline-none cursor-pointer"
                        >
                          <option value="">All Departments (Public)</option>
                          {departments.map((d) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Content details</label>
                      <textarea
                        value={announceContent}
                        onChange={(e) => setAnnounceContent(e.target.value)}
                        placeholder="Write detailed announcements..."
                        required
                        rows={3}
                        className="w-full text-xs px-3 py-2 rounded-lg input-focus text-foreground focus:outline-none resize-none leading-relaxed"
                      />
                    </div>
                    <div className="flex justify-end gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => setShowAnnounceForm(false)}
                        className="px-4 py-2 rounded border border-border text-foreground hover:bg-secondary"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={submittingAnnounce}
                        className="px-5 py-2 rounded btn-gradient text-primary-foreground font-semibold flex items-center gap-1.5"
                      >
                        {submittingAnnounce && <Loader2 size={12} className="animate-spin" />} Broadcast Alert
                      </button>
                    </div>
                  </form>
                )}

                <div className="flex-1 overflow-y-auto space-y-4">
                  {announcements.length === 0 ? (
                    <div className="text-center py-20 text-muted-foreground text-sm">No announcements broadcasted yet.</div>
                  ) : (
                    announcements.map((ann) => (
                      <div key={ann.id} className="p-5 rounded-xl border border-border hover:bg-secondary/10 transition-colors space-y-2">
                        <div className="flex justify-between items-start gap-4">
                          <div>
                            <span className="text-[9px] font-bold tracking-wider uppercase bg-accent/10 text-accent px-2 py-0.5 rounded">
                              {ann.department_name ? `Dept: ${ann.department_name}` : "Broadcast (Public)"}
                            </span>
                            <h3 className="font-semibold text-sm text-foreground mt-1.5">{ann.title}</h3>
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {format(new Date(ann.created_at), "MMM dd, hh:mm a")}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed font-light">{ann.content}</p>
                        <div className="text-[10px] text-foreground font-semibold pt-1">
                          Posted by: <span className="text-accent">{ann.author_name}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="chat-pane"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="flex-1 flex h-full overflow-hidden"
              >
                {/* Contact List */}
                <div className="w-72 border-r border-border flex-shrink-0 hidden md:flex flex-col">
                  <div className="p-3 border-b border-border">
                    <input placeholder="Search..." className="w-full px-3 py-2 rounded-lg bg-secondary text-xs text-foreground placeholder:text-muted-foreground focus:outline-none input-focus" />
                  </div>
                  <div className="flex-1 overflow-auto">
                    {contacts.map((c) => (
                      <motion.button
                        key={c.id}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setActiveContact(c.id)}
                        className={`w-full text-left p-4 border-b border-border transition-colors duration-200 ${
                          activeContact === c.id ? "bg-secondary" : "hover:bg-secondary/50"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 btn-gradient rounded-full flex items-center justify-center text-primary-foreground text-xs font-bold flex-shrink-0">
                            {c.name[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-foreground truncate">{c.name}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{c.last_message}</p>
                          </div>
                          {c.last_message_time && (
                            <span className="text-[9px] text-muted-foreground ml-auto flex-shrink-0">
                              {formatMsgTime(c.last_message_time)}
                            </span>
                          )}
                        </div>
                      </motion.button>
                    ))}
                  </div>
                </div>

                {/* Chat */}
                <div className="flex-1 flex flex-col h-full">
                  <div className="p-4 border-b border-border">
                    <p className="font-semibold text-xs text-foreground">{activeContactName || "Select a team contact"}</p>
                    <p className="text-[10px] text-accent font-semibold">Online</p>
                  </div>
                  <div className="flex-1 overflow-auto p-4 space-y-3.5">
                    {messages.map((m) => (
                      <div
                        key={m.id}
                        className={`flex ${m.sent_by_user ? "justify-end" : "justify-start"}`}
                      >
                        <div className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-xs ${
                          m.sent_by_user
                            ? "btn-gradient text-primary-foreground rounded-br-md shadow-md"
                            : "bg-secondary text-secondary-foreground rounded-bl-md"
                        }`}>
                          <p className="leading-relaxed font-light">{m.text}</p>
                          <p className={`text-[9px] mt-1 text-right ${m.sent_by_user ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                            {formatMsgTime(m.created_at)}
                          </p>
                        </div>
                      </div>
                    ))}
                    <div ref={bottomRef} />
                  </div>
                  <div className="p-3 border-t border-border flex gap-2">
                    <input
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSendChat()}
                      placeholder="Type a message..."
                      className="flex-1 px-4 py-2.5 rounded-lg bg-secondary text-xs text-foreground placeholder:text-muted-foreground focus:outline-none input-focus"
                    />
                    <motion.button
                      whileTap={{ scale: 0.9 }}
                      onClick={handleSendChat}
                      className="w-10 h-10 rounded-lg btn-gradient text-primary-foreground flex items-center justify-center shadow-md hover:shadow-lg transition-shadow"
                    >
                      <Send size={16} />
                    </motion.button>
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
