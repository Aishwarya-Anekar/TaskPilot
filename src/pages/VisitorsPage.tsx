import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clock3, FileCheck2, Loader2, LogIn, LogOut, Mail, QrCode, RotateCcw, Search, UserRound, Users, XCircle } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { apiGet, apiPost } from "@/lib/api";
import { PageTransition } from "@/components/motion/PageTransition";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface VisitorActivity {
  action: string;
  details: string;
  created_at: string;
  performed_by_name?: string;
}

interface Visitor {
  id: number;
  name: string;
  contact: string;
  organization?: string | null;
  purpose: string;
  event_id?: number | null;
  event_title?: string | null;
  host_id?: number | null;
  host_name?: string | null;
  expected_arrival: string;
  check_in_at?: string | null;
  check_out_at?: string | null;
  status: string;
  pass_code: string;
  email_status: "Not Applicable" | "Pending" | "Sending" | "Sent" | "Failed";
  host_notification_status?: "Sent" | "Already Sent" | "Failed";
  email_attempt_count: number;
  email_last_attempt_at?: string | null;
  email_last_error?: string | null;
  activity?: VisitorActivity[];
}

interface VisitorResponse {
  visitors: Visitor[];
  counts: { expected: number; checked_in: number; checked_out: number };
  total: number;
  limit: number;
  offset: number;
}

interface VisitorEvent { id: number; title: string; status: string; }
interface VisitorHost { id: number; name: string; role: string; department?: string | null; }

const PAGE_SIZE = 25;
const emptyForm = { name: "", contact: "", organization: "", purpose: "", event_id: "", host_id: "", expected_arrival: "" };
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function invitationTone(status: Visitor["email_status"]) {
  if (status === "Sent") return "text-success";
  if (status === "Failed") return "text-destructive";
  if (status === "Sending" || status === "Pending") return "text-warning";
  return "text-muted-foreground";
}

