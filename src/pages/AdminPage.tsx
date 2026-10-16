import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageTransition } from "@/components/motion/PageTransition";
import { AnimatedCard } from "@/components/motion/AnimatedCard";
import { apiFetch, apiGet, apiPost, apiPut } from "@/lib/api";
import { toast } from "sonner";
import { Loader2, Plus, Users, FolderOpen, Calendar, ShieldAlert, LayoutGrid, Check, RotateCcw, Settings, Search, Pencil, Eye, FileDown, FileText, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Department {
  id: number;
  name: string;
  description: string;
  department_code: string | null;
  department_type: "academic" | "administrative" | "support";
  contact_email: string | null;
  hod_user_id: number | null;
  hod_name: string | null;
  is_active: boolean;
  active_staff_count: number;
  upcoming_event_count: number;
  pending_task_count: number;
  overdue_task_count: number;
  workflow_progress: number;
}

interface Employee {
  id: number;
  name: string;
  email: string;
  role: string | null;
  college_role?: string;
  employee_id?: string | null;
  designation?: string | null;
  phone_number?: string | null;
  date_of_joining?: string | null;
  department: string | null;
  department_id: number | null;
  email_verified: boolean;
  password_setup_required: boolean;
  is_active: boolean;
}

interface EmployeeDirectoryPage {
  rows: Employee[];
  total: number;
  limit: number;
  offset: number;
}

interface DepartmentDetails extends Department {
  staff: Array<{ id: number; name: string; college_role: string; designation: string | null; is_active: boolean }>;
  events: Array<{ id: number; title: string; category: string; start_date: string; status: string }>;
  tasks: Array<{ id: number; title: string; status: string; priority: string; due_date: string | null; is_overdue: boolean }>;
}

interface Resource {
  id: number;
  name: string;
  type: string;
  status: string;
  resource_code: string | null;
  department_id: number | null;
  building_location: string | null;
  capacity: number | null;
  quantity: number | null;
  condition_status: string;
  description: string | null;
  is_active: boolean;
  maintenance_task_id: number | null;
}

interface Booking {
  id: number;
  booked_by: number;
  resource_name: string;
  event_title: string;
  booked_by_name: string;
  start_time: string;
  end_time: string;
  status: string;
  resource_id: number;
}

interface AdminEvent {
  id: number;
  title: string;
  department_id: number | null;
  status: string;
}

interface SystemLog {
  id: number;
  user_name: string;
  user_email: string;
  user_role: string | null;
  action: string;
  details: string;
  entity_type: string | null;
  entity_id: number | null;
  outcome: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
}

interface SystemLogsPage {
  rows: SystemLog[];
  total: number;
  limit: number;
  offset: number;
}

interface AuditSummary {
  total: number;
  today: number;
  successful: number;
  failed: number;
}

interface AuditOptions {
  actions: string[];
  entity_types: string[];
  outcomes: string[];
  actors: Array<{ id: number; name: string; email: string; role: string }>;
}

interface EscalationSettings {
  stage_2_hours: number;
  stage_3_hours: number;
}

interface SystemSettings {
  maintenance_mode: boolean;
  enable_audit: boolean;
  enable_notifications: boolean;
  organization_name: string;
  support_email: string;
  institution_code: string | null;
  college_address: string | null;
  timezone: string;
  academic_year: string | null;
  academic_term: string | null;
  working_days: number[];
  working_hours_start: string;
  working_hours_end: string;
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
  const [logFilter, setLogFilter] = useState("");
  const [logActorFilter, setLogActorFilter] = useState("");
  const [logEntityFilter, setLogEntityFilter] = useState("");
  const [logActionFilter, setLogActionFilter] = useState("");
  const [logOutcomeFilter, setLogOutcomeFilter] = useState("");
  const [logFrom, setLogFrom] = useState("");
  const [logTo, setLogTo] = useState("");
  const [logOffset, setLogOffset] = useState(0);
  const [selectedLog, setSelectedLog] = useState<SystemLog | null>(null);
  const [auditViewerOpen, setAuditViewerOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"csv" | "json">("csv");
  const [exportScope, setExportScope] = useState<"filtered" | "all">("filtered");
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [exportActor, setExportActor] = useState("");
  const [exportAction, setExportAction] = useState("");
  const [exportEntity, setExportEntity] = useState("");
  const [exportingLogs, setExportingLogs] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeeRoleFilter, setEmployeeRoleFilter] = useState("");
  const [employeeDepartmentFilter, setEmployeeDepartmentFilter] = useState("");
  const [employeeVerificationFilter, setEmployeeVerificationFilter] = useState("");
  const [employeeStatusFilter, setEmployeeStatusFilter] = useState("");
  const [employeeSort, setEmployeeSort] = useState("name");
  const [employeeSortDirection, setEmployeeSortDirection] = useState("asc");
  const [employeeOffset, setEmployeeOffset] = useState(0);

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
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [enableNotifs, setEnableNotifs] = useState(true);
  const [orgName, setOrgName] = useState("TaskPilot Organization");
  const [systemEmail, setSystemEmail] = useState("support@taskpilot.com");
  const [institutionCode, setInstitutionCode] = useState("");
  const [collegeAddress, setCollegeAddress] = useState("");
  const [institutionTimezone, setInstitutionTimezone] = useState("Asia/Kolkata");
  const [academicYear, setAcademicYear] = useState("");
  const [academicTerm, setAcademicTerm] = useState("");
  const [workingDays, setWorkingDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [workingHoursStart, setWorkingHoursStart] = useState("09:00");
  const [workingHoursEnd, setWorkingHoursEnd] = useState("17:00");
  const [stage2Hours, setStage2Hours] = useState("24");
  const [stage3Hours, setStage3Hours] = useState("48");

  const { data: systemSettings } = useQuery<SystemSettings>({
    queryKey: ["systemSettings"],
    queryFn: () => apiGet("/admin/settings"),
    enabled: isSuperAdmin && activeTab === "settings",
  });

  useEffect(() => {
    if (!systemSettings) return;
    setMaintenanceMode(systemSettings.maintenance_mode);
    setEnableNotifs(systemSettings.enable_notifications);
    setOrgName(systemSettings.organization_name);
    setSystemEmail(systemSettings.support_email);
    setInstitutionCode(systemSettings.institution_code || "");
    setCollegeAddress(systemSettings.college_address || "");
    setInstitutionTimezone(systemSettings.timezone || "Asia/Kolkata");
    setAcademicYear(systemSettings.academic_year || "");
    setAcademicTerm(systemSettings.academic_term || "");
    setWorkingDays(systemSettings.working_days || [1, 2, 3, 4, 5]);
    setWorkingHoursStart(String(systemSettings.working_hours_start || "09:00").slice(0, 5));
    setWorkingHoursEnd(String(systemSettings.working_hours_end || "17:00").slice(0, 5));
  }, [systemSettings]);

  const handleSaveSettings = async () => {
    try {
      await apiPut("/admin/settings", {
        maintenance_mode: maintenanceMode,
        enable_audit: true,
        enable_notifications: enableNotifs,
        organization_name: orgName,
        support_email: systemEmail,
        institution_code: institutionCode || null,
        college_address: collegeAddress,
        timezone: institutionTimezone,
        academic_year: academicYear || null,
        academic_term: academicTerm || null,
        working_days: workingDays,
        working_hours_start: workingHoursStart,
        working_hours_end: workingHoursEnd,
      });
      await queryClient.invalidateQueries({ queryKey: ["systemSettings"] });
      toast.success("System configurations updated successfully!");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save system settings");
    }
  };

  const [resettingDb, setResettingDb] = useState(false);
  const handleResetDb = async () => {
    if (!confirm("Check for missing database schema and add optional development sample data. Existing records will be preserved. Continue?")) return;
    setResettingDb(true);
    try {
      await apiPost("/admin/reseed", {});
      toast.success("Schema checked. Existing data was preserved.");
      queryClient.invalidateQueries();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to check database schema");
    } finally {
      setResettingDb(false);
    }
  };

  // Department Form
  const [deptName, setDeptName] = useState("");
  const [deptDesc, setDeptDesc] = useState("");
  const [deptCode, setDeptCode] = useState("");
  const [deptType, setDeptType] = useState<"academic" | "administrative" | "support">("academic");
  const [deptEmail, setDeptEmail] = useState("");
  const [deptHodId, setDeptHodId] = useState("");
  const [editingDepartmentId, setEditingDepartmentId] = useState<number | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState<DepartmentDetails | null>(null);

  // Employee Form
  const [empName, setEmpName] = useState("");
  const [empEmail, setEmpEmail] = useState("");
  const [empRole, setEmpRole] = useState("teacher");
  const [empDeptId, setEmpDeptId] = useState("");
  const [empId, setEmpId] = useState("");
  const [empDesignation, setEmpDesignation] = useState("");
  const [empPhone, setEmpPhone] = useState("");
  const [empJoiningDate, setEmpJoiningDate] = useState("");
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [employeeEditForm, setEmployeeEditForm] = useState({ name: "", email: "", college_role: "teacher", department_id: "", employee_id: "", designation: "", phone_number: "", date_of_joining: "" });
  const [setupLink, setSetupLink] = useState("");
  const [deletingUserId, setDeletingUserId] = useState<number | null>(null);

  // Resource Form
  const [resName, setResName] = useState("");
  const [resType, setResType] = useState("Classroom");
  const [resCode, setResCode] = useState("");
  const [resDepartmentId, setResDepartmentId] = useState("");
  const [resLocation, setResLocation] = useState("");
  const [resCapacity, setResCapacity] = useState("");
  const [resQuantity, setResQuantity] = useState("");
  const [resCondition, setResCondition] = useState("Good");
  const [resDescription, setResDescription] = useState("");
  const [resStatus, setResStatus] = useState("Available");
  const [resMaintenanceTaskId, setResMaintenanceTaskId] = useState("");
  const [editingResourceId, setEditingResourceId] = useState<number | null>(null);
  const [bookingResourceId, setBookingResourceId] = useState("");
  const [bookingEventId, setBookingEventId] = useState("");
  const [bookingStart, setBookingStart] = useState("");
  const [bookingEnd, setBookingEnd] = useState("");

  // Queries
  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["manageDepartments"],
    queryFn: () => apiGet("/admin/departments"),
  });

  const { data: employeeOptions = [] } = useQuery<Employee[]>({
    queryKey: ["manageEmployees"],
    queryFn: () => apiGet("/admin/employees"),
    enabled: isSuperAdmin,
  });

  const { data: employeeDirectory, isLoading: employeeDirectoryLoading, isError: employeeDirectoryFailed } = useQuery<EmployeeDirectoryPage>({
    queryKey: ["employeeDirectory", employeeSearch, employeeRoleFilter, employeeDepartmentFilter, employeeVerificationFilter, employeeStatusFilter, employeeSort, employeeSortDirection, employeeOffset],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "25", offset: String(employeeOffset), sort: employeeSort, direction: employeeSortDirection });
      if (employeeSearch.trim()) params.set("search", employeeSearch.trim());
      if (employeeRoleFilter) params.set("college_role", employeeRoleFilter);
      if (employeeDepartmentFilter) params.set("department_id", employeeDepartmentFilter);
      if (employeeVerificationFilter) params.set("email_verified", employeeVerificationFilter);
      if (employeeStatusFilter) params.set("is_active", employeeStatusFilter);
      return apiGet(`/admin/employees/directory?${params.toString()}`);
    },
    enabled: isSuperAdmin && activeTab === "employees",
  });
  const employees = employeeDirectory?.rows ?? [];

  useEffect(() => {
    setEmployeeOffset(0);
  }, [employeeSearch, employeeRoleFilter, employeeDepartmentFilter, employeeVerificationFilter, employeeStatusFilter, employeeSort, employeeSortDirection]);

  const { data: resourcesData } = useQuery<{ resources: Resource[]; bookings: Booking[] }>({
    queryKey: ["manageResources"],
    queryFn: () => apiGet("/admin/resources"),
  });

  const { data: resourceEvents = [] } = useQuery<AdminEvent[]>({
    queryKey: ["resourceEvents"],
    queryFn: () => apiGet("/tasks/events/all"),
    enabled: activeTab === "resources",
  });

  const { data: maintenanceTasks = [] } = useQuery<Array<{ id: number; title: string }>>({
    queryKey: ["resourceMaintenanceTasks"],
    queryFn: () => apiGet("/tasks"),
    enabled: isSuperAdmin && activeTab === "resources",
  });

  const { data: auditSummary, isLoading: summaryLoading, isError: summaryFailed, error: summaryError } = useQuery<AuditSummary>({
    queryKey: ["auditLogSummary"],
    queryFn: () => apiGet("/admin/logs/summary"),
    enabled: isSuperAdmin && activeTab === "logs",
  });

  const { data: auditOptions } = useQuery<AuditOptions>({
    queryKey: ["auditLogOptions"],
    queryFn: () => apiGet("/admin/logs/options"),
    enabled: isSuperAdmin && activeTab === "logs",
  });

  const { data: systemLogsPage, isLoading: logsLoading, isError: logsFailed, error: logsError } = useQuery<SystemLogsPage>({
    queryKey: ["manageLogs", logFilter, logActorFilter, logEntityFilter, logActionFilter, logOutcomeFilter, logFrom, logTo, logOffset],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "25", offset: String(logOffset) });
      if (logFilter.trim()) params.set("search", logFilter.trim());
      if (logActorFilter) params.set("actor_id", logActorFilter);
      if (logEntityFilter) params.set("entity_type", logEntityFilter);
      if (logActionFilter) params.set("action", logActionFilter);
      if (logOutcomeFilter) params.set("outcome", logOutcomeFilter);
      if (logFrom) params.set("from", logFrom);
      if (logTo) params.set("to", logTo);
      return apiGet(`/admin/logs?${params.toString()}`);
    },
    enabled: isSuperAdmin && activeTab === "logs" && auditViewerOpen,
  });
  const systemLogs = systemLogsPage?.rows ?? [];

  useEffect(() => {
    setLogOffset(0);
  }, [logFilter, logActorFilter, logEntityFilter, logActionFilter, logOutcomeFilter, logFrom, logTo]);

  const { data: escalationSettings } = useQuery<EscalationSettings>({
    queryKey: ["escalationSettings"],
    queryFn: () => apiGet("/admin/escalation-settings"),
    enabled: activeTab === "settings",
  });

  useEffect(() => {
    if (escalationSettings) {
      setStage2Hours(String(escalationSettings.stage_2_hours));
      setStage3Hours(String(escalationSettings.stage_3_hours));
    }
  }, [escalationSettings]);

  const handleSaveEscalation = async () => {
    try {
      await apiPut("/admin/escalation-settings", { stage_2_hours: Number(stage2Hours), stage_3_hours: Number(stage3Hours) });
      queryClient.invalidateQueries({ queryKey: ["escalationSettings"] });
      toast.success("Escalation intervals updated!");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update escalation intervals");
    }
  };

  const allResources = resourcesData?.resources || [];
  const allBookings = resourcesData?.bookings || [];

  // Create Department
  const handleCreateDept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deptName.trim()) return;
    setSubmitting(true);
    try {
      const payload = { name: deptName, description: deptDesc, department_code: deptCode, department_type: deptType, contact_email: deptEmail, hod_user_id: deptHodId || null };
      if (editingDepartmentId) {
        await apiPut(`/admin/departments/${editingDepartmentId}`, payload);
      } else {
        await apiPost<Department>("/admin/departments", payload);
      }
      setDeptName("");
      setDeptDesc("");
      setDeptCode("");
      setDeptType("academic");
      setDeptEmail("");
      setDeptHodId("");
      setEditingDepartmentId(null);
      queryClient.invalidateQueries({ queryKey: ["manageDepartments"] });
      toast.success(editingDepartmentId ? "Department updated" : "Department created");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save department");
    } finally {
      setSubmitting(false);
    }
  };

  // Create User
  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empName.trim() || !empEmail.trim()) return;
    setSubmitting(true);
    try {
      const created = await apiPost<{ setupEmailSent: boolean; setupUrl?: string }>("/admin/employees", {
        name: empName,
        email: empEmail,
        college_role: empRole,
        department_id: empDeptId ? parseInt(empDeptId) : undefined,
        employee_id: empId || undefined,
        designation: empDesignation || undefined,
        phone_number: empPhone || undefined,
        date_of_joining: empJoiningDate || undefined,
      });
      setEmpName("");
      setEmpEmail("");
      setEmpRole("teacher");
      setEmpDeptId("");
      setEmpId("");
      setEmpDesignation("");
      setEmpPhone("");
      setEmpJoiningDate("");
      setSetupLink(created.setupUrl || "");
      queryClient.invalidateQueries({ queryKey: ["manageEmployees"] });
      queryClient.invalidateQueries({ queryKey: ["employeeDirectory"] });
      toast.success(created.setupEmailSent ? "Account created and setup email sent." : "Account created. Copy the password setup link to the new user.");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to register user");
    } finally {
      setSubmitting(false);
    }
  };

  const resendVerification = async (id: number) => {
    try {
      const result = await apiPost<{ message: string; setupEmailSent?: boolean; setupUrl?: string }>(`/admin/employees/${id}/resend-verification`, {});
      setSetupLink(result.setupUrl || "");
      toast.success(result.setupUrl ? "Copy and share the new setup link." : result.message);
    }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Failed to resend verification"); }
  };

  const handleAccountStatus = async (employee: Employee) => {
    const isActive = !employee.is_active;
    if (!window.confirm(`${isActive ? "Reactivate" : "Deactivate"} ${employee.name}'s account? ${isActive ? "They will be able to sign in again." : "They will immediately lose access without deleting their data."}`)) return;
    setDeletingUserId(employee.id);
    try {
      await apiPut(`/admin/employees/${employee.id}/status`, { is_active: isActive });
      await queryClient.invalidateQueries({ queryKey: ["manageEmployees"] });
      await queryClient.invalidateQueries({ queryKey: ["employeeDirectory"] });
      toast.success(`${employee.name}'s account was ${isActive ? "reactivated" : "deactivated"}.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update account status");
    } finally {
      setDeletingUserId(null);
    }
  };

  const openEmployeeEditor = (employee: Employee) => {
    setEditingEmployee(employee);
    setEmployeeEditForm({
      name: employee.name,
      email: employee.email,
      college_role: employee.college_role || (employee.role === "dept_head" ? "hod" : "staff"),
      department_id: employee.department_id ? String(employee.department_id) : "",
      employee_id: employee.employee_id || "",
      designation: employee.designation || "",
      phone_number: employee.phone_number || "",
      date_of_joining: employee.date_of_joining ? String(employee.date_of_joining).slice(0, 10) : "",
    });
  };

  const saveEmployeeEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingEmployee) return;
    setSubmitting(true);
    try {
      await apiPut(`/admin/employees/${editingEmployee.id}`, {
        ...employeeEditForm,
        department_id: employeeEditForm.department_id ? Number(employeeEditForm.department_id) : null,
        employee_id: employeeEditForm.employee_id || null,
        designation: employeeEditForm.designation || null,
        phone_number: employeeEditForm.phone_number || null,
        date_of_joining: employeeEditForm.date_of_joining || null,
      });
      setEditingEmployee(null);
      await queryClient.invalidateQueries({ queryKey: ["manageEmployees"] });
      await queryClient.invalidateQueries({ queryKey: ["employeeDirectory"] });
      toast.success("Staff profile updated");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update staff profile");
    } finally {
      setSubmitting(false);
    }
  };

  const editDepartment = (department: Department) => {
    setEditingDepartmentId(department.id);
    setDeptName(department.name);
    setDeptDesc(department.description || "");
    setDeptCode(department.department_code || "");
    setDeptType(department.department_type || "administrative");
    setDeptEmail(department.contact_email || "");
    setDeptHodId(department.hod_user_id ? String(department.hod_user_id) : "");
  };

  const openDepartmentDetails = async (departmentId: number) => {
    try {
      setSelectedDepartment(await apiGet<DepartmentDetails>(`/admin/departments/${departmentId}`));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Unable to load department details");
    }
  };

  const toggleDepartmentStatus = async (department: Department) => {
    const isActive = !department.is_active;
    if (!window.confirm(`${isActive ? "Activate" : "Deactivate"} ${department.name}? ${!isActive ? "Active staff, upcoming events, and open tasks must first be moved or resolved." : ""}`)) return;
    try {
      await apiPut(`/admin/departments/${department.id}`, { is_active: isActive });
      await queryClient.invalidateQueries({ queryKey: ["manageDepartments"] });
      toast.success(`Department ${isActive ? "activated" : "deactivated"}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Unable to update department status");
    }
  };

  // Create Resource
  const handleCreateResource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resName.trim()) return;
    setSubmitting(true);
    try {
      const payload = {
        name: resName,
        type: resType,
        resource_code: resCode || null,
        department_id: resDepartmentId ? Number(resDepartmentId) : null,
        building_location: resLocation || null,
        capacity: resCapacity ? Number(resCapacity) : null,
        quantity: resQuantity ? Number(resQuantity) : null,
        condition_status: resCondition,
        status: resStatus,
        description: resDescription,
        maintenance_task_id: resMaintenanceTaskId ? Number(resMaintenanceTaskId) : null,
      };
      if (editingResourceId) await apiPut(`/admin/resources/${editingResourceId}`, payload);
      else await apiPost("/admin/resources", payload);
      resetResourceForm();
      queryClient.invalidateQueries({ queryKey: ["manageResources"] });
      toast.success(editingResourceId ? "Resource updated" : "Resource added");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save resource");
    } finally {
      setSubmitting(false);
    }
  };

  const resetResourceForm = () => {
    setEditingResourceId(null);
    setResName(""); setResType("Classroom"); setResCode(""); setResDepartmentId("");
    setResLocation(""); setResCapacity(""); setResQuantity(""); setResCondition("Good"); setResStatus("Available");
    setResDescription(""); setResMaintenanceTaskId("");
  };

  const editResource = (resource: Resource) => {
    setEditingResourceId(resource.id); setResName(resource.name); setResType(resource.type);
    setResCode(resource.resource_code || ""); setResDepartmentId(resource.department_id ? String(resource.department_id) : "");
    setResLocation(resource.building_location || ""); setResCapacity(resource.capacity == null ? "" : String(resource.capacity));
    setResQuantity(resource.quantity == null ? "" : String(resource.quantity)); setResCondition(resource.condition_status || "Good");
    setResStatus(resource.status || "Available");
    setResDescription(resource.description || ""); setResMaintenanceTaskId(resource.maintenance_task_id ? String(resource.maintenance_task_id) : "");
  };

  const submitBookingRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!bookingResourceId || !bookingEventId || !bookingStart || !bookingEnd || new Date(bookingStart) >= new Date(bookingEnd)) {
      toast.error("Choose a resource, event, and valid start/end times");
      return;
    }
    try {
      const result = await apiPost<{ status: string }>("/admin/resources/book", {
        resource_id: Number(bookingResourceId), event_id: Number(bookingEventId),
        start_time: new Date(bookingStart).toISOString(), end_time: new Date(bookingEnd).toISOString(),
      });
      setBookingResourceId(""); setBookingEventId(""); setBookingStart(""); setBookingEnd("");
      await queryClient.invalidateQueries({ queryKey: ["manageResources"] });
      toast.success(result.status === "Approved" ? "Reservation approved" : "Reservation request submitted for approval");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Unable to request reservation");
    }
  };

  const updateBookingStatus = async (booking: Booking, status: "Approved" | "Rejected") => {
    try {
      await apiPut(`/admin/resources/bookings/${booking.id}`, { status });
      await queryClient.invalidateQueries({ queryKey: ["manageResources"] });
      toast.success(`Booking ${status.toLowerCase()}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Unable to update booking");
    }
  };

  const cancelBooking = async (booking: Booking) => {
    if (!window.confirm("Cancel this resource reservation?")) return;
    try {
      await apiPut(`/admin/resources/bookings/${booking.id}/cancel`, {});
      await queryClient.invalidateQueries({ queryKey: ["manageResources"] });
      toast.success("Reservation cancelled");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Unable to cancel reservation");
    }
  };

  const handleExportLogs = async () => {
    if (exportingLogs) return;
    if (exportFrom && exportTo && exportFrom > exportTo) {
      toast.error("Start date must be on or before end date");
      return;
    }
    setExportingLogs(true);
    try {
      const params = new URLSearchParams({ format: exportFormat, scope: exportScope });
      if (exportFrom) params.set("from", exportFrom);
      if (exportTo) params.set("to", exportTo);
      if (exportScope === "filtered") {
        if (logFilter.trim()) params.set("search", logFilter.trim());
        if (exportActor) params.set("actor_id", exportActor);
        if (exportAction) params.set("action", exportAction);
        if (exportEntity) params.set("entity_type", exportEntity);
        if (logOutcomeFilter) params.set("outcome", logOutcomeFilter);
      }
      const response = await apiFetch(`/admin/logs/export?${params.toString()}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Export request failed" }));
        throw new Error(body.error || "Export request failed");
      }
      const file = await response.blob();
      if (file.size === 0) throw new Error("The export file was empty");
      const disposition = response.headers.get("Content-Disposition") || "";
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `TaskPilot_Audit_Logs_${new Date().toISOString().slice(0, 10)}.${exportFormat}`;
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setExportDialogOpen(false);
      toast.success(`${exportFormat.toUpperCase()} audit export downloaded`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Unable to export audit records");
    } finally {
      setExportingLogs(false);
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
                <div className="flex flex-col gap-2">
                  <h2 className="font-bold text-sm text-foreground uppercase tracking-wider">System Security &amp; Audit Trail</h2>
                  <p className="text-xs text-muted-foreground">Review administrative activity, export audit records, and inspect historical logs.</p>
                </div>
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                  {[
                    { label: "Total audit records", value: auditSummary?.total },
                    { label: "Today's activity", value: auditSummary?.today },
                    { label: "Successful operations", value: auditSummary?.successful },
                    { label: "Failed operations recorded", value: auditSummary?.failed },
                  ].map((metric) => (
                    <div key={metric.label} className="rounded-lg border border-border bg-background p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{metric.label}</p>
                      <p className="mt-2 text-xl font-bold text-foreground">{summaryLoading ? <Loader2 size={16} className="animate-spin" /> : metric.value === undefined ? "—" : metric.value.toLocaleString()}</p>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row">
                  <button
                    onClick={() => {
                      setExportFrom(logFrom);
                      setExportTo(logTo);
                      setExportActor(logActorFilter);
                      setExportAction(logActionFilter);
                      setExportEntity(logEntityFilter);
                      setExportDialogOpen(true);
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-lg btn-gradient px-4 py-3 text-xs font-semibold text-primary-foreground"
                  >
                    <FileDown size={16} /> Export Log File
                  </button>
                  <button
                    onClick={() => setAuditViewerOpen(true)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-3 text-xs font-semibold text-foreground hover:bg-secondary"
                  >
                    <FileText size={16} /> View Log File
                  </button>
                </div>
                {summaryFailed && <p role="alert" className="text-xs text-destructive">{summaryError instanceof Error ? summaryError.message : "Unable to load audit summary."}</p>}
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
                  <h3 className="font-bold text-xs uppercase tracking-wider text-foreground">{editingDepartmentId ? "Edit Department" : "Add College Unit"}</h3>
                  <form onSubmit={handleCreateDept} className="space-y-3 bg-secondary/10 p-4 border border-border rounded-lg">
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-muted-foreground mb-1">Department or Unit Name</label>
                      <input
                        value={deptName}
                        onChange={(e) => setDeptName(e.target.value)}
                        placeholder="e.g., Information Technology"
                        required
                        className="w-full text-xs px-3.5 py-2.5 rounded-lg input-focus text-foreground focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[10px] font-bold uppercase text-muted-foreground">Code
                        <input value={deptCode} onChange={(e) => setDeptCode(e.target.value)} maxLength={30} placeholder="IT" className="mt-1 w-full rounded-lg px-3 py-2.5 text-xs input-focus" />
                      </label>
                      <label className="text-[10px] font-bold uppercase text-muted-foreground">Unit Type
                        <select value={deptType} onChange={(e) => setDeptType(e.target.value as "academic" | "administrative" | "support")} className="mt-1 w-full rounded-lg bg-background px-2 py-2.5 text-xs input-focus">
                          <option value="academic">Academic</option><option value="administrative">Administrative</option><option value="support">Support</option>
                        </select>
                      </label>
                    </div>
                    <label className="block text-[10px] font-bold uppercase text-muted-foreground">Contact Email
                      <input type="email" value={deptEmail} onChange={(e) => setDeptEmail(e.target.value)} placeholder="office@college.edu" className="mt-1 w-full rounded-lg px-3 py-2.5 text-xs input-focus" />
                    </label>
                    <label className="block text-[10px] font-bold uppercase text-muted-foreground">HOD / Responsible Coordinator
                      <select value={deptHodId} onChange={(e) => setDeptHodId(e.target.value)} className="mt-1 w-full rounded-lg bg-background px-2 py-2.5 text-xs input-focus">
                        <option value="">Not assigned</option>
                        {employeeOptions.filter((employee) => employee.is_active && employee.role !== "super_admin").map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.college_role || employee.role}</option>)}
                      </select>
                    </label>
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
                      {submitting && <Loader2 size={12} className="animate-spin" />} {editingDepartmentId ? "Save Department" : "Create Department"}
                    </motion.button>
                    {editingDepartmentId && <button type="button" onClick={() => { setEditingDepartmentId(null); setDeptName(""); setDeptDesc(""); setDeptCode(""); setDeptEmail(""); setDeptHodId(""); }} className="w-full text-xs text-muted-foreground hover:text-foreground">Cancel editing</button>}
                  </form>
                </div>

                {/* List */}
                <div className="md:col-span-2 space-y-4">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-foreground">Academic Departments & Administrative Units</h3>
                  <div className="grid sm:grid-cols-2 gap-4">
                    {departments.length === 0 ? (
                      <p className="text-xs text-muted-foreground p-4">No departments found.</p>
                    ) : (
                      departments.map((d) => (
                        <AnimatedCard key={d.id} className="p-4 bg-secondary/20 border border-border/50 rounded-lg">
                          <div className="flex items-start justify-between gap-2">
                            <div><h4 className="font-semibold text-xs text-foreground">{d.name}</h4><p className="mt-1 text-[10px] capitalize text-muted-foreground">{d.department_type} {d.department_code ? `· ${d.department_code}` : ""} · {d.is_active ? "Active" : "Inactive"}</p></div>
                            <div className="flex gap-1">
                              <button title="View department details" onClick={() => void openDepartmentDetails(d.id)} className="rounded p-1.5 text-muted-foreground hover:bg-secondary"><Eye size={14} /></button>
                              {isSuperAdmin && <button title="Edit department" onClick={() => editDepartment(d)} className="rounded p-1.5 text-muted-foreground hover:bg-secondary"><Pencil size={14} /></button>}
                            </div>
                          </div>
                          <p className="text-[11px] text-muted-foreground leading-relaxed mt-1.5 font-light">{d.description || "No description provided."}</p>
                          <div className="mt-3 grid grid-cols-2 gap-y-1 text-[10px] text-muted-foreground">
                            <span>HOD: <strong className="font-medium text-foreground">{d.hod_name || "Unassigned"}</strong></span><span>Staff: <strong className="font-medium text-foreground">{d.active_staff_count ?? 0}</strong></span>
                            <span>Upcoming events: {d.upcoming_event_count ?? 0}</span><span>Open tasks: {d.pending_task_count ?? 0}</span>
                            <span>Overdue: {d.overdue_task_count ?? 0}</span><span>Progress: {d.workflow_progress ?? 0}%</span>
                          </div>
                          {isSuperAdmin && <button onClick={() => void toggleDepartmentStatus(d)} className={`mt-3 text-[10px] font-semibold uppercase hover:underline ${d.is_active ? "text-warning" : "text-success"}`}>{d.is_active ? "Deactivate unit" : "Activate unit"}</button>}
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
                className={`grid ${isSuperAdmin ? "md:grid-cols-3" : "md:grid-cols-1"} gap-6`}
              >
                {isSuperAdmin && <div className="space-y-4">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-foreground">Register College Staff</h3>
                  <p className="text-xs text-muted-foreground">A one-time password setup link is generated. Delivery status is reported after the email service responds.</p>
                  <p className="rounded-lg border border-border bg-secondary/20 p-3 text-[11px] leading-relaxed text-muted-foreground">College titles are stored separately from TaskPilot access roles. Only HOD maps to the existing department-head permissions; other college titles remain on the standard staff permission set.</p>
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
                        <label className="block text-[10px] font-bold uppercase text-muted-foreground mb-1">Official Email Address</label>
                      <input
                        type="email"
                        value={empEmail}
                        onChange={(e) => setEmpEmail(e.target.value)}
                          placeholder="name@college.edu"
                        required
                        className="w-full text-xs px-3.5 py-2 rounded-lg input-focus text-foreground focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-muted-foreground mb-1">College Role</label>
                        <select
                          value={empRole}
                          onChange={(e) => setEmpRole(e.target.value)}
                          className="w-full text-[11px] px-2 py-2 rounded-lg input-focus text-foreground bg-background focus:outline-none cursor-pointer"
                        >
                          <option value="principal">Principal</option>
                          <option value="hod">HOD</option>
                          <option value="teacher">Teacher / Faculty</option>
                          <option value="office_staff">Office Staff</option>
                          <option value="laboratory_assistant">Laboratory Assistant</option>
                          <option value="support_staff">Support Staff / Peon</option>
                          <option value="staff">Other College Staff</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-muted-foreground mb-1">Department</label>
                        <select
                          value={empDeptId}
                          onChange={(e) => setEmpDeptId(e.target.value)}
                          className="w-full text-[11px] px-2 py-2 rounded-lg input-focus text-foreground bg-background focus:outline-none cursor-pointer"
                        >
                          <option value="">Choose department</option>
                          {departments.filter((department) => department.is_active).map((d) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[10px] font-bold uppercase text-muted-foreground">Employee ID
                        <input value={empId} onChange={(e) => setEmpId(e.target.value)} maxLength={40} className="mt-1 w-full rounded-lg px-3 py-2.5 text-xs input-focus" />
                      </label>
                      <label className="text-[10px] font-bold uppercase text-muted-foreground">Designation
                        <input value={empDesignation} onChange={(e) => setEmpDesignation(e.target.value)} maxLength={120} placeholder="Assistant Professor" className="mt-1 w-full rounded-lg px-3 py-2.5 text-xs input-focus" />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[10px] font-bold uppercase text-muted-foreground">Phone (optional)
                        <input type="tel" value={empPhone} onChange={(e) => setEmpPhone(e.target.value)} maxLength={40} className="mt-1 w-full rounded-lg px-3 py-2.5 text-xs input-focus" />
                      </label>
                      <label className="text-[10px] font-bold uppercase text-muted-foreground">Date of Joining
                        <input type="date" value={empJoiningDate} onChange={(e) => setEmpJoiningDate(e.target.value)} className="mt-1 w-full rounded-lg px-3 py-2.5 text-xs input-focus" />
                      </label>
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
                  {setupLink && (
                    <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
                      <p className="text-xs font-semibold text-foreground">Email delivery is not configured. Share this one-time setup link with the new user:</p>
                      <a href={setupLink} className="block break-all text-xs text-accent underline" target="_blank" rel="noreferrer">{setupLink}</a>
                      <button
                        type="button"
                        onClick={() => { void navigator.clipboard.writeText(setupLink).then(() => toast.success("Setup link copied."), () => toast.error("Unable to copy setup link.")); }}
                        className="rounded border border-input px-3 py-1.5 text-xs text-foreground hover:bg-secondary"
                      >
                        Copy setup link
                      </button>
                    </div>
                  )}
                </div>}

                <div className={isSuperAdmin ? "md:col-span-2 space-y-4" : "space-y-4"}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><h3 className="font-bold text-xs uppercase tracking-wider text-foreground">College Staff Directory</h3><p className="mt-1 text-[10px] text-muted-foreground">{employeeDirectory?.total ?? 0} matching profiles</p></div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                    <label className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input aria-label="Search staff" value={employeeSearch} onChange={(e) => setEmployeeSearch(e.target.value)} placeholder="Search name, email, ID" className="w-full rounded-lg bg-secondary py-2.5 pl-9 pr-3 text-xs input-focus" /></label>
                    <select aria-label="Filter by college role" value={employeeRoleFilter} onChange={(e) => setEmployeeRoleFilter(e.target.value)} className="rounded-lg bg-secondary px-3 py-2.5 text-xs input-focus"><option value="">All college roles</option><option value="principal">Principal</option><option value="hod">HOD</option><option value="teacher">Teacher / Faculty</option><option value="office_staff">Office Staff</option><option value="laboratory_assistant">Laboratory Assistant</option><option value="support_staff">Support Staff / Peon</option><option value="staff">Other College Staff</option></select>
                    <select aria-label="Filter by department" value={employeeDepartmentFilter} onChange={(e) => setEmployeeDepartmentFilter(e.target.value)} className="rounded-lg bg-secondary px-3 py-2.5 text-xs input-focus"><option value="">All departments</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select>
                    {isSuperAdmin && <select aria-label="Filter by email verification" value={employeeVerificationFilter} onChange={(e) => setEmployeeVerificationFilter(e.target.value)} className="rounded-lg bg-secondary px-3 py-2.5 text-xs input-focus"><option value="">All email states</option><option value="true">Verified</option><option value="false">Unverified</option></select>}
                    {isSuperAdmin && <select aria-label="Filter by account status" value={employeeStatusFilter} onChange={(e) => setEmployeeStatusFilter(e.target.value)} className="rounded-lg bg-secondary px-3 py-2.5 text-xs input-focus"><option value="">All account states</option><option value="true">Active</option><option value="false">Inactive</option></select>}
                    <div className="flex gap-2"><select aria-label="Sort staff" value={employeeSort} onChange={(e) => setEmployeeSort(e.target.value)} className="min-w-0 flex-1 rounded-lg bg-secondary px-3 py-2.5 text-xs input-focus"><option value="name">Sort: Name</option><option value="employee_id">Sort: Employee ID</option><option value="role">Sort: Role</option><option value="department">Sort: Department</option>{isSuperAdmin && <option value="email">Sort: Email</option>}</select><button type="button" onClick={() => setEmployeeSortDirection((direction) => direction === "asc" ? "desc" : "asc")} className="rounded-lg border border-border px-3 text-xs text-foreground hover:bg-secondary" aria-label={`Sort ${employeeSortDirection === "asc" ? "descending" : "ascending"}`}>{employeeSortDirection === "asc" ? "A-Z" : "Z-A"}</button></div>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-border bg-secondary/40 text-left text-muted-foreground">
                        <th className="p-3 font-bold uppercase">Employee ID</th><th className="p-3 font-bold uppercase">Staff Member</th>
                        {isSuperAdmin && <th className="p-3 font-bold uppercase">Official Email</th>}
                        <th className="p-3 font-bold uppercase">College Role</th><th className="p-3 font-bold uppercase">Department</th><th className="p-3 font-bold uppercase">Designation</th>
                        {isSuperAdmin && <><th className="p-3 font-bold uppercase">Email</th><th className="p-3 font-bold uppercase">Account</th><th className="p-3 font-bold uppercase">Actions</th></>}
                      </tr></thead>
                      <tbody className="divide-y divide-border text-muted-foreground">
                        {employeeDirectoryLoading ? <tr><td colSpan={isSuperAdmin ? 9 : 6} className="p-8 text-center"><Loader2 size={16} className="mx-auto animate-spin" /></td></tr> : employeeDirectoryFailed ? <tr><td role="alert" colSpan={isSuperAdmin ? 9 : 6} className="p-8 text-center text-destructive">Unable to load the staff directory.</td></tr> : employees.length === 0 ? <tr><td colSpan={isSuperAdmin ? 9 : 6} className="p-8 text-center">No staff profiles match these filters.</td></tr> : employees.map((emp) => (
                          <tr key={emp.id} className="hover:bg-secondary/10">
                            <td className="p-3 font-mono">{emp.employee_id || "—"}</td><td className="p-3 font-medium text-foreground">{emp.name}</td>
                            {isSuperAdmin && <td className="p-3">{emp.email}</td>}
                            <td className="p-3 capitalize">{(emp.college_role || emp.role || "staff").replace(/_/g, " ")}</td><td className="p-3 font-medium text-foreground">{emp.department || "—"}</td><td className="p-3">{emp.designation || "—"}</td>
                            {isSuperAdmin && <>
                              <td className="p-3"><button disabled={emp.email_verified || (emp.password_setup_required && !isSuperAdmin)} onClick={() => void resendVerification(emp.id)} className={`text-[10px] font-semibold uppercase ${emp.email_verified ? "text-success" : "text-warning hover:underline disabled:no-underline disabled:opacity-70"}`}>{emp.email_verified ? "Verified" : emp.password_setup_required ? "Setup pending" : "Unverified"}</button></td>
                              <td className={`p-3 text-[10px] font-semibold uppercase ${emp.is_active ? "text-success" : "text-destructive"}`}>{emp.is_active ? "Active" : "Inactive"}</td>
                              <td className="p-3"><div className="flex items-center gap-2">
                                {emp.role === "super_admin" ? <span className="text-[10px] text-muted-foreground">Protected</span> : <>
                                  <button title="Edit staff profile" onClick={() => openEmployeeEditor(emp)} className="rounded p-1.5 text-muted-foreground hover:bg-secondary"><Pencil size={14} /></button>
                                  <button type="button" disabled={deletingUserId === emp.id} onClick={() => void handleAccountStatus(emp)} className={`text-[10px] font-semibold uppercase hover:underline disabled:opacity-60 ${emp.is_active ? "text-warning" : "text-success"}`}>{deletingUserId === emp.id ? "Saving..." : emp.is_active ? "Deactivate" : "Activate"}</button>
                                </>}
                              </div></td>
                            </>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Showing {employees.length ? employeeOffset + 1 : 0}-{employeeOffset + employees.length} of {employeeDirectory?.total ?? 0}</span>
                    <div className="flex gap-2"><button disabled={employeeOffset === 0} onClick={() => setEmployeeOffset(Math.max(0, employeeOffset - 25))} className="rounded border border-border px-3 py-1.5 disabled:opacity-50">Previous</button><button disabled={employeeOffset + employees.length >= (employeeDirectory?.total ?? 0)} onClick={() => setEmployeeOffset(employeeOffset + 25)} className="rounded border border-border px-3 py-1.5 disabled:opacity-50">Next</button></div>
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
                className="space-y-6"
              >
                {isSuperAdmin && <form onSubmit={handleCreateResource} className="space-y-4 rounded-lg border border-border bg-secondary/10 p-4">
                  <div className="flex items-center justify-between"><div><h3 className="font-bold text-xs uppercase tracking-wider text-foreground">{editingResourceId ? "Edit Infrastructure Asset" : "Add Infrastructure Asset"}</h3><p className="mt-1 text-[10px] text-muted-foreground">Capacity and quantity are optional where they do not apply.</p></div>{editingResourceId && <button type="button" onClick={resetResourceForm} className="text-xs text-muted-foreground hover:text-foreground">Cancel edit</button>}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <label className="text-[10px] font-bold uppercase text-muted-foreground">Resource Name<input required maxLength={100} value={resName} onChange={(e) => setResName(e.target.value)} placeholder="Main Auditorium" className="mt-1 w-full rounded-lg px-3 py-2.5 text-xs input-focus" /></label>
                    <label className="text-[10px] font-bold uppercase text-muted-foreground">Category<input required maxLength={50} value={resType} onChange={(e) => setResType(e.target.value)} placeholder="Classroom, lab, projector..." className="mt-1 w-full rounded-lg px-3 py-2.5 text-xs input-focus" /></label>
                    <label className="text-[10px] font-bold uppercase text-muted-foreground">Resource Code / Asset ID<input maxLength={40} value={resCode} onChange={(e) => setResCode(e.target.value)} className="mt-1 w-full rounded-lg px-3 py-2.5 text-xs input-focus" /></label>
                    <label className="text-[10px] font-bold uppercase text-muted-foreground">Owning Unit<select value={resDepartmentId} onChange={(e) => setResDepartmentId(e.target.value)} className="mt-1 w-full rounded-lg bg-background px-2 py-2.5 text-xs input-focus"><option value="">Not assigned</option>{departments.filter((department) => department.is_active).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
                    <label className="text-[10px] font-bold uppercase text-muted-foreground">Building / Location<input maxLength={160} value={resLocation} onChange={(e) => setResLocation(e.target.value)} placeholder="Block A, Room 204" className="mt-1 w-full rounded-lg px-3 py-2.5 text-xs input-focus" /></label>
                    <label className="text-[10px] font-bold uppercase text-muted-foreground">Capacity<input type="number" min="0" value={resCapacity} onChange={(e) => setResCapacity(e.target.value)} className="mt-1 w-full rounded-lg px-3 py-2.5 text-xs input-focus" /></label>
                    <label className="text-[10px] font-bold uppercase text-muted-foreground">Quantity<input type="number" min="0" value={resQuantity} onChange={(e) => setResQuantity(e.target.value)} className="mt-1 w-full rounded-lg px-3 py-2.5 text-xs input-focus" /></label>
                    <label className="text-[10px] font-bold uppercase text-muted-foreground">Condition<select value={resCondition} onChange={(e) => setResCondition(e.target.value)} className="mt-1 w-full rounded-lg bg-background px-2 py-2.5 text-xs input-focus"><option>Good</option><option>Fair</option><option>Poor</option><option>Under Maintenance</option></select></label>
                    {editingResourceId && <label className="text-[10px] font-bold uppercase text-muted-foreground">Availability<select value={resStatus} onChange={(e) => setResStatus(e.target.value)} className="mt-1 w-full rounded-lg bg-background px-2 py-2.5 text-xs input-focus"><option>Available</option><option>Maintenance</option><option>Unavailable</option></select></label>}
                    <label className="text-[10px] font-bold uppercase text-muted-foreground lg:col-span-2">Linked Maintenance Task<select value={resMaintenanceTaskId} onChange={(e) => setResMaintenanceTaskId(e.target.value)} className="mt-1 w-full rounded-lg bg-background px-2 py-2.5 text-xs input-focus"><option value="">No maintenance task</option>{maintenanceTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
                    <label className="text-[10px] font-bold uppercase text-muted-foreground lg:col-span-2">Description<textarea rows={2} value={resDescription} onChange={(e) => setResDescription(e.target.value)} className="mt-1 w-full resize-y rounded-lg px-3 py-2.5 text-xs input-focus" /></label>
                  </div>
                  <button type="submit" disabled={submitting} className="inline-flex items-center gap-1.5 rounded-lg btn-gradient px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">{submitting && <Loader2 size={13} className="animate-spin" />}{editingResourceId ? "Save Asset" : "Add Asset"}</button>
                </form>}

                <form onSubmit={submitBookingRequest} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 items-end gap-3 rounded-lg border border-border bg-secondary/10 p-4">
                  <div className="sm:col-span-2 lg:col-span-5"><h3 className="font-bold text-xs uppercase tracking-wider text-foreground">Request Event Reservation</h3><p className="mt-1 text-[10px] text-muted-foreground">Requests remain pending until approved by a Super Admin.</p></div>
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">Resource<select required value={bookingResourceId} onChange={(e) => setBookingResourceId(e.target.value)} className="mt-1 w-full rounded-lg bg-background px-2 py-2.5 text-xs input-focus"><option value="">Choose resource</option>{allResources.filter((resource) => resource.is_active && resource.status === "Available" && resource.condition_status !== "Under Maintenance").map((resource) => <option key={resource.id} value={resource.id}>{resource.name} · {resource.type}</option>)}</select></label>
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">Event<select required value={bookingEventId} onChange={(e) => setBookingEventId(e.target.value)} className="mt-1 w-full rounded-lg bg-background px-2 py-2.5 text-xs input-focus"><option value="">Choose event</option>{resourceEvents.filter((event) => !["Cancelled", "Completed"].includes(event.status)).map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select></label>
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">Starts<input required type="datetime-local" value={bookingStart} onChange={(e) => setBookingStart(e.target.value)} className="mt-1 w-full rounded-lg px-2 py-2.5 text-xs input-focus" /></label>
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">Ends<input required type="datetime-local" min={bookingStart || undefined} value={bookingEnd} onChange={(e) => setBookingEnd(e.target.value)} className="mt-1 w-full rounded-lg px-2 py-2.5 text-xs input-focus" /></label>
                  <button type="submit" className="rounded-lg btn-gradient px-3 py-2.5 text-xs font-semibold text-primary-foreground">Request</button>
                </form>

                <section className="space-y-3">
                  <div><h3 className="font-bold text-xs uppercase tracking-wider text-foreground">Resource Inventory</h3><p className="mt-1 text-[10px] text-muted-foreground">Assets remain in history when deactivated.</p></div>
                  <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 text-xs">
                    {allResources.length === 0 ? <p className="col-span-full rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">No resources configured.</p> : allResources.map((resource) => (
                      <article key={resource.id} className="rounded-lg border border-border bg-secondary/20 p-4">
                        <div className="flex items-start justify-between gap-2"><div><h4 className="font-semibold text-foreground">{resource.name}</h4><p className="mt-0.5 text-[10px] uppercase text-muted-foreground">{resource.type}{resource.resource_code ? ` · ${resource.resource_code}` : ""}</p></div><span className={`rounded px-2 py-0.5 text-[9px] font-bold uppercase ${resource.status === "Available" && resource.is_active ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>{resource.is_active ? resource.status : "Inactive"}</span></div>
                        <div className="mt-3 space-y-1 text-[10px] text-muted-foreground"><p>{resource.building_location || "Location not set"}</p><p>Capacity: {resource.capacity ?? "—"} · Quantity: {resource.quantity ?? "—"}</p><p>Condition: {resource.condition_status}{resource.maintenance_task_id ? " · Maintenance task linked" : ""}</p></div>
                        {isSuperAdmin && <div className="mt-3 flex gap-3 border-t border-border pt-2"><button onClick={() => editResource(resource)} className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent hover:underline"><Pencil size={12} /> Edit</button><button onClick={async () => { if (!window.confirm(`${resource.is_active ? "Deactivate" : "Reactivate"} ${resource.name}?`)) return; try { await apiPut(`/admin/resources/${resource.id}`, { is_active: !resource.is_active }); await queryClient.invalidateQueries({ queryKey: ["manageResources"] }); toast.success("Resource status updated"); } catch (err) { toast.error(err instanceof Error ? err.message : "Unable to update resource"); } }} className="text-[10px] font-semibold text-muted-foreground hover:underline">{resource.is_active ? "Deactivate" : "Reactivate"}</button></div>}
                      </article>
                    ))}
                  </div>
                </section>

                <section className="space-y-3">
                  <div><h3 className="font-bold text-xs uppercase tracking-wider text-foreground">Resource Reservations</h3><p className="mt-1 text-[10px] text-muted-foreground">Overlapping pending and confirmed reservations are blocked.</p></div>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-xs text-left"><thead><tr className="border-b border-border bg-secondary/40 text-muted-foreground"><th className="p-3 font-bold uppercase">Resource</th><th className="p-3 font-bold uppercase">Event</th><th className="p-3 font-bold uppercase">Requested By</th><th className="p-3 font-bold uppercase">Time</th><th className="p-3 font-bold uppercase">Status / Action</th></tr></thead>
                      <tbody className="divide-y divide-border text-muted-foreground">{allBookings.length === 0 ? <tr><td colSpan={5} className="p-6 text-center">No reservations found.</td></tr> : allBookings.map((booking) => <tr key={booking.id} className="hover:bg-secondary/10"><td className="p-3 font-semibold text-foreground">{booking.resource_name}</td><td className="p-3">{booking.event_title}</td><td className="p-3">{booking.booked_by_name}</td><td className="p-3">{new Date(booking.start_time).toLocaleString()}<br />to {new Date(booking.end_time).toLocaleString()}</td><td className="p-3"><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-semibold uppercase">{booking.status}</span>{isSuperAdmin && booking.status === "Pending" && <><button onClick={() => void updateBookingStatus(booking, "Approved")} className="text-[10px] font-semibold text-success hover:underline">Approve</button><button onClick={() => void updateBookingStatus(booking, "Rejected")} className="text-[10px] font-semibold text-destructive hover:underline">Reject</button></>}{(isSuperAdmin || booking.booked_by === user?.id) && ["Pending", "Approved", "Active", "Confirmed"].includes(booking.status) && <button onClick={() => void cancelBooking(booking)} className="text-[10px] font-semibold text-warning hover:underline">Cancel</button>}</div></td></tr>)}</tbody>
                    </table>
                  </div>
                </section>
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
                      <h3 className="font-bold text-xs uppercase tracking-wider text-foreground">College Profile</h3>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground font-medium">College Name</label>
                          <input
                            type="text"
                            value={orgName}
                            onChange={(e) => setOrgName(e.target.value)}
                            className="w-full bg-secondary/30 text-foreground border border-border/50 p-2 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground font-medium">Official Email</label>
                          <input
                            type="email"
                            value={systemEmail}
                            onChange={(e) => setSystemEmail(e.target.value)}
                            className="w-full bg-secondary/30 text-foreground border border-border/50 p-2 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground font-medium">Institution Code</label>
                          <input value={institutionCode} onChange={(e) => setInstitutionCode(e.target.value)} maxLength={40} className="w-full bg-secondary/30 text-foreground border border-border/50 p-2 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-accent" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground font-medium">Institution Time Zone</label>
                          <input value={institutionTimezone} onChange={(e) => setInstitutionTimezone(e.target.value)} placeholder="Asia/Kolkata" className="w-full bg-secondary/30 text-foreground border border-border/50 p-2 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-accent" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground font-medium">Academic Year</label>
                          <input value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} maxLength={30} placeholder="2026-27" className="w-full bg-secondary/30 text-foreground border border-border/50 p-2 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-accent" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground font-medium">Current Semester / Term</label>
                          <input value={academicTerm} onChange={(e) => setAcademicTerm(e.target.value)} maxLength={40} placeholder="Semester 1" className="w-full bg-secondary/30 text-foreground border border-border/50 p-2 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-accent" />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <label className="text-xs text-muted-foreground font-medium">College Address</label>
                          <textarea rows={2} value={collegeAddress} onChange={(e) => setCollegeAddress(e.target.value)} maxLength={1000} className="w-full resize-y bg-secondary/30 text-foreground border border-border/50 p-2 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-accent" />
                        </div>
                      </div>
                    </div>

                    <div className="bg-secondary/10 border border-border/50 p-4 rounded-xl space-y-3">
                      <h3 className="font-bold text-xs uppercase tracking-wider text-foreground">Academic Schedule Defaults</h3>
                      <p className="text-[10px] text-muted-foreground">These are institution defaults; departments may maintain different calendars.</p>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <fieldset className="space-y-2"><legend className="text-xs font-medium text-muted-foreground">Working days</legend><div className="flex flex-wrap gap-3">{[{ value: 1, label: "Mon" }, { value: 2, label: "Tue" }, { value: 3, label: "Wed" }, { value: 4, label: "Thu" }, { value: 5, label: "Fri" }, { value: 6, label: "Sat" }, { value: 0, label: "Sun" }].map((day) => <label key={day.value} className="flex items-center gap-1.5 text-xs text-foreground"><input type="checkbox" checked={workingDays.includes(day.value)} onChange={(e) => setWorkingDays((days) => e.target.checked ? [...days, day.value].sort() : days.filter((value) => value !== day.value))} />{day.label}</label>)}</div></fieldset>
                        <div className="grid grid-cols-2 gap-3"><label className="text-xs text-muted-foreground">Work starts<input type="time" value={workingHoursStart} onChange={(e) => setWorkingHoursStart(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-xs" /></label><label className="text-xs text-muted-foreground">Work ends<input type="time" value={workingHoursEnd} onChange={(e) => setWorkingHoursEnd(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-xs" /></label></div>
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
                          <p className="text-xs font-semibold text-foreground">Security Audit Logging</p>
                          <p className="text-[10px] text-muted-foreground">Always enabled to preserve security and administrative accountability.</p>
                        </div>
                        <input type="checkbox" checked disabled aria-label="Security audit logging enabled" className="w-4 h-4" />
                      </div>

                      <div className="flex items-center justify-between p-2 hover:bg-secondary/20 rounded-lg transition-colors">
                        <div>
                          <p className="text-xs font-semibold text-foreground">In-app and supported email notifications</p>
                          <p className="text-[10px] text-muted-foreground">Email delivery is used only when SMTP is configured.</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={enableNotifs}
                          onChange={(e) => setEnableNotifs(e.target.checked)}
                          className="w-4 h-4 text-accent border-border/50 rounded focus:ring-0 cursor-pointer"
                        />
                      </div>
                    </div>

                    <div className="bg-secondary/10 border border-border/50 p-4 rounded-xl space-y-3">
                      <h3 className="font-bold text-xs uppercase tracking-wider text-foreground">Automatic Task Escalation</h3>
                      <p className="text-[10px] text-muted-foreground">Intervals start when an incomplete task crosses its deadline.</p>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="text-xs text-muted-foreground">Stage 2 (hours)<input type="number" min="1" value={stage2Hours} onChange={(e) => setStage2Hours(e.target.value)} className="mt-1 w-full bg-secondary/30 text-foreground border border-border/50 p-2 rounded-lg" /></label>
                        <label className="text-xs text-muted-foreground">Stage 3 (hours)<input type="number" min="2" value={stage3Hours} onChange={(e) => setStage3Hours(e.target.value)} className="mt-1 w-full bg-secondary/30 text-foreground border border-border/50 p-2 rounded-lg" /></label>
                      </div>
                      <button onClick={handleSaveEscalation} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold btn-gradient text-primary-foreground"><Check size={14} /> Save Escalation</button>
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
                    <div className="border border-border bg-secondary/10 p-4 rounded-xl space-y-4">
                      <h3 className="font-bold text-xs uppercase tracking-wider text-foreground flex items-center gap-1.5">
                        <Settings size={14} /> Database Maintenance
                      </h3>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Checks for missing schema objects and optional development sample data. Existing records are preserved; this does not reset the database.
                      </p>

                      <div className="space-y-2">
                        <button
                          onClick={handleResetDb}
                          disabled={resettingDb}
                          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-border text-foreground hover:bg-secondary disabled:opacity-50 transition-colors"
                        >
                          {resettingDb ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <RotateCcw size={12} />
                          )}
                          Check Schema & Optional Demo Data
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <Dialog open={Boolean(editingEmployee)} onOpenChange={(open) => !open && setEditingEmployee(null)}>
          <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
            <DialogHeader><DialogTitle>Edit staff profile</DialogTitle><DialogDescription>Changes affect future access checks; historical activity is retained.</DialogDescription></DialogHeader>
            <form onSubmit={saveEmployeeEdit} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="text-xs font-medium text-foreground">Full name<input required maxLength={100} value={employeeEditForm.name} onChange={(e) => setEmployeeEditForm({ ...employeeEditForm, name: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 input-focus" /></label>
                <label className="text-xs font-medium text-foreground">Official email<input type="email" required value={employeeEditForm.email} onChange={(e) => setEmployeeEditForm({ ...employeeEditForm, email: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 input-focus" /></label>
                <label className="text-xs font-medium text-foreground">College role<select value={employeeEditForm.college_role} onChange={(e) => setEmployeeEditForm({ ...employeeEditForm, college_role: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 input-focus"><option value="principal">Principal</option><option value="hod">HOD</option><option value="teacher">Teacher / Faculty</option><option value="office_staff">Office Staff</option><option value="laboratory_assistant">Laboratory Assistant</option><option value="support_staff">Support Staff / Peon</option><option value="staff">Other College Staff</option></select></label>
                <label className="text-xs font-medium text-foreground">Department<select required={employeeEditForm.college_role === "hod"} value={employeeEditForm.department_id} onChange={(e) => setEmployeeEditForm({ ...employeeEditForm, department_id: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 input-focus"><option value="">No department</option>{departments.filter((department) => department.is_active).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
                <label className="text-xs font-medium text-foreground">Employee ID<input maxLength={40} value={employeeEditForm.employee_id} onChange={(e) => setEmployeeEditForm({ ...employeeEditForm, employee_id: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 input-focus" /></label>
                <label className="text-xs font-medium text-foreground">Designation<input maxLength={120} value={employeeEditForm.designation} onChange={(e) => setEmployeeEditForm({ ...employeeEditForm, designation: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 input-focus" /></label>
                <label className="text-xs font-medium text-foreground">Phone (optional)<input type="tel" maxLength={40} value={employeeEditForm.phone_number} onChange={(e) => setEmployeeEditForm({ ...employeeEditForm, phone_number: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 input-focus" /></label>
                <label className="text-xs font-medium text-foreground">Date of joining<input type="date" value={employeeEditForm.date_of_joining} onChange={(e) => setEmployeeEditForm({ ...employeeEditForm, date_of_joining: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 input-focus" /></label>
              </div>
              {employeeEditForm.college_role === "hod" && <p className="text-[11px] text-muted-foreground">HOD is mapped to the existing department-head permission role and is limited to one assignment per department.</p>}
              <div className="flex justify-end gap-2 border-t border-border pt-3"><button type="button" onClick={() => setEditingEmployee(null)} className="rounded-lg border border-border px-4 py-2 text-xs text-foreground hover:bg-secondary">Cancel</button><button type="submit" disabled={submitting} className="rounded-lg btn-gradient px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{submitting ? "Saving..." : "Save profile"}</button></div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={Boolean(selectedDepartment)} onOpenChange={(open) => !open && setSelectedDepartment(null)}>
          <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
            {selectedDepartment && <>
              <DialogHeader><DialogTitle>{selectedDepartment.name}</DialogTitle><DialogDescription>{selectedDepartment.department_type} unit{selectedDepartment.department_code ? ` · ${selectedDepartment.department_code}` : ""} · HOD: {selectedDepartment.hod_name || "Unassigned"}</DialogDescription></DialogHeader>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {[{ label: "Active staff", value: selectedDepartment.active_staff_count }, { label: "Upcoming events", value: selectedDepartment.upcoming_event_count }, { label: "Open tasks", value: selectedDepartment.pending_task_count }, { label: "Overdue", value: selectedDepartment.overdue_task_count }, { label: "Progress", value: `${selectedDepartment.workflow_progress}%` }].map((metric) => <div key={metric.label} className="rounded-lg bg-secondary/50 p-3"><p className="text-[10px] text-muted-foreground">{metric.label}</p><p className="mt-1 text-lg font-semibold text-foreground">{metric.value}</p></div>)}
              </div>
              <section className="space-y-2"><h3 className="text-xs font-bold uppercase tracking-wider text-foreground">Staff</h3>{selectedDepartment.staff.length ? selectedDepartment.staff.map((staffMember) => <div key={staffMember.id} className="flex justify-between gap-3 border-b border-border py-2 text-xs"><span className="text-foreground">{staffMember.name}{staffMember.designation ? ` · ${staffMember.designation}` : ""}</span><span className="capitalize text-muted-foreground">{staffMember.college_role.replace(/_/g, " ")} · {staffMember.is_active ? "Active" : "Inactive"}</span></div>) : <p className="text-xs text-muted-foreground">No staff assigned.</p>}</section>
              <section className="space-y-2"><h3 className="text-xs font-bold uppercase tracking-wider text-foreground">Upcoming events</h3>{selectedDepartment.events.length ? selectedDepartment.events.map((event) => <div key={event.id} className="flex justify-between gap-3 border-b border-border py-2 text-xs"><span className="text-foreground">{event.title}</span><span className="text-muted-foreground">{new Date(event.start_date).toLocaleString()}</span></div>) : <p className="text-xs text-muted-foreground">No upcoming events.</p>}</section>
              <section className="space-y-2"><h3 className="text-xs font-bold uppercase tracking-wider text-foreground">Open tasks</h3>{selectedDepartment.tasks.length ? selectedDepartment.tasks.map((task) => <div key={task.id} className="flex flex-wrap justify-between gap-2 border-b border-border py-2 text-xs"><span className="text-foreground">{task.title}</span><span className="text-muted-foreground">{task.status} · {task.priority}{task.due_date ? ` · Due ${new Date(task.due_date).toLocaleDateString()}` : ""}{task.is_overdue ? " · Overdue" : ""}</span></div>) : <p className="text-xs text-muted-foreground">No open tasks.</p>}</section>
            </>}
          </DialogContent>
        </Dialog>

        <Dialog open={exportDialogOpen} onOpenChange={(open) => !exportingLogs && setExportDialogOpen(open)}>
          <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Export Log File</DialogTitle>
              <DialogDescription>Generate a real export from the authoritative audit records.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium text-foreground">File format
                  <select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as "csv" | "json")} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-xs input-focus">
                    <option value="csv">CSV (Excel compatible)</option><option value="json">JSON</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-foreground">Records to include
                  <select value={exportScope} onChange={(event) => setExportScope(event.target.value as "filtered" | "all")} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-xs input-focus">
                    <option value="filtered">Selected filters</option><option value="all">All records in date range</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-foreground">Start date
                  <input type="date" value={exportFrom} max={exportTo || undefined} onChange={(event) => setExportFrom(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-xs input-focus" />
                </label>
                <label className="text-xs font-medium text-foreground">End date
                  <input type="date" value={exportTo} min={exportFrom || undefined} onChange={(event) => setExportTo(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-xs input-focus" />
                </label>
              </div>
              <div className={`grid gap-3 sm:grid-cols-3 ${exportScope === "all" ? "opacity-50" : ""}`}>
                <label className="text-xs font-medium text-foreground">Actor
                  <select disabled={exportScope === "all"} value={exportActor} onChange={(event) => setExportActor(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2.5 text-xs input-focus">
                    <option value="">All actors</option>{auditOptions?.actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium text-foreground">Action
                  <select disabled={exportScope === "all"} value={exportAction} onChange={(event) => setExportAction(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2.5 text-xs input-focus">
                    <option value="">All actions</option>{auditOptions?.actions.map((action) => <option key={action} value={action}>{action}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium text-foreground">Entity type
                  <select disabled={exportScope === "all"} value={exportEntity} onChange={(event) => setExportEntity(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2.5 text-xs input-focus">
                    <option value="">All entities</option>{auditOptions?.entity_types.map((entity) => <option key={entity} value={entity}>{entity.replace(/_/g, " ")}</option>)}
                  </select>
                </label>
              </div>
              {exportScope === "filtered" && <p className="text-[11px] text-muted-foreground">The current viewer search and outcome filter are also applied when present.</p>}
              <div className="flex justify-end gap-2 border-t border-border pt-3">
                <button type="button" disabled={exportingLogs} onClick={() => setExportDialogOpen(false)} className="rounded-lg border border-border px-4 py-2 text-xs text-foreground hover:bg-secondary">Cancel</button>
                <button type="button" disabled={exportingLogs} onClick={handleExportLogs} className="inline-flex items-center gap-2 rounded-lg btn-gradient px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">
                  {exportingLogs ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}{exportingLogs ? "Generating..." : "Download export"}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={auditViewerOpen} onOpenChange={setAuditViewerOpen}>
          <DialogContent className="max-h-[94vh] w-[calc(100vw-2rem)] max-w-6xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Audit Log Viewer</DialogTitle>
              <DialogDescription>Search and inspect stored administrative activity. Results are paginated from the server.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <label className="relative xl:col-span-2"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input value={logFilter} onChange={(event) => setLogFilter(event.target.value)} type="search" placeholder="Search actor, action, details" aria-label="Search audit logs" className="w-full rounded-lg bg-secondary py-2.5 pl-9 pr-3 text-xs input-focus" /></label>
                <select aria-label="Filter by actor" value={logActorFilter} onChange={(event) => setLogActorFilter(event.target.value)} className="min-w-0 rounded-lg bg-secondary px-3 py-2.5 text-xs input-focus"><option value="">All actors</option>{auditOptions?.actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select>
                <select aria-label="Filter by action" value={logActionFilter} onChange={(event) => setLogActionFilter(event.target.value)} className="min-w-0 rounded-lg bg-secondary px-3 py-2.5 text-xs input-focus"><option value="">All actions</option>{auditOptions?.actions.map((action) => <option key={action} value={action}>{action}</option>)}</select>
                <select aria-label="Filter by entity" value={logEntityFilter} onChange={(event) => setLogEntityFilter(event.target.value)} className="min-w-0 rounded-lg bg-secondary px-3 py-2.5 text-xs input-focus"><option value="">All entity types</option>{auditOptions?.entity_types.map((type) => <option key={type} value={type}>{type.replace(/_/g, " ")}</option>)}</select>
                  <select aria-label="Filter by outcome" value={logOutcomeFilter} onChange={(event) => setLogOutcomeFilter(event.target.value)} className="min-w-0 rounded-lg bg-secondary px-3 py-2.5 text-xs input-focus"><option value="">All outcomes</option>{auditOptions?.outcomes.map((outcome) => <option key={outcome} value={outcome}>{outcome}</option>)}</select>
                <input aria-label="Audit date from" type="date" value={logFrom} max={logTo || undefined} onChange={(event) => setLogFrom(event.target.value)} className="min-w-0 rounded-lg bg-secondary px-3 py-2.5 text-xs input-focus" />
                <input aria-label="Audit date to" type="date" min={logFrom || undefined} value={logTo} onChange={(event) => setLogTo(event.target.value)} className="min-w-0 rounded-lg bg-secondary px-3 py-2.5 text-xs input-focus" />
              </div>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[1100px] text-xs">
                  <thead><tr className="border-b border-border bg-secondary/40 text-muted-foreground">
                    <th className="p-3 text-left font-bold uppercase">Log ID</th><th className="p-3 text-left font-bold uppercase">User</th><th className="p-3 text-left font-bold uppercase">Role</th><th className="p-3 text-left font-bold uppercase">Action</th><th className="p-3 text-left font-bold uppercase">Entity</th><th className="p-3 text-left font-bold uppercase">Outcome</th><th className="p-3 text-left font-bold uppercase">Audit Details</th><th className="p-3 text-left font-bold uppercase">Timestamp</th><th className="p-3 text-left font-bold uppercase">Record</th>
                  </tr></thead>
                  <tbody className="divide-y divide-border">
                    {logsLoading ? <tr><td colSpan={9} className="p-8 text-center"><Loader2 size={16} className="mx-auto animate-spin" /></td></tr>
                      : logsFailed ? <tr><td role="alert" colSpan={9} className="p-8 text-center text-destructive">{logsError instanceof Error ? logsError.message : "Unable to load audit records."}</td></tr>
                      : systemLogs.length === 0 ? <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">No audit entries match these filters.</td></tr>
                      : systemLogs.map((log) => <tr key={log.id} className="text-muted-foreground hover:bg-secondary/10">
                        <td className="p-3 font-semibold text-foreground">#{log.id}</td><td className="p-3 text-foreground">{log.user_name || "System"}{log.user_email ? ` (${log.user_email})` : ""}</td><td className="p-3 capitalize">{log.user_role?.replace(/_/g, " ") || "Unknown"}</td><td className="p-3 font-semibold text-accent">{log.action}</td><td className="p-3">{log.entity_type ? `${log.entity_type.replace(/_/g, " ")} #${log.entity_id ?? "—"}` : "—"}</td><td className="p-3 capitalize">{log.outcome || "success"}</td><td className="max-w-xs truncate p-3 leading-relaxed">{log.details || "—"}</td><td className="whitespace-nowrap p-3">{new Date(log.created_at).toLocaleString()}</td><td className="p-3"><button aria-label={`View details for log ${log.id}`} onClick={() => setSelectedLog(log)} className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent hover:underline"><Eye size={13} /> Details</button></td>
                      </tr>)}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span>{systemLogsPage?.total ? `Showing ${logOffset + 1}-${Math.min(logOffset + systemLogs.length, systemLogsPage.total)} of ${systemLogsPage.total.toLocaleString()} matching records` : "0 matching records"}</span>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button onClick={() => { setExportFrom(logFrom); setExportTo(logTo); setExportActor(logActorFilter); setExportAction(logActionFilter); setExportEntity(logEntityFilter); setExportScope("filtered"); setExportDialogOpen(true); }} className="inline-flex items-center gap-1 rounded border border-border px-3 py-1.5 text-foreground hover:bg-secondary"><FileDown size={13} /> Export filtered</button>
                  <button aria-label="Previous audit page" disabled={logOffset === 0 || logsLoading} onClick={() => setLogOffset(Math.max(0, logOffset - 25))} className="rounded border border-border p-1.5 disabled:opacity-50"><ChevronLeft size={15} /></button>
                  <span>Page {Math.floor(logOffset / 25) + 1}{systemLogsPage ? ` of ${Math.max(1, Math.ceil(systemLogsPage.total / 25))}` : ""}</span>
                  <button aria-label="Next audit page" disabled={logOffset + systemLogs.length >= (systemLogsPage?.total ?? 0) || logsLoading} onClick={() => setLogOffset(logOffset + 25)} className="rounded border border-border p-1.5 disabled:opacity-50"><ChevronRight size={15} /></button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={Boolean(selectedLog)} onOpenChange={(open) => !open && setSelectedLog(null)}>
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
            {selectedLog && <>
              <DialogHeader><DialogTitle>{selectedLog.action}</DialogTitle><DialogDescription>{selectedLog.user_name || "System"} · {new Date(selectedLog.created_at).toLocaleString()} · {selectedLog.entity_type || "General"}{selectedLog.entity_id ? ` #${selectedLog.entity_id}` : ""}</DialogDescription></DialogHeader>
              <p className="whitespace-pre-wrap text-sm text-foreground">{selectedLog.details}</p>
              {(selectedLog.before_data || selectedLog.after_data) && <div className="grid gap-4 sm:grid-cols-2"><section><h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Before</h3><pre className="max-h-64 overflow-auto rounded-lg bg-secondary p-3 text-[10px] text-foreground">{JSON.stringify(selectedLog.before_data || {}, null, 2)}</pre></section><section><h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">After</h3><pre className="max-h-64 overflow-auto rounded-lg bg-secondary p-3 text-[10px] text-foreground">{JSON.stringify(selectedLog.after_data || {}, null, 2)}</pre></section></div>}
            </>}
          </DialogContent>
        </Dialog>
      </div>
    </PageTransition>
  );
}
