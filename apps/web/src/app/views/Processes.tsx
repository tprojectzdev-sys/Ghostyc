import { useState, useCallback } from "react";
import { Activity, Search, X, RefreshCw, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/core/Card";
import { Input } from "../components/core/Input";
import { Button } from "../components/core/Button";
import { Badge } from "../components/core/Badge";
import { api } from "../../api/client";
import { useWsEvent } from "../../api/ws";

interface ProcessEntry {
  pid: number;
  name: string;
  mem_mb: number;
  cpu_percent: number | null;
}

export function Processes() {
  const [processes, setProcesses] = useState<ProcessEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [killing, setKilling] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchProcesses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.postCommand("agent", "list_processes", { limit: 200, sort: "mem" });
      const rid = res.request_id;
      let retries = 0;
      const poll = async () => {
        const cmd = await api.getCommand(rid);
        if (cmd.state === "success" && cmd.result) {
          const data = cmd.result as { processes: ProcessEntry[] };
          setProcesses(data.processes ?? []);
          setLoaded(true);
          setLoading(false);
        } else if (cmd.state === "failed" || cmd.state === "timeout") {
          setError(cmd.error?.message ?? "Command failed");
          setLoading(false);
        } else if (retries < 20) {
          retries++;
          setTimeout(poll, 500);
        } else {
          setError("Timed out waiting for process list");
          setLoading(false);
        }
      };
      setTimeout(poll, 800);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  }, []);

  useWsEvent("command.result", (env) => {
    const data = env.data as { state: string; result?: { processes?: ProcessEntry[] } };
    if (data.state === "success" && data.result?.processes && loading) {
      setProcesses(data.result.processes);
      setLoaded(true);
      setLoading(false);
    }
  });

  async function killProcess(pid: number) {
    setKilling(pid);
    try {
      await api.postCommand("agent", "kill_process", { pid });
      setTimeout(() => {
        fetchProcesses();
        setKilling(null);
      }, 1500);
    } catch {
      setKilling(null);
    }
  }

  const filtered = processes.filter((p) =>
    !filter || p.name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white mb-1">Processes</h1>
          <p className="text-neutral-400 text-sm">View and manage running applications.</p>
        </div>
        <div className="flex gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
            <Input
              placeholder="Search processes..."
              className="pl-9"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <Button variant="outline" size="icon" onClick={fetchProcesses} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-neutral-400 bg-white/5 border border-white/10 rounded-lg p-3">
          {error}
        </div>
      )}

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-white/5 pb-4">
          <CardTitle><Activity className="w-5 h-5 text-neutral-400" /> Task List</CardTitle>
          <CardDescription>
            {loaded
              ? `Showing ${filtered.length} of ${processes.length} processes.`
              : "Click refresh to fetch the live process list from the agent."}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs uppercase bg-black/40 text-neutral-500 border-y border-white/5">
                <tr>
                  <th className="px-6 py-3 font-medium">Name</th>
                  <th className="px-6 py-3 font-medium">PID</th>
                  <th className="px-6 py-3 font-medium">CPU</th>
                  <th className="px-6 py-3 font-medium">Memory</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {!loaded && !loading && (
                  <tr><td colSpan={6} className="px-6 py-8 text-center text-neutral-600 italic">No data. Click the refresh button above to load.</td></tr>
                )}
                {loading && (
                  <tr><td colSpan={6} className="px-6 py-8 text-center text-neutral-500"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Fetching processes...</td></tr>
                )}
                {filtered.map((p) => (
                  <tr key={p.pid} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="px-6 py-3 whitespace-nowrap text-white font-medium">{p.name}</td>
                    <td className="px-6 py-3 whitespace-nowrap text-neutral-500 font-mono text-xs">{p.pid}</td>
                    <td className="px-6 py-3 whitespace-nowrap text-neutral-300 font-mono">
                      {p.cpu_percent != null ? `${p.cpu_percent.toFixed(1)}%` : "N/A"}
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap text-neutral-300 font-mono">
                      {p.mem_mb >= 1024 ? `${(p.mem_mb / 1024).toFixed(1)} GB` : `${Math.round(p.mem_mb)} MB`}
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap">
                      <Badge variant="default" className="bg-white/5">Running</Badge>
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-neutral-500 hover:text-white hover:bg-white/10"
                        onClick={() => killProcess(p.pid)}
                        disabled={killing === p.pid}
                      >
                        {killing === p.pid ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                      </Button>
                    </td>
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
