import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiPost } from "@/lib/api";
import { toast } from "sonner";

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const result = await apiPost<{ message: string }>("/auth/reset-password", { token, password, confirmPassword });
      setMessage(result.message); toast.success(result.message);
    } catch (err: any) { setError(err.message || "Unable to reset password"); }
    finally { setLoading(false); }
  };

  return <main className="min-h-screen flex items-center justify-center bg-background p-6"><form onSubmit={submit} className="w-full max-w-md bg-card rounded-2xl card-elevated p-8 space-y-5"><div><h1 className="text-2xl font-bold text-foreground">Create a new password</h1><p className="text-sm text-muted-foreground mt-1">Use 8+ characters with uppercase, lowercase, and a number.</p></div>{error && <p className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</p>}{message && <p className="p-3 rounded-lg bg-success/10 text-success text-sm">{message}</p>}<input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password" className="w-full px-3.5 py-2.5 rounded-lg input-focus text-sm text-foreground" /><input required minLength={8} type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Confirm new password" className="w-full px-3.5 py-2.5 rounded-lg input-focus text-sm text-foreground" /><button disabled={loading || !token} className="w-full py-3 rounded-lg btn-gradient text-primary-foreground font-semibold disabled:opacity-60">{loading ? "Resetting..." : "Reset password"}</button><Link to="/" className="block text-center text-sm text-accent hover:underline">Return to sign in</Link></form></main>;
}
