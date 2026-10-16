import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { apiGet, apiPost } from "@/lib/api";

export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  department: string | null;
  semester: string | null;
  college_role?: string | null;
  employee_id?: string | null;
  designation?: string | null;
  phone_number?: string | null;
  bio?: string | null;
  profile_photo?: string | null;
  created_at?: string;
  sms_notifications: boolean;
  email_notifications: boolean;
  push_notifications: boolean;
  task_assignment_notifications?: boolean;
  task_deadline_notifications?: boolean;
  event_reminder_notifications?: boolean;
  task_status_notifications?: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(
    localStorage.getItem("cc_token")
  );
  const [loading, setLoading] = useState(true);

  const refreshUser = async () => {
    try {
      const userData = await apiGet<User>("/auth/me");
      setUser(userData);
    } catch {
      setUser(null);
      setToken(null);
      localStorage.removeItem("cc_token");
    }
  };

  useEffect(() => {
    if (token) {
      refreshUser().finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email: string, password: string) => {
    const data = await apiPost<{ user: User; token: string }>("/auth/login", {
      email,
      password,
    });
    localStorage.setItem("cc_token", data.token);
    setToken(data.token);
    setUser(data.user);
  };

  const logout = () => {
    localStorage.removeItem("cc_token");
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, token, loading, login, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
