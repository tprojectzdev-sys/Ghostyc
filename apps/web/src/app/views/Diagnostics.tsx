import { useEffect, useState, useCallback } from "react";
import { CheckCircle, XCircle, AlertCircle, RefreshCw, Server, Smartphone, MonitorSmartphone, Wifi, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/core/Card";
import { Button } from "../components/core/Button";
import { api, type DiagnosticsSnapshot } from "../../api/client";

export function Diagnostics() {
  const [diag, setDiag] = useState<DiagnosticsSnapshot | null>(null);
  const [healthMs, setHealthMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  const loadDiag = useCallback(async () => {
    setLoading(true);
    try {
      const start = performance.now();
      await api.health();
      setHealthMs(Math.round(performance.now() - start));
    } catch {
      setHealthMs(null);
    }
    try {
      const snap = await api.diagnostics();
      setDiag(snap);
      setLastCheck(new Date());
    } catch {
      // keep stale data
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDiag();
  }, [loadDiag]);

  function timeAgo(d: Date | null): string {
    if (!d) return "Never";
    const ms = Date.now() - d.getTime();
    if (ms < 5000) return "Just now";
    if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`;
    return `${Math.floor(ms / 60000)}m ago`;
  }

  const agentOnline = diag?.agent?.status === "online";
  const bridgeOnline = diag?.bridge?.status === "online";

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white mb-1">System Diagnostics</h1>
          <p className="text-neutral-400 text-sm">Connectivity testing and component health checks.</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadDiag} disabled={loading} className="flex gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <DiagCard
          title="REST API Health"
          icon={<Server />}
          status={healthMs != null ? "ok" : "error"}
          desc="Testing standard HTTP endpoints on Railway relay."
          lastCheck={timeAgo(lastCheck)}
          result={healthMs != null ? `200 OK — ${healthMs}ms` : "Unreachable"}
          onTest={loadDiag}
          loading={loading}
        />
        <DiagCard
          title="Relay Status"
          icon={<Server />}
          status={diag?.relay.status === "ok" ? "ok" : "warning"}
          desc="Relay uptime and log buffer utilization."
          lastCheck={timeAgo(lastCheck)}
          result={diag
            ? `Uptime: ${formatUptime(diag.relay.uptime_s)} | Logs: ${diag.relay.log_buffer_size}/${diag.relay.log_buffer_capacity} | WS clients: ${diag.relay.ws_clients_connected}`
            : "Loading..."}
          onTest={loadDiag}
          loading={loading}
        />
        <DiagCard
          title="Windows Agent"
          icon={<MonitorSmartphone />}
          status={agentOnline ? "ok" : "error"}
          desc="Verifying local machine agent connectivity."
          lastCheck={timeAgo(lastCheck)}
          result={diag?.agent
            ? `${diag.agent.status.toUpperCase()} | v${diag.agent.version ?? "?"} | Heartbeat: ${diag.agent.last_heartbeat ? timeAgo(new Date(diag.agent.last_heartbeat)) : "N/A"} | Reconnects: ${diag.agent.reconnect_count}`
            : "Agent has never connected"}
          onTest={loadDiag}
          loading={loading}
        />
        <DiagCard
          title="WoL Bridge"
          icon={<Smartphone />}
          status={bridgeOnline ? "ok" : diag?.bridge ? "warning" : "error"}
          desc="Testing connection to local network wake bridge."
          lastCheck={timeAgo(lastCheck)}
          result={diag?.bridge
            ? `${diag.bridge.status.toUpperCase()} | v${diag.bridge.version ?? "?"}`
            : "Bridge not connected (Phase 5)"}
          onTest={loadDiag}
          loading={loading}
        />
        <DiagCard
          title="Last Agent Command"
          icon={<RefreshCw />}
          status={diag?.agent?.last_command
            ? (diag.agent.last_command.state === "success" ? "ok" : "warning")
            : "ok"}
          desc="Most recent command sent to the agent."
          lastCheck={timeAgo(lastCheck)}
          result={diag?.agent?.last_command
            ? `${diag.agent.last_command.command} → ${diag.agent.last_command.state} (${diag.agent.last_command.request_id.slice(0, 8)})`
            : "No commands sent yet"}
          onTest={loadDiag}
          loading={loading}
        />
        <DiagCard
          title="Auth Tokens"
          icon={<Wifi />}
          status={diag?.auth.client_token_present && diag?.auth.agent_token_present ? "ok" : "error"}
          desc="Verifying required auth tokens are configured."
          lastCheck={timeAgo(lastCheck)}
          result={diag
            ? `Client: ${diag.auth.client_token_present ? "Set" : "MISSING"} | Agent: ${diag.auth.agent_token_present ? "Set" : "MISSING"} | Bridge: ${diag.auth.bridge_token_present ? "Set" : "N/A"}`
            : "Loading..."}
          onTest={loadDiag}
          loading={loading}
        />
      </div>
    </div>
  );
}

function formatUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(s % 60)}s`;
}

function DiagCard({ title, icon, status, desc, lastCheck, result, onTest, loading }: {
  title: string; icon: React.ReactNode; status: "ok" | "warning" | "error";
  desc: string; lastCheck: string; result: string; onTest: () => void; loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-3 border-b border-white/5 mb-3">
        <div className="flex justify-between items-start">
          <CardTitle className="text-base">
            <span className="text-neutral-400 w-4 h-4 mr-1 inline-block [&>svg]:w-4 [&>svg]:h-4">{icon}</span>
            {title}
          </CardTitle>
          <StatusIcon status={status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-neutral-400 h-10">{desc}</p>

        <div className="bg-black/30 rounded-lg p-3 border border-white/5 font-mono text-xs text-neutral-300">
          {result}
        </div>

        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-neutral-500">Last checked: {lastCheck}</span>
          <Button variant="outline" size="sm" onClick={onTest} disabled={loading}>
            {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
            Run Test
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusIcon({ status }: { status: "ok" | "warning" | "error" }) {
  if (status === "ok") return <CheckCircle className="w-5 h-5 text-neutral-400" />;
  if (status === "warning") return <AlertCircle className="w-5 h-5 text-neutral-500" />;
  if (status === "error") return <XCircle className="w-5 h-5 text-neutral-600" />;
  return null;
}
