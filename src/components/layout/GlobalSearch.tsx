import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, Building2, CheckSquare, Loader2, Search, Users, X } from "lucide-react";
import { apiGet } from "@/lib/api";
import { Input } from "@/components/ui/input";

interface SearchResult {
  id: number;
  name?: string;
  email?: string;
  title?: string;
  status?: string;
  department?: string | null;
  event_title?: string | null;
  description?: string | null;
  location?: string | null;
}

interface SearchResponse {
  users: SearchResult[];
  tasks: SearchResult[];
  events: SearchResult[];
  departments: SearchResult[];
}

const groups = [
  { key: "users", label: "Users", icon: Users },
  { key: "tasks", label: "Tasks", icon: CheckSquare },
  { key: "events", label: "Events", icon: CalendarDays },
  { key: "departments", label: "Departments", icon: Building2 },
] as const;

export function GlobalSearch() {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    const normalizedTerm = term.trim();
    if (normalizedTerm.length < 2) {
      setResults(null);
      setError("");
      setLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const data = await apiGet<SearchResponse>(`/search?q=${encodeURIComponent(normalizedTerm)}`);
        if (!cancelled) setResults(data);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [term]);

  const hasResults = results && groups.some(({ key }) => results[key].length > 0);

  const goToResult = (group: (typeof groups)[number]["key"], result: SearchResult) => {
    setOpen(false);
    setTerm("");
    if (group === "tasks") navigate(`/track/${result.id}`);
    if (group === "events") navigate(`/track?event_id=${result.id}`);
    if (group === "users") navigate("/admin?tab=employees");
    if (group === "departments") navigate("/admin?tab=departments");
  };

  return (
    <div ref={rootRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          onChange={(event) => { setTerm(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search users, tasks, events..."
          aria-label="Global search"
          className="h-10 bg-background/70 pl-9 pr-9 text-sm"
        />
        {term && (
          <button type="button" onClick={() => setTerm("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        )}
      </div>

      {open && term.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-12 z-50 max-h-[min(70vh,30rem)] overflow-y-auto rounded-xl border border-border bg-card p-2 shadow-xl">
          {loading && <div className="flex items-center gap-2 px-3 py-5 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Searching...</div>}
          {!loading && error && <div className="px-3 py-5 text-sm text-destructive">{error}</div>}
          {!loading && !error && results && !hasResults && <div className="px-3 py-5 text-sm text-muted-foreground">No matching records found.</div>}
          {!loading && !error && results && hasResults && groups.map(({ key, label, icon: Icon }) => {
            if (results[key].length === 0) return null;
            return (
              <section key={key} className="mb-2 last:mb-0">
                <h3 className="flex items-center gap-2 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><Icon size={13} /> {label}</h3>
                {results[key].map((result) => (
                  <button key={`${key}-${result.id}`} type="button" onClick={() => goToResult(key, result)} className="flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-secondary">
                    <span className="min-w-0"><span className="block truncate text-sm font-medium text-foreground">{result.name || result.title}</span><span className="block truncate text-xs text-muted-foreground">{result.email || result.department || result.event_title || result.location || result.description}</span></span>
                    {result.status && <span className="shrink-0 text-[10px] text-muted-foreground">{result.status}</span>}
                  </button>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}