export default function VisitorsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canFilterAllHosts = user?.role === "admin" || user?.role === "super_admin";
  const canRegisterVisitors = user?.role === "admin" || user?.role === "super_admin" || user?.role === "dept_head";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [eventId, setEventId] = useState("");
  const [hostId, setHostId] = useState("");
  const [emailStatus, setEmailStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [registering, setRegistering] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const registrationKey = useRef(crypto.randomUUID());
  const retryKeys = useRef(new Map<number, string>());

  const visitorQuery = useQuery<VisitorResponse>({
    queryKey: ["visitors", search, status, eventId, hostId, emailStatus, dateFrom, dateTo, offset],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (search.trim()) params.set("search", search.trim());
      if (status !== "All") params.set("status", status);
      if (eventId) params.set("event_id", eventId);
      if (hostId) params.set("host_id", hostId);
      if (emailStatus) params.set("email_status", emailStatus);
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      return apiGet(`/visitors?${params.toString()}`);
    },
  });
  const { data: events = [] } = useQuery<VisitorEvent[]>({
    queryKey: ["visitorEvents"],
    queryFn: () => apiGet("/tasks/events/all"),
  });
  const { data: hosts = [] } = useQuery<VisitorHost[]>({
    queryKey: ["visitorHosts"],
    queryFn: () => apiGet("/admin/employees"),
  });
  const { data: selected } = useQuery<Visitor>({
    queryKey: ["visitor", selectedId],
    queryFn: () => apiGet(`/visitors/${selectedId}`),
    enabled: selectedId !== null,
  });

  const requestedVisitorId = Number(searchParams.get("visitor_id"));
  useEffect(() => {
    if (Number.isInteger(requestedVisitorId) && requestedVisitorId > 0) setSelectedId(requestedVisitorId);
  }, [requestedVisitorId]);

  useEffect(() => setOffset(0), [search, status, eventId, hostId, emailStatus, dateFrom, dateTo]);

  const refreshVisitors = async (visitorId?: number) => {
    await queryClient.invalidateQueries({ queryKey: ["visitors"] });
    if (visitorId !== undefined) await queryClient.invalidateQueries({ queryKey: ["visitor", visitorId] });
  };

  const register = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (registering) return;
    const normalizedContact = form.contact.trim();
    if (normalizedContact.includes("@") && !emailPattern.test(normalizedContact)) {
      toast.error("Enter a valid visitor email address");
      return;
    }
    setRegistering(true);
    try {
      const visitor = await apiPost<Visitor>("/visitors", {
        ...form,
        contact: normalizedContact,
        event_id: form.event_id ? Number(form.event_id) : undefined,
        host_id: form.host_id ? Number(form.host_id) : undefined,
        registration_key: registrationKey.current,
      });
      registrationKey.current = crypto.randomUUID();
      setForm(emptyForm);
      setOffset(0);
      setSelectedId(visitor.id);
      await refreshVisitors(visitor.id);
      if (!normalizedContact.includes("@")) {
        if (visitor.host_notification_status === "Failed") toast.error("Visitor registered. No email was provided, and the assigned host could not be notified in-app.");
        else toast.success("Visitor registered. Email invitation unavailable because no email address was provided.");
      } else if (visitor.host_notification_status === "Failed") {
        toast.error(visitor.email_status === "Sent" ? "Invitation email was accepted, but the assigned host could not be notified in-app." : `Visitor registered, but the host notification and invitation email failed. ${visitor.email_last_error || "Retry both from the visitor record."}`);
      } else if (visitor.email_status === "Sent") {
        toast.success("Visitor registered and invitation accepted by the email provider.");
      } else {
        toast.error(`Visitor registered successfully, but the invitation email could not be sent. ${visitor.email_last_error || "Retry the invitation from the visitor record."}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to register visitor");
    } finally {
      setRegistering(false);
    }
  };

  const changeStatus = async (visitor: Visitor, action: "check-in" | "check-out" | "cancel") => {
    if (action === "cancel" && !window.confirm(`Cancel ${visitor.name}'s expected visit? The pass will no longer be accepted for check-in.`)) return;
    setUpdatingId(visitor.id);
    try {
      await apiPost(`/visitors/${visitor.id}/${action}`, {});
      await refreshVisitors(visitor.id);
      toast.success(action === "check-in" ? "Visitor checked in" : action === "check-out" ? "Visitor checked out" : "Visitor registration cancelled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update visitor status");
    } finally {
      setUpdatingId(null);
    }
  };

  const resendInvitation = async (visitor: Visitor) => {
    if (retryingId !== null) return;
    const requestKey = retryKeys.current.get(visitor.id) || crypto.randomUUID();
    retryKeys.current.set(visitor.id, requestKey);
    setRetryingId(visitor.id);
    try {
      const updated = await apiPost<Visitor>(`/visitors/${visitor.id}/resend-invitation`, { request_key: requestKey });
      retryKeys.current.delete(visitor.id);
      await refreshVisitors(visitor.id);
      if (updated.email_status === "Sent") toast.success("Invitation accepted by the email provider.");
      else toast.error(updated.email_last_error || "Invitation email could not be sent. The failure has been recorded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to resend visitor invitation");
    } finally {
      setRetryingId(null);
    }
  };

  const clearFilters = () => {
    setSearch("");
    setStatus("All");
    setEventId("");
    setHostId("");
    setEmailStatus("");
    setDateFrom("");
    setDateTo("");
  };

  const visitors = visitorQuery.data?.visitors ?? [];
  const counts = visitorQuery.data?.counts ?? { expected: 0, checked_in: 0, checked_out: 0 };
  const total = visitorQuery.data?.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PageTransition>
      <div className="mx-auto max-w-7xl space-y-6">
        <header>
          <p className="text-sm font-semibold text-accent">Front desk</p>
          <h1 className="text-2xl font-bold text-foreground">Visitor Management</h1>
          <p className="mt-1 text-xs text-muted-foreground">Register guests, issue pass codes, and coordinate event access.</p>
        </header>

        <section aria-label="All-time visitor totals" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[["Expected visitors", counts.expected], ["Currently checked in", counts.checked_in], ["Checked out", counts.checked_out]].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl bg-card p-5 card-elevated">
              <Users size={18} className="mb-3 text-accent" />
              <p className="text-xs uppercase text-muted-foreground">{label} · all time</p>
              <p className="mt-1 text-3xl font-bold text-foreground">{String(value)}</p>
            </div>
          ))}
        </section>

        <div className="grid gap-6 lg:grid-cols-5">
          {canRegisterVisitors && <form onSubmit={register} aria-busy={registering} className="space-y-3 rounded-xl bg-card p-5 card-elevated lg:col-span-2">
            <h2 className="text-sm font-bold text-foreground">Register visitor</h2>
            <label className="block text-xs font-medium text-foreground">Visitor full name
              <input required maxLength={150} autoComplete="name" placeholder="Full name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1 w-full rounded-lg px-3 py-2.5 text-sm text-foreground input-focus" />
            </label>
            <label className="block text-xs font-medium text-foreground">Phone or email
              <input required maxLength={150} autoComplete="email" placeholder="Phone number or email address" value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} className="mt-1 w-full rounded-lg px-3 py-2.5 text-sm text-foreground input-focus" />
            </label>
            {form.contact.includes("@") && !emailPattern.test(form.contact.trim()) && <p role="alert" className="text-xs text-destructive">Enter a valid email address before registering.</p>}
            <label className="block text-xs font-medium text-foreground">Organization <span className="font-normal text-muted-foreground">(optional)</span>
              <input maxLength={150} placeholder="Organization" value={form.organization} onChange={(event) => setForm({ ...form, organization: event.target.value })} className="mt-1 w-full rounded-lg px-3 py-2.5 text-sm text-foreground input-focus" />
            </label>
            <label className="block text-xs font-medium text-foreground">Purpose of visit
              <textarea required maxLength={2000} rows={3} placeholder="Purpose of visit" value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value })} className="mt-1 w-full resize-y rounded-lg px-3 py-2.5 text-sm text-foreground input-focus" />
            </label>
            <label className="block text-xs font-medium text-foreground">Associated event <span className="font-normal text-muted-foreground">(optional)</span>
              <select value={form.event_id} onChange={(event) => setForm({ ...form, event_id: event.target.value })} className="mt-1 w-full rounded-lg px-3 py-2.5 text-sm text-foreground input-focus">
                <option value="">No associated event</option>{events.filter((item) => item.status !== "Cancelled").map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </label>
            {canFilterAllHosts && <label className="block text-xs font-medium text-foreground">Host
              <select value={form.host_id} onChange={(event) => setForm({ ...form, host_id: event.target.value })} className="mt-1 w-full rounded-lg px-3 py-2.5 text-sm text-foreground input-focus">
                <option value="">Host me</option>{hosts.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.role})</option>)}
              </select>
            </label>}
            <label className="block text-xs font-medium text-foreground">Visit date and time
              <input required type="datetime-local" value={form.expected_arrival} onChange={(event) => setForm({ ...form, expected_arrival: event.target.value })} className="mt-1 w-full rounded-lg px-3 py-2.5 text-sm text-foreground input-focus" />
            </label>
            {!form.contact.includes("@") && form.contact.trim() && <p className="text-[11px] text-muted-foreground">No email address is provided, so no invitation email will be sent.</p>}
            <button disabled={registering || (form.contact.includes("@") && !emailPattern.test(form.contact.trim()))} className="flex w-full items-center justify-center gap-2 rounded-lg btn-gradient px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
              {registering ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />}{registering ? "Registering..." : "Register & Issue Pass"}
            </button>
          </form>}

          <section className="space-y-4 lg:col-span-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="relative sm:col-span-2"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input aria-label="Search visitors" placeholder="Search name, contact, organization, purpose" value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-lg py-2.5 pl-9 pr-3 text-sm text-foreground input-focus" /></label>
              <select aria-label="Filter visit status" value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground"><option value="All">All visit statuses</option><option>Expected</option><option>Checked In</option><option>Checked Out</option><option>Cancelled</option></select>
              <select aria-label="Filter event" value={eventId} onChange={(event) => setEventId(event.target.value)} className="rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground"><option value="">All events</option>{events.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
              <select aria-label="Filter invitation email status" value={emailStatus} onChange={(event) => setEmailStatus(event.target.value)} className="rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground"><option value="">All invitation statuses</option>{["Not Applicable", "Pending", "Sending", "Sent", "Failed"].map((item) => <option key={item}>{item}</option>)}</select>
              {canFilterAllHosts && <select aria-label="Filter host" value={hostId} onChange={(event) => setHostId(event.target.value)} className="rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground"><option value="">All hosts</option>{hosts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
              <label className="text-[10px] text-muted-foreground">Visit date from<input aria-label="Visit date from" type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-2 text-xs text-foreground input-focus" /></label>
              <label className="text-[10px] text-muted-foreground">Visit date to<input aria-label="Visit date to" type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-2 text-xs text-foreground input-focus" /></label>
              <button type="button" onClick={clearFilters} className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground sm:col-span-2 sm:justify-self-end"><RotateCcw size={13} /> Clear filters</button>
            </div>

            <div aria-live="polite" className="space-y-2">
              {visitorQuery.isLoading ? <div className="rounded-xl bg-card p-10 text-center text-sm text-muted-foreground"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />Loading visitors...</div>
                : visitorQuery.isError ? <div role="alert" className="rounded-xl bg-card p-8 text-center text-sm text-destructive">{visitorQuery.error instanceof Error ? visitorQuery.error.message : "Unable to load visitor records."}</div>
                  : visitors.length === 0 ? <div className="rounded-xl bg-card p-8 text-center text-sm text-muted-foreground">No visitors match these filters.</div>
                    : visitors.map((visitor) => (
                      <article key={visitor.id} className={`space-y-3 rounded-xl border bg-card p-4 card-shadow ${selectedId === visitor.id ? "border-accent" : "border-border"}`}>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-sm text-foreground">{visitor.name}</h3><span className="rounded bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase text-accent">{visitor.status}</span></div>
                            <p className="break-words text-xs text-muted-foreground">{visitor.contact}{visitor.organization ? ` · ${visitor.organization}` : ""}</p>
                            <p className="text-xs text-muted-foreground">{visitor.purpose}</p>
                            <p className="text-xs text-muted-foreground">Host: {visitor.host_name || "—"} · Event: {visitor.event_title || "No event"}</p>
                            <p className="flex items-center gap-1 text-xs text-muted-foreground"><Clock3 size={13} />{new Date(visitor.expected_arrival).toLocaleString()}</p>
                          </div>
                          <div className="flex shrink-0 flex-col gap-1 text-[11px] sm:items-end">
                            <span className={`inline-flex items-center gap-1 font-semibold ${invitationTone(visitor.email_status)}`}><Mail size={13} />Invitation: {visitor.email_status}</span>
                            <span className="inline-flex items-center gap-1 text-muted-foreground"><FileCheck2 size={13} />{visitor.status === "Cancelled" ? "Pass cancelled" : visitor.pass_code ? "Pass issued" : "No pass"}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                          <button type="button" onClick={() => setSelectedId(selectedId === visitor.id ? null : visitor.id)} className="rounded border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary">{selectedId === visitor.id ? "Hide details" : "View details"}</button>
                          {visitor.status === "Expected" && <>
                            <button type="button" disabled={updatingId !== null} onClick={() => changeStatus(visitor, "check-in")} className="inline-flex items-center gap-1 rounded-lg btn-gradient px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"><LogIn size={13} />Check in</button>
                            <button type="button" disabled={updatingId !== null} onClick={() => changeStatus(visitor, "cancel")} className="inline-flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50"><XCircle size={13} />Cancel</button>
                          </>}
                          {visitor.status === "Checked In" && <button type="button" disabled={updatingId !== null} onClick={() => changeStatus(visitor, "check-out")} className="inline-flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary disabled:opacity-50"><LogOut size={13} />Check out</button>}
                          {visitor.contact.includes("@") && visitor.status !== "Cancelled" && <button type="button" disabled={retryingId !== null} onClick={() => resendInvitation(visitor)} className="inline-flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50">{retryingId === visitor.id ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}{visitor.email_status === "Sent" ? "Resend invitation" : visitor.email_status === "Sending" ? "Sending..." : "Retry invitation"}</button>}
                        </div>
                      </article>
                    ))}
            </div>

            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{total ? `Showing ${offset + 1}-${Math.min(offset + visitors.length, total)} of ${total.toLocaleString()} visitors` : "0 visitors"}</span>
              <div className="flex items-center gap-2"><button aria-label="Previous visitor page" disabled={offset === 0 || visitorQuery.isFetching} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} className="rounded border border-border p-1.5 disabled:opacity-50"><ChevronLeft size={15} /></button><span>Page {page} of {pageCount}</span><button aria-label="Next visitor page" disabled={offset + visitors.length >= total || visitorQuery.isFetching} onClick={() => setOffset(offset + PAGE_SIZE)} className="rounded border border-border p-1.5 disabled:opacity-50"><ChevronRight size={15} /></button></div>
            </div>
          </section>
        </div>

        {selected && (
          <section className="space-y-4 rounded-xl bg-card p-5 card-elevated" aria-label="Visitor details">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-foreground">{selected.name}</h2>
                <p className="text-sm text-muted-foreground">{selected.purpose} · Host: {selected.host_name || "—"}</p>
                <p className="text-xs text-muted-foreground">Pass code: <span className="font-mono text-foreground">{selected.pass_code}</span></p>
                <p className={`text-xs font-semibold ${invitationTone(selected.email_status)}`}>Invitation status: {selected.email_status}{selected.email_attempt_count > 0 ? ` · ${selected.email_attempt_count} attempt(s)` : ""}</p>
                {selected.email_last_error && <p className="text-xs text-destructive">{selected.email_last_error}</p>}
                {selected.check_in_at && <p className="text-xs text-muted-foreground">Checked in: {new Date(selected.check_in_at).toLocaleString()}</p>}
                {selected.check_out_at && <p className="text-xs text-muted-foreground">Checked out: {new Date(selected.check_out_at).toLocaleString()}</p>}
              </div>
              <button type="button" onClick={() => { setSelectedId(null); const next = new URLSearchParams(searchParams); next.delete("visitor_id"); setSearchParams(next); }} aria-label="Close visitor details" className="self-start rounded border border-border p-2 text-muted-foreground hover:bg-secondary"><XCircle size={15} /></button>
            </div>
            <div className="border-t border-border pt-3">
              <h3 className="mb-2 text-xs font-bold uppercase text-muted-foreground">Activity history</h3>
              {(selected.activity || []).length ? selected.activity?.map((item, index) => <p key={`${item.action}-${index}`} className="border-b border-border/50 py-1.5 text-xs text-muted-foreground">{item.action} · {new Date(item.created_at).toLocaleString()} · {item.details}</p>) : <p className="text-xs text-muted-foreground">No activity recorded.</p>}
            </div>
          </section>
        )}
      </div>
    </PageTransition>
  );
}