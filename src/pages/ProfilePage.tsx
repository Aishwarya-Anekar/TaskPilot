import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight, Bell, CalendarDays, Camera, Check, CheckCircle2, Clock3,
  Eye, EyeOff, FileText, Loader2, LogOut, Mail, Moon, Pencil, ShieldCheck,
  Sun, Trash2, UserRound, X,
} from "lucide-react";
import { toast } from "sonner";
import { PageTransition } from "@/components/motion/PageTransition";
import { useAuth, User } from "@/contexts/AuthContext";
import { apiDelete, apiGet, apiPut, UPLOADS_BASE } from "@/lib/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/hooks/useTheme";

interface ProfileStats {
  total_tasks: number;
  completed_tasks: number;
  pending_tasks: number;
  upcoming_events: number;
}

interface ProfileForm {
  name: string;
  email: string;
  phone_number: string;
  department: string;
  designation: string;
  employee_id: string;
  bio: string;
}

const emptyProfile: ProfileForm = {
  name: "",
  email: "",
  phone_number: "",
  department: "",
  designation: "",
  employee_id: "",
  bio: "",
};

const preferenceItems = [
  { label: "Email notifications", detail: "Receive notification emails", field: "email_notifications" as const, icon: Mail },
  { label: "Task assignment alerts", detail: "When a task is assigned to you", field: "task_assignment_notifications" as const, icon: FileText },
  { label: "Task deadline reminders", detail: "Upcoming deadlines and overdue tasks", field: "task_deadline_notifications" as const, icon: Clock3 },
  { label: "Meeting & event reminders", detail: "Events scheduled for today or tomorrow", field: "event_reminder_notifications" as const, icon: CalendarDays },
  { label: "Task status updates", detail: "Changes to your assigned tasks", field: "task_status_notifications" as const, icon: CheckCircle2 },
];

function getInitials(name?: string | null) {
  return name?.trim().split(/\s+/).map((part) => part[0]).join("").toUpperCase().slice(0, 2) || "??";
}

function displayRole(role?: string) {
  return role?.replace(/_/g, " ") || "User";
}

function hasUnsupportedControlCharacters(value: string) {
  return value.split("").some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
  });
}

