import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Briefcase, CheckCircle2, ArrowRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiPost } from "@/lib/api";

export default function LandingPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    try {
      if (forgotMode) {
        await apiPost("/auth/forgot-password", { email });
        setMessage("If an account exists for that email, a secure password setup or reset link has been sent.");
      } else {
        await login(email, password);
      }
      if (!forgotMode) navigate("/dashboard");
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const features = [
    "Plan events, orchestrate workflows, and assign tasks instantly.",
    "Track execution details and toggle subtask checklists.",
    "Collaborate using department comments and announcement boards.",
    "Book organizational resources and log QR-scanned attendance."
  ];

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-background">
      {/* Left Panel - Hero Section */}
      <div className="lg:flex-1 relative overflow-hidden btn-gradient flex flex-col justify-center p-8 lg:p-16 text-primary-foreground min-h-[40vh] lg:min-h-screen">
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-accent/20 rounded-full blur-3xl translate-y-1/3 -translate-x-1/3" />
        
        <div className="relative z-10 max-w-xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="flex items-center gap-3 mb-8">
              <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center shadow-lg border border-white/30">
                <Briefcase size={26} className="text-white" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight">TaskPilot</h1>
            </div>
            
            <h2 className="text-4xl lg:text-5xl font-extrabold mb-6 leading-tight">
              A digital framework for team collaboration.
            </h2>
            <p className="text-lg text-primary-foreground/80 mb-10 leading-relaxed">
              Plan, execute, and monitor organizational activities from one centralized Operations Orchestrator.
            </p>

            <div className="space-y-4 hidden sm:block">
              {features.map((feature, i) => (
                <motion.div 
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.5, delay: 0.2 + (i * 0.1) }}
                  key={i} 
                  className="flex items-start gap-3"
                >
                  <CheckCircle2 className="text-accent shrink-0 mt-0.5" size={20} />
                  <p className="text-primary-foreground/90">{feature}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      {/* Right Panel - Auth Form */}
      <div className="lg:w-[500px] xl:w-[600px] flex flex-col items-center justify-center p-6 lg:p-12 bg-background relative shrink-0 overflow-y-auto">
        <div className="w-full max-w-md my-auto">
          <motion.div
            key={forgotMode ? "forgot" : "login"}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4 }}
            className="bg-card rounded-2xl card-elevated p-6 lg:p-8 space-y-5"
          >
            <div className="text-center space-y-1 mb-4">
              <h1 className="text-2xl font-bold text-foreground">
                {forgotMode ? "Set up or reset your password" : "Welcome to TaskPilot"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {forgotMode ? "Enter your registered email address and we'll send a secure link" : "Sign in to your collaboration workspace"}
              </p>
            </div>

            <AnimatePresence mode="popLayout">
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0, y: -10 }}
                  animate={{ opacity: 1, height: "auto", y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg text-center"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>
            {message && <p className="bg-success/10 text-success text-sm p-3 rounded-lg text-center">{message}</p>}

            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1 font-medium text-foreground">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@taskpilot.com"
                  required
                  className="w-full px-3.5 py-2.5 rounded-lg input-focus text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>

              {!forgotMode && <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1 font-medium text-foreground">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full px-3.5 py-2.5 rounded-lg input-focus text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>}

              <motion.button
                whileTap={{ scale: 0.98 }}
                type="submit"
                disabled={loading}
                className="w-full py-3 mt-2 rounded-lg btn-gradient text-primary-foreground font-semibold shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all duration-200 disabled:opacity-70 flex items-center justify-center gap-2 group text-sm"
              >
                {loading && <Loader2 size={16} className="animate-spin" />}
                {!loading && <span>{forgotMode ? "Send password link" : "Sign In"}</span>}
                {!loading && <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />}
              </motion.button>
            </form>

            <div className="pt-3 border-t border-border flex flex-col items-center justify-center space-y-3">
              <p className="text-xs text-muted-foreground">
                {forgotMode ? "Remembered your password?" : "First time signing in?"}
              </p>
              <button
                type="button"
                onClick={() => { setForgotMode(!forgotMode); setError(""); setMessage(""); }}
                className="w-full py-2 rounded-lg border border-input bg-transparent hover:bg-secondary text-foreground font-medium transition-colors text-xs"
              >
                {forgotMode ? "Sign in instead" : "Set up password / Forgot password"}
              </button>
              {!forgotMode && <p className="text-xs text-muted-foreground text-center">New accounts are created by your Super Admin. Use the password setup link sent to your email.</p>}
            </div>

          </motion.div>
        </div>
      </div>
    </div>
  );
}
