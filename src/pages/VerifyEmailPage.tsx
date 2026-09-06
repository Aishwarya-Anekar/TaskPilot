import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiGet } from "@/lib/api";

export default function VerifyEmailPage() {
  const [params] = useSearchParams(); const [message, setMessage] = useState("Verifying your email..."); const [error, setError] = useState("");
  useEffect(() => { const token = params.get("token"); if (!token) { setError("Verification link is invalid or expired."); return; } apiGet<{ message: string }>(`/auth/verify-email?token=${encodeURIComponent(token)}`).then((result) => setMessage(result.message)).catch((err) => { setMessage(""); setError(err.message || "Verification link is invalid or expired."); }); }, [params]);
  return <main className="min-h-screen flex items-center justify-center bg-background p-6"><div className="w-full max-w-md bg-card rounded-2xl card-elevated p-8 text-center space-y-4"><h1 className="text-2xl font-bold text-foreground">Email verification</h1>{message && <p className="text-success">{message}</p>}{error && <p className="text-destructive">{error}</p>}<Link to="/" className="inline-block text-sm text-accent hover:underline">Return to sign in</Link></div></main>;
}