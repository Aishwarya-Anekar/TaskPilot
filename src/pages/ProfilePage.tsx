import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Mail, Smartphone, BellRing } from "lucide-react";
import { PageTransition } from "@/components/motion/PageTransition";
import { useAuth } from "@/contexts/AuthContext";
import { apiPut } from "@/lib/api";

export default function ProfilePage() {
  const { user } = useAuth();
  const [sms, setSms] = useState(user?.sms_notifications ?? true);
  const [email, setEmail] = useState(user?.email_notifications ?? true);
  const [push, setPush] = useState(user?.push_notifications ?? false);

  // Password change
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const handleToggle = async (
    label: string,
    value: boolean,
    setter: (v: boolean) => void,
    field: string
  ) => {
    const newValue = !value;
    setter(newValue);
    try {
      await apiPut("/auth/me", { [field]: newValue });
      toast.success(`${label} ${newValue ? "enabled" : "disabled"}`);
    } catch {
      setter(value); // revert
      toast.error("Failed to update preference");
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) return;
    setChangingPassword(true);
    try {
      await apiPut("/auth/me", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      toast.success("Password changed successfully");
      setShowPasswordForm(false);
      setCurrentPassword("");
      setNewPassword("");
    } catch (err: any) {
      toast.error(err.message || "Failed to change password");
    } finally {
      setChangingPassword(false);
    }
  };

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "??";

  return (
    <PageTransition>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* User Card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card rounded-xl card-elevated p-6 flex flex-col sm:flex-row items-center gap-5"
        >
          <div className="w-20 h-20 btn-gradient rounded-full flex items-center justify-center text-primary-foreground text-2xl font-bold shadow-lg">
            {initials}
          </div>
          <div className="text-center sm:text-left">
            <h1 className="text-xl font-bold text-foreground">
              {user?.name || "User"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {user?.email || "—"}
            </p>
            <div className="flex flex-wrap gap-2 mt-2 justify-center sm:justify-start">
              {user?.department && (
                <span className="text-xs bg-secondary text-secondary-foreground px-3 py-1 rounded-full font-medium">
                  Department: {user.department}
                </span>
              )}
              {user?.semester && (
                <span className="text-xs bg-secondary text-secondary-foreground px-3 py-1 rounded-full font-medium">
                  Semester: {user.semester}
                </span>
              )}
              <span className="text-xs bg-accent/10 text-accent px-3 py-1 rounded-full font-bold uppercase tracking-wide">
                Role: {user?.role.replace('_', ' ') || "employee"}
              </span>
            </div>
          </div>
        </motion.div>

        {/* Notification Preferences */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-card rounded-xl card-elevated p-6"
        >
          <h2 className="font-bold text-sm text-foreground mb-4 uppercase tracking-wider flex items-center gap-2">
            <BellRing size={18} className="text-accent" /> Notification Toggles
          </h2>
          <div className="space-y-4">
            {[
              { label: "SMS Alerts", value: sms, setter: setSms, field: "sms_notifications", icon: Smartphone },
              { label: "Email Notifications", value: email, setter: setEmail, field: "email_notifications", icon: Mail },
              { label: "Push Notifications", value: push, setter: setPush, field: "push_notifications", icon: ShieldCheck },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between">
                <span className="text-xs text-foreground font-medium flex items-center gap-2">
                  <item.icon size={16} className="text-muted-foreground" /> {item.label}
                </span>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={() =>
                    handleToggle(item.label, item.value, item.setter, item.field)
                  }
                  className={`w-11 h-6 rounded-full transition-colors duration-300 relative ${
                    item.value ? "bg-accent" : "bg-muted"
                  }`}
                >
                  <motion.div
                    className="w-5 h-5 bg-card rounded-full absolute top-0.5 shadow-sm"
                    animate={{ x: item.value ? 22 : 2 }}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                </motion.button>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Security */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-card rounded-xl card-elevated p-6"
        >
          <h2 className="font-bold text-sm text-foreground mb-4 uppercase tracking-wider">Account Security</h2>
          {!showPasswordForm ? (
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowPasswordForm(true)}
              className="px-5 py-2.5 rounded-lg border border-border text-foreground hover:bg-secondary transition-colors text-xs font-semibold"
            >
              Update Password
            </motion.button>
          ) : (
            <form onSubmit={handlePasswordChange} className="space-y-3 max-w-sm">
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Current password"
                required
                className="w-full px-4 py-2.5 rounded-lg input-focus text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (min 6 chars)"
                required
                minLength={6}
                className="w-full px-4 py-2.5 rounded-lg input-focus text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              <div className="flex gap-2">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  type="submit"
                  disabled={changingPassword}
                  className="px-5 py-2 rounded-lg btn-gradient text-primary-foreground text-xs font-semibold flex items-center gap-2"
                >
                  {changingPassword && <Loader2 size={12} className="animate-spin" />}
                  {changingPassword ? "Saving..." : "Save Password"}
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  type="button"
                  onClick={() => {
                    setShowPasswordForm(false);
                    setCurrentPassword("");
                    setNewPassword("");
                  }}
                  className="px-5 py-2 rounded-lg border border-border text-foreground text-xs font-semibold hover:bg-secondary transition-colors"
                >
                  Cancel
                </motion.button>
              </div>
            </form>
          )}
        </motion.div>
      </div>
    </PageTransition>
  );
}
