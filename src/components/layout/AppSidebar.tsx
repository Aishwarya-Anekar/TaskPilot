import { Home, FileText, Search, MessageSquare, Clock, User, Shield, Menu, ChevronLeft, LogOut } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";

export function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 1024);

  useEffect(() => {
    const handleResize = () => {
      setCollapsed(window.innerWidth < 1024);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleLinkClick = () => {
    if (window.innerWidth < 1024) {
      setCollapsed(true);
    }
  };

  const menuItems = [
    { title: "Dashboard", icon: Home, path: "/dashboard" },
    ...((user?.role === "admin" || user?.role === "super_admin" || user?.role === "dept_head")
      ? [{ title: "Create Task", icon: FileText, path: "/report" }]
      : []),
    { title: "Events & Tasks", icon: Search, path: "/track" },
    { title: "Collaboration", icon: MessageSquare, path: "/communication" },
    { title: "History", icon: Clock, path: "/history" },
    { title: "Profile", icon: User, path: "/profile" },
    ...((user?.role === "admin" || user?.role === "super_admin")
      ? [{ title: "Management", icon: Shield, path: "/admin" }]
      : []),
  ];

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  const initials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "??";

  return (
    <>
      {/* Mobile toggle */}
      <motion.button
        whileTap={{ scale: 0.9 }}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg btn-gradient text-primary-foreground shadow-lg"
        onClick={() => setCollapsed(!collapsed)}
      >
        <Menu size={20} />
      </motion.button>

      <aside
        className={`fixed left-0 top-0 h-full bg-primary z-40 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] flex flex-col
          ${collapsed ? "w-16" : "w-60"}
          ${collapsed ? "max-lg:-translate-x-full lg:translate-x-0" : "translate-x-0"}
        `}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-4 border-b border-sidebar-border">
          {!collapsed && (
              <motion.h1
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-xl font-bold text-primary-foreground tracking-tight"
              >
                🚀 TaskPilot
              </motion.h1>
          )}
          {collapsed && <span className="text-xl mx-auto">🚀</span>}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 space-y-1 px-2 relative">
          {menuItems.map((item) => {
            const isActive =
              item.path === "/dashboard"
                ? location.pathname === "/dashboard"
                : location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={handleLinkClick}
                className="relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-200 group"
              >
                {isActive && (
                  <motion.div
                    layoutId="sidebar-active"
                    className="absolute inset-0 bg-accent/20 rounded-lg"
                    transition={{ type: "spring", stiffness: 350, damping: 30 }}
                  />
                )}
                <motion.div
                  whileHover={{ scale: 1.15 }}
                  transition={{ type: "spring", stiffness: 400, damping: 17 }}
                  className="relative z-10"
                >
                  <item.icon
                    size={20}
                    className={isActive ? "text-accent" : "text-sidebar-foreground group-hover:text-primary-foreground transition-colors"}
                  />
                </motion.div>
                {!collapsed && (
                  <span className={`relative z-10 ${isActive ? "text-accent font-semibold" : "text-sidebar-foreground group-hover:text-primary-foreground transition-colors"}`}>
                    {item.title}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User info & Logout */}
        <div className="border-t border-sidebar-border">
          {!collapsed && user && (
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="w-8 h-8 bg-accent/30 rounded-full flex items-center justify-center text-primary-foreground text-xs font-bold flex-shrink-0">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-primary-foreground truncate">{user.name}</p>
                <p className="text-[10px] text-sidebar-foreground truncate">{user.email}</p>
              </div>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center justify-center gap-3 w-full px-3 py-3 text-sidebar-foreground hover:text-primary-foreground hover:bg-destructive/20 transition-colors text-sm"
          >
            <LogOut size={18} />
            {!collapsed && <span>Logout</span>}
          </button>
        </div>

        {/* Collapse toggle */}
        <button
          className="hidden lg:flex items-center justify-center h-12 border-t border-sidebar-border text-sidebar-foreground hover:text-primary-foreground transition-colors"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Expand Menu" : "Collapse Menu"}
        >
          <motion.div animate={{ rotate: collapsed ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronLeft size={18} />
          </motion.div>
        </button>
      </aside>

      {/* Spacer */}
      <div className={`hidden lg:block transition-all duration-300 ${collapsed ? "w-16" : "w-60"} flex-shrink-0`} />

      {/* Mobile backdrop */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="lg:hidden fixed inset-0 bg-foreground/20 z-30 backdrop-blur-sm"
            onClick={() => setCollapsed(true)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
