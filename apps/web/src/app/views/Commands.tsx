import { useEffect, useState, useCallback } from "react";
import { Clock, RefreshCw, XCircle, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/core/Card";
import { Badge } from "../components/core/Badge";
import { Button } from "../components/core/Button";
import { api, type LogEntry } from "../../api/client";
import { useWsEvent } from "../../api/ws";

interface CommandRow {
  request_id: string;
  time: string;
  command: string;
  state: string;
  duration: string;
  error: string;
}

export function Commands() {
  const [commands, setCommands] = useState<CommandRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadCommands = useCallback(() => {
    api.recentLogs(200, { service: "relay" }).then((r) => {
      const cmdMap = new Map<string, CommandRow>();

      for (const log of r.logs) {
        if (!log.request_id || !log.command) continue;
        const rid = log.request_id;

        if (!cmdMap.has(rid)) {
          cmdMap.set(rid, {
            request_id: rid,
            time: new Date(log.timestamp).toLocaleTimeString(),
            command: log.command,
            state: "accepted",
            duration: "---",
            error: "-",
          });
        }

        const row = cmdMap.get(rid)!;
        if (log.event === "command.result" || log.event === "command.timeout") {
          row.state = log.status ?? "unknown";
          if (log.duration_ms != null) row.duration = `${log.duration_ms}ms`;
          if (log.error) row.error = log.error.message;
        }
      }

      setCommands(Array.from(cmdMap.values()).reverse().slice(0, 50));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadCommands();
  }, [loadCommands]);

  useWsEvent("command.result", () => loadCommands());

  useWsEvent("log.event", (env) => {
    const data = env.data as LogEntry;
    if (data?.command && data?.request_id) {
      loadCommands();
    }
  });

  function stateBadge(state: string) {
    switch (state) {
      case "success":
        return <Badge variant="success"><CheckCircle2 className="w-3 h-3" /> Success</Badge>;
      case "failed":
        return <Badge variant="danger"><XCircle className="w-3 h-3" /> Failed</Badge>;
      case "timeout":
        return <Badge variant="warning"><AlertTriangle className="w-3 h-3" /> Timeout</Badge>;
      case "running":
      case "accepted":
        return <Badge variant="default"><Loader2 className="w-3 h-3 animate-spin" /> {state}</Badge>;
      default:
        return <Badge variant="offline">{state}</Badge>;
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white mb-1">Command History</h1>
          <p className="text-neutral-400 text-sm">Recent instructions and execution status.</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadCommands} className="flex gap-2">
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle><Clock className="w-5 h-5 text-neutral-400" /> Execution Queue</CardTitle>
          <CardDescription>History of commands sent to the remote agent.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs uppercase bg-black/40 text-neutral-500 border-y border-white/5">
                <tr>
                  <th className="px-6 py-3 font-medium">Timestamp</th>
                  <th className="px-6 py-3 font-medium">Request ID</th>
                  <th className="px-6 py-3 font-medium">Command</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Duration</th>
                  <th className="px-6 py-3 font-medium">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading && (
                  <tr><td colSpan={6} className="px-6 py-8 text-center text-neutral-500"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading...</td></tr>
                )}
                {!loading && commands.length === 0 && (
                  <tr><td colSpan={6} className="px-6 py-8 text-center text-neutral-600 italic">No commands executed yet.</td></tr>
                )}
                {commands.map((c) => (
                  <tr key={c.request_id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="px-6 py-3 whitespace-nowrap text-neutral-400 font-mono text-xs">{c.time}</td>
                    <td className="px-6 py-3 whitespace-nowrap text-neutral-500 font-mono text-xs group-hover:text-neutral-300">{c.request_id.slice(0, 8)}</td>
                    <td className="px-6 py-3 whitespace-nowrap text-white font-mono">{c.command}</td>
                    <td className="px-6 py-3 whitespace-nowrap">{stateBadge(c.state)}</td>
                    <td className="px-6 py-3 whitespace-nowrap text-neutral-400 font-mono text-xs">{c.duration}</td>
                    <td className="px-6 py-3 whitespace-nowrap text-neutral-500 truncate max-w-[200px]">{c.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
