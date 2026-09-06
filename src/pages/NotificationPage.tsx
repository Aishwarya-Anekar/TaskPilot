import { Bell, CheckCheck, Clock, AlertTriangle, ClipboardCheck, Megaphone, CalendarDays } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut } from "@/lib/api";

interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  entity_type?: string;
  entity_id?: number;
  read_at?: string;
  created_at: string;
}

const icons: Record<string, typeof Bell> = {
  task_overdue: AlertTriangle,
  deadline_3_days: Clock,
  deadline_1_day: Clock,
  deadline_today: AlertTriangle,
  new_announcement: Megaphone,
  booking_status_changed: CalendarDays,
  task_approved: ClipboardCheck,
  task_rejected: AlertTriangle,
  task_submitted: ClipboardCheck,
};

export default function NotificationPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: notifications = [], isLoading } = useQuery<Notification[]>({
    queryKey: ["notifications"],
    queryFn: () => apiGet("/notifications"),
  });
  const markAll = useMutation({
    mutationFn: () => apiPut("/notifications/read-all", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
  });
  const openNotification = async (notification: Notification) => {
    if (!notification.read_at) {
      await apiPut(`/notifications/${notification.id}/read`, {});
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
    }
    if (notification.entity_type === "task" && notification.entity_id) navigate(`/track/${notification.entity_id}`);
    else if (notification.entity_type === "event") navigate("/track");
    else if (notification.entity_type === "announcement") navigate("/communication");
    else navigate("/notifications");
  };

  return (
    <section className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div><p className="text-sm text-accent font-semibold">Inbox</p><h1 className="text-3xl font-bold text-foreground">Notifications</h1></div>
        <button onClick={() => markAll.mutate()} disabled={!notifications.some((item) => !item.read_at)} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-secondary disabled:opacity-50"><CheckCheck size={16} /> Mark all read</button>
      </div>
      <div className="space-y-3">
        {isLoading && <p className="text-muted-foreground">Loading notifications...</p>}
        {!isLoading && notifications.length === 0 && <div className="py-16 text-center border border-dashed border-border rounded-xl"><Bell className="mx-auto mb-3 text-muted-foreground" /><p className="text-muted-foreground">You are all caught up.</p></div>}
        {notifications.map((notification) => {
          const Icon = icons[notification.type] || Bell;
          return <button key={notification.id} onClick={() => openNotification(notification)} className={`w-full text-left flex gap-4 p-4 rounded-xl border transition-colors hover:bg-secondary ${notification.read_at ? "border-border bg-card" : "border-accent/40 bg-accent/5"}`}>
            <span className="p-2 rounded-lg bg-secondary text-accent shrink-0"><Icon size={19} /></span>
            <span className="min-w-0"><span className="flex items-center gap-2 font-semibold text-foreground">{notification.title}{!notification.read_at && <span className="w-2 h-2 rounded-full bg-accent" />}</span><span className="block text-sm text-muted-foreground mt-1">{notification.message}</span><span className="block text-xs text-muted-foreground mt-2">{new Date(notification.created_at).toLocaleString()}</span></span>
          </button>;
        })}
      </div>
    </section>
  );
}