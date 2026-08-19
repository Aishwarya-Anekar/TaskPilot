import { useState } from "react";
import { Search } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { PageTransition } from "@/components/motion/PageTransition";
import { apiGet } from "@/lib/api";
import { format } from "date-fns";

interface HistoryItem {
  id: number;
  category: string; // matches title
  description: string;
  status: string;
  created_at: string;
  location: string; // matches event title
}

const statusColors: Record<string, string> = {
  "Completed": "bg-success/10 text-success",
  "Fixed": "bg-success/10 text-success",
  "Pending": "bg-secondary text-muted-foreground",
  "In Progress": "bg-info/10 text-info",
  "Under Review": "bg-warning/10 text-warning",
  "Rejected": "bg-destructive/10 text-destructive",
};

export default function HistoryPage() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");

  const { data: historyData = [], isLoading } = useQuery<HistoryItem[]>({
    queryKey: ["historyTasks", search, filter],
    queryFn: () =>
      apiGet(`/tasks/history?search=${encodeURIComponent(search)}&status=${filter}`),
  });

  return (
    <PageTransition>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Activity History</h1>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks or events..."
              className="w-full pl-9 pr-4 py-2.5 rounded-lg input-focus text-foreground placeholder:text-muted-foreground focus:outline-none text-sm"
            />
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-4 py-2.5 rounded-lg input-focus text-foreground text-sm focus:outline-none bg-card cursor-pointer shadow-sm border border-border"
          >
            <option>All</option>
            <option>Completed</option>
            <option>Pending</option>
            <option>In Progress</option>
            <option>Under Review</option>
            <option>Rejected</option>
          </select>
        </div>

        <div className="bg-card rounded-xl card-elevated overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/50 sticky top-0 z-10">
                  <th className="text-left px-5 py-3.5 font-bold uppercase tracking-wider text-[10px] text-muted-foreground">Task ID</th>
                  <th className="text-left px-5 py-3.5 font-bold uppercase tracking-wider text-[10px] text-muted-foreground">Task Title</th>
                  <th className="text-left px-5 py-3.5 font-bold uppercase tracking-wider text-[10px] text-muted-foreground">Description</th>
                  <th className="text-left px-5 py-3.5 font-bold uppercase tracking-wider text-[10px] text-muted-foreground">Linked Event</th>
                  <th className="text-left px-5 py-3.5 font-bold uppercase tracking-wider text-[10px] text-muted-foreground">Orchestrated Date</th>
                  <th className="text-left px-5 py-3.5 font-bold uppercase tracking-wider text-[10px] text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground text-xs font-semibold">
                      Loading organizational logs...
                    </td>
                  </tr>
                ) : historyData.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground text-xs font-semibold">
                      No logs found.
                    </td>
                  </tr>
                ) : (
                  <AnimatePresence mode="popLayout">
                    {historyData.map((row, i) => (
                      <motion.tr
                        key={row.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="border-b border-border hover:bg-secondary/40 transition-colors duration-200"
                      >
                        <td className="px-5 py-3.5 font-semibold text-foreground">#{row.id}</td>
                        <td className="px-5 py-3.5 text-foreground font-medium">{row.category}</td>
                        <td className="px-5 py-3.5 text-muted-foreground max-w-xs truncate font-light">{row.description}</td>
                        <td className="px-5 py-3.5 text-muted-foreground font-medium">{row.location}</td>
                        <td className="px-5 py-3.5 text-muted-foreground">
                          {format(new Date(row.created_at), "MMM dd, yyyy")}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`text-[9px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-full ${statusColors[row.status] || "bg-secondary"}`}>
                            {row.status}
                          </span>
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
