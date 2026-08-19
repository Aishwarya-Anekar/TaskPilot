import { Bell, Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { motion } from "framer-motion";

export function TopNavbar() {
  const { isDark, toggle } = useTheme();
  const { user } = useAuth();

  const initials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  return (
    <header className="h-16 glass border-b border-border flex items-center justify-end px-6 sticky top-0 z-20">
      <div className="flex items-center gap-3">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={toggle}
          className="p-2 rounded-lg hover:bg-secondary transition-colors"
        >
          {isDark ? <Sun size={20} className="text-warning" /> : <Moon size={20} className="text-muted-foreground" />}
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.9 }}
          className="relative p-2 rounded-lg hover:bg-secondary transition-colors"
        >
          <Bell size={20} className="text-muted-foreground" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-accent rounded-full animate-pulse" />
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
