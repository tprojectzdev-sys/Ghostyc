import { useEffect, useState, useCallback, useRef } from "react";
import { FileText, Search, Download, Filter } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/core/Card";
import { Button } from "../components/core/Button";
import { Input } from "../components/core/Input";
import { Badge } from "../components/core/Badge";
import { api, type LogEntry } from "../../api/client";
import { useWsEvent } from "../../api/ws";

const SERVICES = ["All Services", "relay", "agent", "bridge", "client"] as const;

export function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("All Services");
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadLogs = useCallback(() => {
    const opts: { service?: string } = {};
    if (serviceFilter !== "All Services") opts.service = serviceFilter;
    api.recentLogs(200, opts).then((r) => setLogs(r.logs)).catch(() => {});
  }, [serviceFilter]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useWsEvent("log.event", (env) => {
    const entry = env.data as LogEntry;
    if (!entry?.timestamp) return;
    if (serviceFilter !== "All Services" && entry.service !== serviceFilter) return;
    setLogs((prev) => [...prev, entry].slice(-500));
  });

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const filtered = logs.filter((log) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      log.message.toLowerCase().includes(q) ||
      log.event.toLowerCase().includes(q) ||
      (log.request_id?.toLowerCase().includes(q) ?? false)
    );
  });

  function exportLogs() {
    const text = filtered
      .map((l) => `${l.timestamp} ${l.level.toUpperCase().padEnd(5)} [${l.service}] ${l.event}: ${l.message}${l.request_id ? ` (${l.request_id})` : ""}`)
      .join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ghostyc-logs-${new Date().toISOString().slice(0, 19)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-4 shrink-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white mb-1">System Logs</h1>
          <p className="text-neutral-400 text-sm">Aggregated telemetry across the ecosystem.</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Button variant="outline" size="sm" className="flex gap-2" onClick={exportLogs}><Download className="w-4 h-4" /> Export</Button>
          <Button variant="outline" size="sm" className="flex gap-2" onClick={() => setAutoScroll(!autoScroll)}>
            <Filter className="w-4 h-4" /> {autoScroll ? "Pause" : "Resume"}
          </Button>
        </div>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden min-h-[400px]">
        <div className="p-4 border-b border-white/5 bg-black/20 flex flex-col gap-4 shrink-0">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
              <Input
                placeholder="Search logs, errors, or request IDs..."
                className="pl-9 bg-black/40"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {SERVICES.map((svc) => (
              <Badge
                key={svc}
                variant={serviceFilter === svc ? "default" : "offline"}
                className="cursor-pointer hover:bg-white/20"
                onClick={() => { setServiceFilter(svc); }}
              >
                {svc === "All Services" ? svc : svc.charAt(0).toUpperCase() + svc.slice(1)}
              </Badge>
            ))}
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-auto bg-black/40 p-4 font-mono text-xs">
          <div className="space-y-1">
            {filtered.length === 0 && (
              <div className="py-8 text-center text-neutral-600 italic">No logs matching the current filter.</div>
            )}
            {filtered.map((log, i) => (
              <div key={`${log.timestamp}-${i}`} className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4 py-1.5 border-b border-white/[0.02] hover:bg-white/[0.02] rounded px-2 transition-colors">
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-neutral-500 w-24">{new Date(log.timestamp).toLocaleTimeString(undefined, { hour12: false, fractionalSecondDigits: 3 })}</span>
                  <span className={`w-12 font-bold ${
                    log.level === "info" ? "text-blue-400" :
                    log.level === "warn" ? "text-yellow-400" :
                    log.level === "error" ? "text-red-400" : "text-neutral-400"
                  }`}>{log.level.toUpperCase()}</span>
                </div>
                <div className="flex-1 flex flex-col sm:flex-row gap-2 sm:gap-4 min-w-0">
                  <span className="text-neutral-400 w-32 shrink-0 truncate">[{log.service}]</span>
                  <span className="text-neutral-300 flex-1 break-all">{log.event}: {log.message}</span>
                  <span className="text-neutral-600 w-20 shrink-0 truncate">{log.request_id?.slice(0, 8) ?? ""}</span>
                </div>
              </div>
            ))}
            {filtered.length > 0 && (
              <div className="py-4 text-center text-neutral-600 italic">
                {autoScroll ? "Live — new entries appear below" : "Paused"}
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
