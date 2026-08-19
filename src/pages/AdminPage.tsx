import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageTransition } from "@/components/motion/PageTransition";
import { AnimatedCard } from "@/components/motion/AnimatedCard";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { toast } from "sonner";
import { Loader2, Plus, Users, FolderOpen, Calendar, ShieldAlert, LayoutGrid, Check, RotateCcw, Settings } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface Department {
  id: number;
  name: string;
  description: string;
}

interface Employee {
  id: number;
  name: string;
  email: string;
  role: string;
  department: string | null;
  department_id: number | null;
}

interface Resource {
  id: number;
  name: string;
  type: string;
  status: string;
}

interface Booking {
  id: number;
  resource_name: string;
  event_title: string;
  booked_by_name: string;
  start_time: string;
  end_time: string;
}

interface SystemLog {
  id: number;
  user_name: string;
  user_email: string;
  user_role: string;
  action: string;
  details: string;
  created_at: string;
}

export default function AdminPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const isSuperAdmin = user?.role === "super_admin";

  const getInitialTab = (): "departments" | "employees" | "resources" | "logs" | "settings" => {
    if (tabParam === "departments" || tabParam === "employees" || tabParam === "resources" || tabParam === "logs" || tabParam === "settings") {
      return tabParam;
    }
    return isSuperAdmin ? "logs" : "departments";
  };

  const [activeTab, setActiveTabState] = useState<"departments" | "employees" | "resources" | "logs" | "settings">(getInitialTab);

  const setActiveTab = (tab: "departments" | "employees" | "resources" | "logs" | "settings") => {
    setActiveTabState(tab);
    setSearchParams({ tab });
  };

  useEffect(() => {
    if (tabParam === "departments" || tabParam === "employees" || tabParam === "resources" || tabParam === "logs" || tabParam === "settings") {
      setActiveTabState(tabParam);
    }
  }, [tabParam]);

  // Forms states
  const [submitting, setSubmitting] = useState(false);

  // System Settings state
  const [maintenanceMode, setMaintenanceMode] = useState(() => localStorage.getItem("sys_maintenance") === "true");
  const [allowSignup, setAllowSignup] = useState(() => localStorage.getItem("sys_allow_signup") !== "false");
  const [enableAudit, setEnableAudit] = useState(() => localStorage.getItem("sys_enable_audit") !== "false");
  const [enableNotifs, setEnableNotifs] = useState(() => localStorage.getItem("sys_enable_notifs") !== "false");
  const [orgName, setOrgName] = useState(() => localStorage.getItem("sys_org_name") || "TaskPilot Organization");
  const [systemEmail, setSystemEmail] = useState(() => localStorage.getItem("sys_email") || "support@taskpilot.com");

  const handleSaveSettings = () => {
    localStorage.setItem("sys_maintenance", String(maintenanceMode));
    localStorage.setItem("sys_allow_signup", String(allowSignup));
    localStorage.setItem("sys_enable_audit", String(enableAudit));
    localStorage.setItem("sys_enable_notifs", String(enableNotifs));
    localStorage.setItem("sys_org_name", orgName);
    localStorage.setItem("sys_email", systemEmail);
    toast.success("System configurations updated successfully!");
  };

  const [resettingDb, setResettingDb] = useState(false);
  const handleResetDb = async () => {
    if (!confirm("Warning: This will re-initialize database tables and seed sample data. All current modifications will be reset. Proceed?")) return;
    setResettingDb(true);
    try {
      await apiPost("/admin/reseed", {});
      toast.success("Database reinitialized and seeded successfully!");
      queryClient.invalidateQueries();
    } catch (err: any) {
      toast.error(err.message || "Failed to reset database");
    } finally {
      setResettingDb(false);
    }
  };

  // Department Form
  const [deptName, setDeptName] = useState("");
  const [deptDesc, setDeptDesc] = useState("");

  // Employee Form
  const [empName, setEmpName] = useState("");
  const [empEmail, setEmpEmail] = useState("");
  const [empPass, setEmpPass] = useState("");
  const [empRole, setEmpRole] = useState("employee");
  const [empDeptId, setEmpDeptId] = useState("");

  // Resource Form
  const [resName, setResName] = useState("");
  const [resType, setResType] = useState("Room");

  // Queries
  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["manageDepartments"],
    queryFn: () => apiGet("/admin/departments"),
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["manageEmployees"],
    queryFn: () => apiGet("/admin/employees"),
  });

  const { data: resourcesData } = useQuery<{ resources: Resource[]; bookings: Booking[] }>({
    queryKey: ["manageResources"],
    queryFn: () => apiGet("/admin/resources"),
  });

  const { data: systemLogs = [] } = useQuery<SystemLog[]>({
    queryKey: ["manageLogs"],
    queryFn: () => apiGet("/admin/logs"),
    enabled: isSuperAdmin,
  });

  const allResources = resourcesData?.resources || [];
  const allBookings = resourcesData?.bookings || [];

  // Create Department
  const handleCreateDept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deptName.trim()) return;
    setSubmitting(true);
    try {
      await apiPost("/admin/departments", { name: deptName, description: deptDesc });
      setDeptName("");
      setDeptDesc("");
      queryClient.invalidateQueries({ queryKey: ["manageDepartments"] });
      toast.success("Department created successfully!");
    } catch (err: any) {
      toast.error(err.message || "Failed to create department");
    } finally {
      setSubmitting(false);
    }
  };

  // Create User
  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empName.trim() || !empEmail.trim() || !empPass.trim()) return;
    setSubmitting(true);
    try {
      await apiPost("/admin/employees", {
        name: empName,
        email: empEmail,
        password: empPass,
        role: empRole,
        department_id: empDeptId ? parseInt(empDeptId) : undefined,
      });
      setEmpName("");
      setEmpEmail("");
      setEmpPass("");
      setEmpDeptId("");
      queryClient.invalidateQueries({ queryKey: ["manageEmployees"] });
      toast.success("User registered successfully!");
    } catch (err: any) {
      toast.error(err.message || "Failed to register user");
    } finally {
      setSubmitting(false);
    }
  };

  // Create Resource
  const handleCreateResource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resName.trim()) return;
    setSubmitting(true);
    try {
      await apiPost("/admin/resources", { name: resName, type: resType });
      setResName("");
      queryClient.invalidateQueries({ queryKey: ["manageResources"] });
      toast.success("Resource added successfully!");
    } catch (err: any) {
      toast.error(err.message || "Failed to add resource");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageTransition>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Management Console</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Configure employees, departments, resources, and view audits.</p>
          </div>

          {/* Configuration Tabs */}
          <div className="flex flex-wrap bg-secondary p-1 rounded-lg">
            {isSuperAdmin && (
              <button
                onClick={() => setActiveTab("logs")}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  activeTab === "logs" ? "btn-gradient text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <ShieldAlert size={14} /> Audit Logs
              </button>
            )}
            {isSuperAdmin && (
              <button
                onClick={() => setActiveTab("settings")}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  activeTab === "settings" ? "btn-gradient text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <LayoutGrid size={14} /> System Settings
              </button>
            )}
            <button
              onClick={() => setActiveTab("departments")}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${
                activeTab === "departments" ? "btn-gradient text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <FolderOpen size={14} /> Departments
            </button>
            <button
              onClick={() => setActiveTab("employees")}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${
                activeTab === "employees" ? "btn-gradient text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Users size={14} /> Employees
            </button>
            <button
              onClick={() => setActiveTab("resources")}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${
                activeTab === "resources" ? "btn-gradient text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Calendar size={14} /> Resources
            </button>
          </div>
        </div>

        <div className="bg-card rounded-xl card-elevated p-6 min-h-[50vh]">
          <AnimatePresence mode="wait">
            {/* Audit Logs tab */}
            {activeTab === "logs" && isSuperAdmin && (
              <motion.div
                key="logs-panel"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-4"
              >
                <h2 className="font-bold text-sm text-foreground uppercase tracking-wider">System Security & Audit Trail</h2>
                <div className="overflow-x-auto border border-border rounded-lg">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-secondary/40 border-b border-border text-muted-foreground">
                        <th className="text-left p-3 font-bold uppercase">Log ID</th>
                        <th className="text-left p-3 font-bold uppercase">User</th>
                        <th className="text-left p-3 font-bold uppercase">Role</th>
                        <th className="text-left p-3 font-bold uppercase">Action</th>
                        <th className="text-left p-3 font-bold uppercase">Audit Details</th>
                        <th className="text-left p-3 font-bold uppercase">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {systemLogs.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-4 text-center text-muted-foreground">No audit entries found.</td>
                        </tr>
                      ) : (
                        systemLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-secondary/10 text-muted-foreground">
                            <td className="p-3 font-semibold text-foreground">#{log.id}</td>
                            <td className="p-3 text-foreground">{log.user_name} ({log.user_email})</td>
                            <td className="p-3 capitalize">{log.user_role.replace('_', ' ')}</td>
                            <td className="p-3 font-semibold text-accent">{log.action}</td>
                            <td className="p-3 leading-relaxed font-light">{log.details}</td>
                            <td className="p-3">{new Date(log.created_at).toLocaleString()}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}

            {/* Departments tab */}
            {activeTab === "departments" && (
              <motion.div
                key="dept-panel"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="grid md:grid-cols-3 gap-6"
              >
                {/* Create Form */}
                <div className="space-y-4">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-foreground">Create Department</h3>
                  <form onSubmit={handleCreateDept} className="space-y-3 bg-secondary/10 p-4 border border-border rounded-lg">
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-muted-foreground mb-1">Name</label>
                      <input
                        value={deptName}
                        onChange={(e) => setDeptName(e.target.value)}
                        placeholder="e.g., Marketing / HR"
                        required
                        className="w-full text-xs px-3.5 py-2.5 rounded-lg input-focus text-foreground focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-muted-foreground mb-1">Description</label>
                      <textarea
                        value={deptDesc}
                        onChange={(e) => setDeptDesc(e.target.value)}
                        placeholder="Brief summary..."
                        rows={3.5}
                        className="w-full text-xs px-3.5 py-2.5 rounded-lg input-focus text-foreground focus:outline-none resize-none"
                      />
                    </div>
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      type="submit"
                      disabled={submitting}
                      className="w-full py-2.5 rounded-lg btn-gradient text-primary-foreground font-semibold flex items-center justify-center gap-1.5 text-xs shadow"
                    >
                      {submitting && <Loader2 size={12} className="animate-spin" />} Create Department
                    </motion.button>
                  </form>
                </div>

                {/* List */}
                <div className="md:col-span-2 space-y-4">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-foreground">Organizational Departments</h3>
                  <div className="grid sm:grid-cols-2 gap-4">
                    {departments.length === 0 ? (
                      <p className="text-xs text-muted-foreground p-4">No departments found.</p>
                    ) : (
                      departments.map((d) => (
                        <AnimatedCard key={d.id} className="p-4 bg-secondary/20 border border-border/50 rounded-lg">
                          <h4 className="font-semibold text-xs text-foreground">{d.name}</h4>
                          <p className="text-[11px] text-muted-foreground leading-relaxed mt-1.5 font-light">{d.description || "No description provided."}</p>
                        </AnimatedCard>
                      ))
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {/* Employees tab */}
            {activeTab === "employees" && (
              <motion.div
                key="employee-panel"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="grid md:grid-cols-3 gap-6"
              >
                {/* Register Employee Form */}
                <div className="space-y-4">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-foreground">Register User Profile</h3>
                  <form onSubmit={handleCreateEmployee} className="space-y-3 bg-secondary/10 p-4 border border-border rounded-lg">
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-muted-foreground mb-1">Full Name</label>
                      <input
                        value={empName}
                        onChange={(e) => setEmpName(e.target.value)}
                        placeholder="John Smith"
                        required
                        className="w-full text-xs px-3.5 py-2 rounded-lg input-focus text-foreground focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-muted-foreground mb-1">Email</label>
                      <input
                        type="email"
                        value={empEmail}
                        onChange={(e) => setEmpEmail(e.target.value)}
                        placeholder="name@taskpilot.com"
                        required
                        className="w-full text-xs px-3.5 py-2 rounded-lg input-focus text-foreground focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-muted-foreground mb-1">Temp Password</label>
                      <input
                        type="password"
                        value={empPass}
                        onChange={(e) => setEmpPass(e.target.value)}
                        placeholder="••••••••"
                        required
                        className="w-full text-xs px-3.5 py-2 rounded-lg input-focus text-foreground focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-muted-foreground mb-1">Role</label>
                        <select
                          value={empRole}
                          onChange={(e) => setEmpRole(e.target.value)}
                          className="w-full text-[11px] px-2 py-2 rounded-lg input-focus text-foreground bg-background focus:outline-none cursor-pointer"
                        >
                          <option value="employee">Employee</option>
                          <option value="dept_head">Dept Head</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-muted-foreground mb-1">Department</label>
                        <select
                          value={empDeptId}
                          onChange={(e) => setEmpDeptId(e.target.value)}
                          className="w-full text-[11px] px-2 py-2 rounded-lg input-focus text-foreground bg-background focus:outline-none cursor-pointer"
                        >
                          <option value="">None</option>
                          {departments.map((d) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      type="submit"
                      disabled={submitting}
                      className="w-full py-2.5 mt-2 rounded-lg btn-gradient text-primary-foreground font-semibold flex items-center justify-center gap-1.5 text-xs shadow"
                    >
                      {submitting && <Loader2 size={12} className="animate-spin" />} Register User
                    </motion.button>
                  </form>
                </div>

                {/* List */}
                <div className="md:col-span-2 space-y-4">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-foreground">Active Staff Directory</h3>
                  <div className="overflow-x-auto border border-border rounded-lg">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-secondary/40 border-b border-border text-muted-foreground text-left">
                          <th className="p-3 font-bold uppercase">Name</th>
                          <th className="p-3 font-bold uppercase">Email</th>
                          <th className="p-3 font-bold uppercase">Role</th>
                          <th className="p-3 font-bold uppercase">Department</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border text-muted-foreground">
                        {employees.map((emp) => (
                          <tr key={emp.id} className="hover:bg-secondary/10">
                            <td className="p-3 text-foreground font-medium">{emp.name}</td>
                            <td className="p-3">{emp.email}</td>
                            <td className="p-3 capitalize">{emp.role.replace('_', ' ')}</td>
                            <td className="p-3 font-medium text-foreground">{emp.department || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Resources tab */}
            {activeTab === "resources" && (
              <motion.div
                key="resource-panel"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="grid md:grid-cols-3 gap-6"
              >
                {/* Form */}
                <div className="space-y-4">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-foreground">Add Resource</h3>
                  <form onSubmit={handleCreateResource} className="space-y-3 bg-secondary/10 p-4 border border-border rounded-lg">
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-muted-foreground mb-1">Resource Name</label>
                      <input
                        value={resName}
                        onChange={(e) => setResName(e.target.value)}
                        placeholder="e.g., Conf Room B / Soundbar"
                        required
                        className="w-full text-xs px-3.5 py-2 rounded-lg input-focus text-foreground focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-muted-foreground mb-1">Type</label>
                      <select
                        value={resType}
                        onChange={(e) => setResType(e.target.value)}
                        className="w-full text-xs px-3 py-2 rounded-lg input-focus text-foreground bg-background focus:outline-none cursor-pointer"
                      >
                        <option>Room</option>
                        <option>Equipment</option>
                        <option>Service</option>
                      </select>
                    </div>
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      type="submit"
                      disabled={submitting}
                      className="w-full py-2.5 rounded-lg btn-gradient text-primary-foreground font-semibold flex items-center justify-center gap-1.5 text-xs shadow"
                    >
                      {submitting && <Loader2 size={12} className="animate-spin" />} Add Resource
                    </motion.button>
                  </form>
                </div>

                {/* Lists */}
                <div className="md:col-span-2 space-y-6">
                  <div>
                    <h3 className="font-bold text-xs uppercase tracking-wider text-foreground mb-3">Resource Inventory</h3>
                    <div className="grid sm:grid-cols-2 gap-3 text-xs">
                      {allResources.map((res) => (
                        <div key={res.id} className="p-3 bg-secondary/20 border border-border/50 rounded-lg flex justify-between items-center">
                          <div>
                            <p className="font-semibold text-foreground">{res.name}</p>
                            <p className="text-[10px] text-muted-foreground uppercase mt-0.5">{res.type}</p>
                          </div>
                          <span className="text-[9px] font-bold tracking-wider uppercase bg-success/10 text-success px-2 py-0.5 rounded-full">
                            {res.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="font-bold text-xs uppercase tracking-wider text-foreground mb-3">Active Allocation Bookings</h3>
                    <div className="overflow-x-auto border border-border rounded-lg">
                      <table className="w-full text-xs text-left">
                        <thead>
                          <tr className="bg-secondary/40 border-b border-border text-muted-foreground">
                            <th className="p-3 font-bold uppercase">Resource</th>
                            <th className="p-3 font-bold uppercase">Linked Event</th>
                            <th className="p-3 font-bold uppercase">Booked By</th>
                            <th className="p-3 font-bold uppercase">Timing Range</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border text-muted-foreground">
                          {allBookings.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="p-3 text-center">No resource bookings recorded.</td>
                            </tr>
                          ) : (
                            allBookings.map((b) => (
                              <tr key={b.id} className="hover:bg-secondary/10">
                                <td className="p-3 font-semibold text-foreground">{b.resource_name}</td>
                                <td className="p-3">{b.event_title}</td>
                                <td className="p-3 font-medium text-foreground">{b.booked_by_name}</td>
                                <td className="p-3 leading-normal font-light">
                                  {new Date(b.start_time).toLocaleString()} to <br />
                                  {new Date(b.end_time).toLocaleString()}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Settings Tab */}
            {activeTab === "settings" && isSuperAdmin && (
              <motion.div
                key="settings-panel"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                <div>
                  <h2 className="font-bold text-sm text-foreground uppercase tracking-wider mb-1">Organization Toggles & Settings</h2>
                  <p className="text-xs text-muted-foreground">Configure global system configurations, system flags, and operations parameters.</p>
                </div>

                <div className="grid md:grid-cols-3 gap-6">
                  {/* Left Column: Input Forms */}
                  <div className="md:col-span-2 space-y-4">
                    <div className="bg-secondary/10 border border-border/50 p-4 rounded-xl space-y-4">
                      <h3 className="font-bold text-xs uppercase tracking-wider text-foreground">Platform Identity</h3>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground font-medium">Organization Name</label>
                          <input
                            type="text"
                            value={orgName}
                            onChange={(e) => setOrgName(e.target.value)}
                            className="w-full bg-secondary/30 text-foreground border border-border/50 p-2 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground font-medium">System Support Email</label>
                          <input
                            type="email"
                            value={systemEmail}
                            onChange={(e) => setSystemEmail(e.target.value)}
                            className="w-full bg-secondary/30 text-foreground border border-border/50 p-2 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="bg-secondary/10 border border-border/50 p-4 rounded-xl space-y-3">
                      <h3 className="font-bold text-xs uppercase tracking-wider text-foreground mb-1">Global System Flags</h3>
                      
                      <div className="flex items-center justify-between p-2 hover:bg-secondary/20 rounded-lg transition-colors">
                        <div>
                          <p className="text-xs font-semibold text-foreground">Maintenance Mode</p>
                          <p className="text-[10px] text-muted-foreground">Freeze operations and display warning banners to users.</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={maintenanceMode}
                          onChange={(e) => setMaintenanceMode(e.target.checked)}
                          className="w-4 h-4 text-accent border-border/50 rounded focus:ring-0 cursor-pointer"
                        />
                      </div>

                      <div className="flex items-center justify-between p-2 hover:bg-secondary/20 rounded-lg transition-colors">
                        <div>
                          <p className="text-xs font-semibold text-foreground">Allow Self-Registration</p>
                          <p className="text-[10px] text-muted-foreground">Let employees register their own accounts on the login portal.</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={allowSignup}
                          onChange={(e) => setAllowSignup(e.target.checked)}
                          className="w-4 h-4 text-accent border-border/50 rounded focus:ring-0 cursor-pointer"
                        />
                      </div>

                      <div className="flex items-center justify-between p-2 hover:bg-secondary/20 rounded-lg transition-colors">
                        <div>
                          <p className="text-xs font-semibold text-foreground">Enable Automation Security Audit</p>
                          <p className="text-[10px] text-muted-foreground">Record audit trails for every minor checkin and log entry.</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={enableAudit}
                          onChange={(e) => setEnableAudit(e.target.checked)}
                          className="w-4 h-4 text-accent border-border/50 rounded focus:ring-0 cursor-pointer"
                        />
                      </div>

                      <div className="flex items-center justify-between p-2 hover:bg-secondary/20 rounded-lg transition-colors">
                        <div>
                          <p className="text-xs font-semibold text-foreground">Global SMS & Email Notifications</p>
                          <p className="text-[10px] text-muted-foreground">Allow dispatching simulated email alerts on assignments.</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={enableNotifs}
                          onChange={(e) => setEnableNotifs(e.target.checked)}
                          className="w-4 h-4 text-accent border-border/50 rounded focus:ring-0 cursor-pointer"
                        />
                      </div>
                    </div>

                    <button
                      onClick={handleSaveSettings}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold btn-gradient text-primary-foreground shadow-sm"
                    >
                      <Check size={14} /> Save Configurations
                    </button>
                  </div>

                  {/* Right Column: Danger Zone / System Resets */}
                  <div className="space-y-4">
                    <div className="border border-destructive/30 bg-destructive/5 p-4 rounded-xl space-y-4">
                      <h3 className="font-bold text-xs uppercase tracking-wider text-destructive flex items-center gap-1.5">
                        <ShieldAlert size={14} /> Danger Operations Zone
                      </h3>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        The following operations can disrupt platform databases. Execute only if you want to restore defaults.
                      </p>

                      <div className="space-y-2">
                        <button
                          onClick={handleResetDb}
                          disabled={resettingDb}
                          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-destructive/30 text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
                        >
                          {resettingDb ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <RotateCcw size={12} />
                          )}
                          Reset & Seed Database
                        </button>
                      </div>
                    </div>
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
