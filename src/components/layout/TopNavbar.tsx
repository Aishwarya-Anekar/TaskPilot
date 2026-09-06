import { Bell, Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { motion } from "framer-motion";
import { GlobalSearch } from "./GlobalSearch";
import { apiGet } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

export function TopNavbar() {
  const { isDark, toggle } = useTheme();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: unread } = useQuery<{ count: number }>({
    queryKey: ["notifications-unread"],
    queryFn: () => apiGet("/notifications/unread-count"),
    refetchInterval: 30000,
  });

  const initials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  return (
    <header className="min-h-16 glass border-b border-border flex items-center justify-between gap-4 px-4 md:px-6 py-3 sticky top-0 z-20">
      <GlobalSearch />
      <div className="flex items-center gap-3 shrink-0">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={toggle}
          className="p-2 rounded-lg hover:bg-secondary transition-colors"
        >
          {isDark ? <Sun size={20} className="text-warning" /> : <Moon size={20} className="text-muted-foreground" />}
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => navigate("/notifications")}
          title="Notifications"
          className="relative p-2 rounded-lg hover:bg-secondary transition-colors"
        >
          <Bell size={20} className="text-muted-foreground" />
          {Boolean(unread?.count) && <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 bg-accent text-accent-foreground text-[10px] font-bold rounded-full flex items-center justify-center">{unread!.count > 99 ? "99+" : unread!.count}</span>}
        </motion.button>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full btn-gradient flex items-center justify-center text-primary-foreground text-sm font-semibold">
            {initials}
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-medium text-foreground">{user?.name || "User"}</p>
            <p className="text-xs text-muted-foreground">{user?.email || ""}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