function validateProfileDetails(form: ProfileForm): Partial<Record<keyof ProfileForm, string>> {
  const errors: Partial<Record<keyof ProfileForm, string>> = {};
  const name = form.name.trim();
  const email = form.email.trim();
  const phone = form.phone_number.trim();
  const designation = form.designation.trim();
  const employeeId = form.employee_id.trim();
  const bio = form.bio.trim();

  if (!name) errors.name = "Enter your full name.";
  else if ([...name].length < 2 || [...name].length > 100) errors.name = "Name must be between 2 and 100 characters.";
  else if (!/^[\p{L}\p{M}]+(?:[ '\u2019.-][\p{L}\p{M}]+)*$/u.test(name)) errors.name = "Use letters, spaces, apostrophes, periods, or hyphens only.";

  const [localPart, domain] = email.split("@");
  const emailPattern = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,63}$/i;
  if (!email) errors.email = "Enter your email address.";
  else if (email.length > 254 || !emailPattern.test(email) || !localPart || localPart.length > 64 || localPart.includes("..") || domain.split(".").some((part) => part.length > 63)) {
    errors.email = "Enter a valid email address (for example, name@example.com).";
  }

  if (phone && !/^\+91[789]\d{9}$/.test(phone)) {
    errors.phone_number = "Enter a valid Indian mobile number: +91 followed by 10 digits starting with 7, 8, or 9.";
  }

  if (designation && designation.length > 120) errors.designation = "Designation must be 120 characters or fewer.";
  else if (designation && !/^[\p{L}\p{M}\p{N}](?:[\p{L}\p{M}\p{N} &.,'’()/-]*[\p{L}\p{M}\p{N}])?$/u.test(designation)) {
    errors.designation = "Use letters, numbers, spaces, and common punctuation only.";
  }

  if (employeeId && employeeId.length > 40) errors.employee_id = "Employee ID must be 40 characters or fewer.";
  else if (employeeId && !/^[\p{L}\p{N}][\p{L}\p{N}._/-]*$/u.test(employeeId)) {
    errors.employee_id = "Use letters, numbers, periods, underscores, hyphens, or slashes only.";
  }

  if (bio.length > 500) errors.bio = "About me must be 500 characters or fewer.";
  else if (hasUnsupportedControlCharacters(bio)) errors.bio = "About me contains unsupported control characters.";

  if (form.department.trim().length > 100) errors.department = "Department must be 100 characters or fewer.";
  return errors;
}

export default function ProfilePage() {
  const { user, refreshUser, logout } = useAuth();
  const { isDark, toggle } = useTheme();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<ProfileForm>(emptyProfile);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof ProfileForm, string>>>({});
  const [formError, setFormError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [savingPreference, setSavingPreference] = useState<string | null>(null);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordFieldError, setPasswordFieldError] = useState("");

  const { data: stats, isLoading: loadingStats, isError: statsError, refetch: refetchStats } = useQuery<ProfileStats>({
    queryKey: ["profile-stats", user?.id],
    queryFn: () => apiGet("/auth/me/stats"),
    enabled: Boolean(user),
  });

  useEffect(() => {
    if (!selectedPhoto) {
      setPhotoPreview(null);
      return;
    }
    const preview = URL.createObjectURL(selectedPhoto);
    setPhotoPreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [selectedPhoto]);

  const profile: ProfileForm = {
    name: user?.name || "",
    email: user?.email || "",
    phone_number: user?.phone_number || "",
    department: user?.department || "",
    designation: user?.designation || "",
    employee_id: user?.employee_id || "",
    bio: user?.bio || "",
  };
  const photoUrl = photoPreview || (user?.profile_photo ? `${UPLOADS_BASE}${user.profile_photo}` : undefined);
  const passwordRules = [
    { label: "At least 8 characters", valid: newPassword.length >= 8 },
    { label: "An uppercase and a lowercase letter", valid: /[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword) },
    { label: "A number", valid: /\d/.test(newPassword) },
    { label: "A special character", valid: /[^A-Za-z0-9]/.test(newPassword) },
  ];
  const passwordStrength = passwordRules.filter((rule) => rule.valid).length;

  const openEdit = () => {
    setForm(profile);
    setFormErrors({});
    setFormError("");
    setEditOpen(true);
  };

  const updateForm = (field: keyof ProfileForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => ({ ...current, [field]: undefined }));
    setFormError("");
  };

  const validateProfile = () => {
    const errors = validateProfileDetails(form);
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const saveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validateProfile()) return;
    setSavingProfile(true);
    setFormError("");
    try {
      const payload: Record<string, string> = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone_number: form.phone_number.trim(),
        designation: form.designation.trim(),
        employee_id: form.employee_id.trim(),
        bio: form.bio.trim(),
      };
      if (user?.role === "super_admin") payload.department = form.department.trim();
      const updated = await apiPut<User & { email_verification_required?: boolean }>("/auth/me", payload);
      await refreshUser();
      setEditOpen(false);
      toast.success(updated.email_verification_required
        ? "Profile saved. Check your new email address to verify it."
        : "Profile updated successfully.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save profile changes.";
      setFormError(message);
      toast.error(message);
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePhotoSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const acceptedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!acceptedTypes.includes(file.type)) {
      toast.error("Choose a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Profile photos must be 5 MB or smaller.");
      return;
    }
    setSelectedPhoto(file);
  };

  const savePhoto = async () => {
    if (!selectedPhoto) return;
    setSavingPhoto(true);
    try {
      const body = new FormData();
      body.append("photo", selectedPhoto);
      await apiPut("/auth/me/photo", body);
      setSelectedPhoto(null);
      await refreshUser();
      toast.success("Profile photo updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to upload profile photo.");
    } finally {
      setSavingPhoto(false);
    }
  };

  const removePhoto = async () => {
    setSavingPhoto(true);
    try {
      await apiDelete("/auth/me/photo");
      setSelectedPhoto(null);
      await refreshUser();
      toast.success("Profile photo removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to remove profile photo.");
    } finally {
      setSavingPhoto(false);
    }
  };

  const updatePreference = async (field: string, value: boolean, label: string) => {
    if (savingPreference) return;
    setSavingPreference(field);
    try {
      await apiPut("/auth/me", { [field]: value });
      await refreshUser();
      toast.success(`${label} ${value ? "enabled" : "disabled"}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save notification preference.");
    } finally {
      setSavingPreference(null);
    }
  };

  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError("");
    setPasswordFieldError("");
    if (passwordStrength !== passwordRules.length) {
      setPasswordFieldError("Your password does not meet all requirements.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordFieldError("The new passwords do not match.");
      return;
    }
    setChangingPassword(true);
    try {
      await apiPut("/auth/me", { current_password: currentPassword, new_password: newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password changed successfully.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to change password.";
      setPasswordError(message);
      toast.error(message);
    } finally {
      setChangingPassword(false);
    }
  };

  const statItems = [
    { label: "Tasks assigned", value: stats?.total_tasks, icon: FileText, href: "/track?status=All", tint: "text-primary bg-primary/10" },
    { label: "Tasks completed", value: stats?.completed_tasks, icon: CheckCircle2, href: "/track?status=Completed", tint: "text-success bg-success/10" },
    { label: "Pending tasks", value: stats?.pending_tasks, icon: Clock3, href: "/track?status=Pending", tint: "text-warning bg-warning/10" },
    { label: "Upcoming events", value: stats?.upcoming_events, icon: CalendarDays, href: "/calendar", tint: "text-info bg-info/10" },
  ];

  return (
    <PageTransition>
      <div className="mx-auto max-w-6xl space-y-6 pb-8">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-accent">Account</p>
          <h1 className="text-2xl font-bold text-foreground">Profile & settings</h1>
          <p className="text-sm text-muted-foreground">Manage your personal information, notifications, and account security.</p>
        </div>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7" aria-labelledby="profile-heading">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            <div className="relative mx-auto sm:mx-0">
              <Avatar className="h-24 w-24 border-4 border-background shadow-md sm:h-28 sm:w-28">
                {photoUrl && <AvatarImage src={photoUrl} alt={`${user?.name || "User"} profile photo`} />}
                <AvatarFallback className="btn-gradient text-2xl font-bold text-primary-foreground">{getInitials(user?.name)}</AvatarFallback>
              </Avatar>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                aria-label="Choose a profile photo"
                className="absolute bottom-0 right-0 flex h-9 w-9 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Camera size={16} />
              </button>
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoSelection} className="sr-only" aria-label="Upload profile photo" />
            </div>
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <h2 id="profile-heading" className="break-words text-xl font-bold text-foreground sm:text-2xl">{user?.name || "Your profile"}</h2>
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold capitalize text-primary">{displayRole(user?.role)}</span>
              </div>
              <p className="mt-1 break-all text-sm text-muted-foreground">{user?.email}</p>
              {(user?.designation || user?.department) && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {[user.designation, user.department].filter(Boolean).join(" · ")}
                </p>
              )}
              <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
                <Button type="button" onClick={openEdit} className="gap-2">
                  <Pencil size={15} /> Edit profile
                </Button>
                {selectedPhoto ? (
                  <>
                    <Button type="button" variant="outline" onClick={savePhoto} disabled={savingPhoto} className="gap-2">
                      {savingPhoto ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                      {savingPhoto ? "Saving photo…" : "Save photo"}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setSelectedPhoto(null)} disabled={savingPhoto} aria-label="Discard photo preview">
                      <X size={16} />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button type="button" variant="outline" onClick={() => fileInput.current?.click()} disabled={savingPhoto} className="gap-2">
                      <Camera size={15} /> Change photo
                    </Button>
                    {user?.profile_photo && (
                      <Button type="button" variant="ghost" onClick={removePhoto} disabled={savingPhoto} className="gap-2 text-muted-foreground hover:text-destructive">
                        {savingPhoto ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Remove
                      </Button>
                    )}
                  </>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">JPG, PNG, or WebP · 5 MB maximum</p>
            </div>
          </div>
        </section>

        <section aria-label="Profile statistics" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {statItems.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => navigate(item.href)}
              className="group flex min-w-0 items-center gap-4 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${item.tint}`}><item.icon size={20} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-2xl font-bold text-foreground">
                  {loadingStats ? <span className="inline-block h-7 w-12 animate-pulse rounded bg-muted align-middle" /> : statsError ? "—" : item.value ?? 0}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{item.label}</span>
              </span>
              <ArrowRight size={16} className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </section>
        {statsError && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
            <span>Couldn’t load your statistics. Your profile data is still available.</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void refetchStats()}>Retry</Button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6" aria-labelledby="personal-info-title">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <h2 id="personal-info-title" className="font-semibold text-foreground">Personal information</h2>
                <p className="mt-1 text-xs text-muted-foreground">Your contact and work details.</p>
              </div>
              <UserRound size={19} className="text-muted-foreground" />
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              {[
                ["Full name", user?.name],
                ["Email address", user?.email],
                ["Phone number", user?.phone_number],
                ["Department", user?.department],
                ["Designation", user?.designation],
                ["Employee / staff ID", user?.employee_id],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0 border-b border-border/70 pb-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-words text-sm font-medium text-foreground">{value || <span className="font-normal text-muted-foreground">Not provided</span>}</dd>
                </div>
              ))}
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">About me</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{user?.bio || <span className="text-muted-foreground">Add a short introduction to your profile.</span>}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6" aria-labelledby="notifications-title">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 id="notifications-title" className="font-semibold text-foreground">Notification preferences</h2>
                <p className="mt-1 text-xs text-muted-foreground">Choose which TaskPilot notifications you receive.</p>
              </div>
              <Bell size={19} className="text-muted-foreground" />
            </div>
            <div className="divide-y divide-border">
              {preferenceItems.map((item) => {
                const enabled = user?.[item.field] ?? true;
                const saving = savingPreference === item.field;
                return (
                  <div key={item.field} className="flex min-h-[68px] items-center gap-3 py-3">
                    <item.icon size={17} className="shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{saving ? "Saving preference…" : item.detail}</p>
                    </div>
                    {saving && <Loader2 size={15} className="animate-spin text-muted-foreground" aria-label="Saving" />}
                    <Switch
                      checked={enabled}
                      onCheckedChange={(value) => void updatePreference(item.field, value, item.label)}
                      disabled={Boolean(savingPreference)}
                      aria-label={item.label}
                    />
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">SMS and push alerts are unavailable because these delivery channels are not configured.</p>
          </section>

          <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6" aria-labelledby="security-title">
            <div className="mb-5 flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><ShieldCheck size={20} /></span>
              <div>
                <h2 id="security-title" className="font-semibold text-foreground">Account security</h2>
                <p className="mt-1 text-xs text-muted-foreground">Update your password to keep your account secure.</p>
              </div>
            </div>
            <form onSubmit={changePassword} className="space-y-4" noValidate>
              {[
                { label: "Current password", value: currentPassword, set: setCurrentPassword, visible: showCurrentPassword, toggle: () => setShowCurrentPassword((value) => !value), autoComplete: "current-password" },
                { label: "New password", value: newPassword, set: setNewPassword, visible: showNewPassword, toggle: () => setShowNewPassword((value) => !value), autoComplete: "new-password" },
                { label: "Confirm new password", value: confirmPassword, set: setConfirmPassword, visible: showConfirmPassword, toggle: () => setShowConfirmPassword((value) => !value), autoComplete: "new-password" },
              ].map((field) => (
                <label key={field.label} className="block space-y-1.5 text-sm font-medium text-foreground">
                  {field.label}
                  <span className="relative block">
                    <Input
                      type={field.visible ? "text" : "password"}
                      value={field.value}
                      onChange={(event) => {
                        field.set(event.target.value);
                        setPasswordError("");
                        setPasswordFieldError("");
                      }}
                      autoComplete={field.autoComplete}
                      required
                      className="pr-11"
                    />
                    <button type="button" onClick={field.toggle} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${field.visible ? "Hide" : "Show"} ${field.label.toLowerCase()}`}>
                      {field.visible ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </span>
                </label>
              ))}
              {newPassword && (
                <div className="space-y-2" aria-live="polite">
                  <div className="flex gap-1" aria-label={`Password strength: ${passwordStrength} of 4 requirements met`}>
                    {passwordRules.map((rule) => <span key={rule.label} className={`h-1.5 flex-1 rounded-full ${rule.valid ? "bg-success" : "bg-muted"}`} />)}
                  </div>
                  <ul className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                    {passwordRules.map((rule) => <li key={rule.label} className={rule.valid ? "text-success" : "text-muted-foreground"}>{rule.valid ? "✓" : "•"} {rule.label}</li>)}
                  </ul>
                </div>
              )}
              {passwordFieldError && <p className="text-sm text-destructive" role="alert">{passwordFieldError}</p>}
              {passwordError && <p className="text-sm text-destructive" role="alert">{passwordError}</p>}
              <Button type="submit" disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword} className="gap-2">
                {changingPassword && <Loader2 size={15} className="animate-spin" />}
                {changingPassword ? "Updating password…" : "Update password"}
              </Button>
            </form>
          </section>

          <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6" aria-labelledby="settings-title">
            <div className="mb-5 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-foreground"><Sun size={19} /></span>
              <div>
                <h2 id="settings-title" className="font-semibold text-foreground">Account settings</h2>
                <p className="mt-1 text-xs text-muted-foreground">Appearance and account information.</p>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Appearance</p>
                <p className="text-xs text-muted-foreground">Choose the theme used across TaskPilot.</p>
              </div>
              <div className="flex rounded-lg border border-border p-1" aria-label="Appearance">
                <button type="button" onClick={() => isDark && toggle()} aria-pressed={!isDark} className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${!isDark ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  <Sun size={14} /> Light
                </button>
                <button type="button" onClick={() => !isDark && toggle()} aria-pressed={isDark} className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isDark ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  <Moon size={14} /> Dark
                </button>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between gap-4 border-t border-border pt-4">
              <div>
                <p className="text-sm font-medium text-foreground">Account created</p>
                <p className="text-xs text-muted-foreground">Your TaskPilot account start date.</p>
              </div>
              <span className="text-sm text-muted-foreground">{user?.created_at ? new Date(user.created_at).toLocaleDateString() : "Not available"}</span>
            </div>
            <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
              <div>
                <p className="text-sm font-medium text-foreground">Privacy & account information</p>
                <p className="text-xs text-muted-foreground">Your role and access are managed by your organization.</p>
              </div>
              <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium capitalize text-secondary-foreground">{displayRole(user?.role)}</span>
            </div>
            <div className="mt-5 border-t border-border pt-4">
              <Button type="button" variant="outline" onClick={() => { logout(); navigate("/"); }} className="gap-2">
                <LogOut size={15} /> Log out
              </Button>
            </div>
          </section>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit personal information</DialogTitle>
            <DialogDescription>Update your contact and work profile. Account role and permissions can’t be changed here.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveProfile} className="space-y-4" noValidate>
            {formError && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{formError}</p>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {([
                ["name", "Full name", "text", 100, true],
                ["email", "Email address", "email", 254, true],
                ["phone_number", "Phone number", "tel", 13, false],
                ["designation", "Designation", "text", 120, false],
                ["employee_id", "Employee / staff ID", "text", 40, false],
              ] as const).map(([field, label, type, maxLength, required]) => (
                <label key={field} className="space-y-1.5 text-sm font-medium text-foreground">
                  {label}
                  <Input
                    type={type}
                    value={form[field]}
                    onChange={(event) => updateForm(field, event.target.value)}
                    maxLength={maxLength}
                    required={required}
                    autoComplete={field === "name" ? "name" : field === "email" ? "email" : field === "phone_number" ? "tel" : "off"}
                    inputMode={field === "phone_number" ? "tel" : undefined}
                    placeholder={field === "phone_number" ? "+919876543210" : undefined}
                    pattern={field === "phone_number" ? "\\+91[789][0-9]{9}" : undefined}
                    aria-invalid={Boolean(formErrors[field])}
                    aria-describedby={formErrors[field] ? `${field}-error` : undefined}
                  />
                  {field === "phone_number" && <span className="block text-xs font-normal text-muted-foreground">Use +91 followed by 10 digits; the first digit must be 7, 8, or 9.</span>}
                  {formErrors[field] && <span id={`${field}-error`} className="block text-xs font-normal text-destructive">{formErrors[field]}</span>}
                </label>
              ))}
              <label className="space-y-1.5 text-sm font-medium text-foreground">
                Department
                <Input value={form.department} maxLength={100} readOnly={user?.role !== "super_admin"} onChange={(event) => updateForm("department", event.target.value)} aria-invalid={Boolean(formErrors.department)} aria-describedby={formErrors.department ? "department-error" : "department-note"} />
                {formErrors.department && <span id="department-error" className="block text-xs font-normal text-destructive">{formErrors.department}</span>}
                <span id="department-note" className="block text-xs font-normal text-muted-foreground">{user?.role === "super_admin" ? "Department changes affect access scope." : "Department changes must be made by an administrator."}</span>
              </label>
              <label className="space-y-1.5 text-sm font-medium text-foreground sm:col-span-2">
                About me
                <textarea value={form.bio} onChange={(event) => updateForm("bio", event.target.value)} rows={4} maxLength={500} aria-invalid={Boolean(formErrors.bio)} aria-describedby={formErrors.bio ? "bio-error" : "bio-count"} className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="Share a short introduction…" />
                {formErrors.bio ? <span id="bio-error" className="block text-xs font-normal text-destructive">{formErrors.bio}</span> : <span id="bio-count" className="block text-right text-xs font-normal text-muted-foreground">{form.bio.length}/500</span>}
              </label>
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={savingProfile}>Cancel</Button>
              <Button type="submit" disabled={savingProfile} className="gap-2">
                {savingProfile && <Loader2 size={15} className="animate-spin" />}
                {savingProfile ? "Saving changes…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}
