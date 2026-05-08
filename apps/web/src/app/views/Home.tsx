import { useEffect, useState, useCallback } from "react";
import { Activity, Power, RefreshCw, Monitor, Zap, Shield, EyeOff } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/core/Card";
import { Button } from "../components/core/Button";
import { Badge } from "../components/core/Badge";
import { api, type DeviceSnapshot, type LogEntry } from "../../api/client";
import { useWsEvent } from "../../api/ws";

export function Home() {
  const [devices, setDevices] = useState<DeviceSnapshot[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [commanding, setCommanding] = useState<string | null>(null);

  const loadDevices = useCallback(() => {
    api.devices().then((r) => setDevices(r.devices)).catch(() => {});
  }, []);

  const loadLogs = useCallback(() => {
    api.recentLogs(10).then((r) => setLogs(r.logs)).catch(() => {});
  }, []);

  useEffect(() => {
    loadDevices();
    loadLogs();
    const iv = setInterval(loadDevices, 15000);
    return () => clearInterval(iv);
  }, [loadDevices, loadLogs]);

  useWsEvent("device.status", () => loadDevices());

  useWsEvent("log.event", (env) => {
    const entry = env.data as LogEntry;
    if (entry?.timestamp) {
      setLogs((prev) => [entry, ...prev].slice(0, 10));
    }
  });

  const agentDev = devices.find((d) => d.role === "agent");
  const bridgeDev = devices.find((d) => d.role === "bridge");
  const agentOnline = agentDev?.status === "online";
  const overallOnline = agentOnline;

  function timeAgo(iso: string | null): string {
    if (!iso) return "N/A";
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 1000) return "just now";
    if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`;
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
    return `${Math.floor(ms / 3600000)}h ago`;
  }

  async function sendCommand(command: string, args: Record<string, unknown> = {}) {
    setCommanding(command);
    try {
      await api.postCommand("agent", command, args);
    } catch {
      // result will come via WS or can be polled
    } finally {
      setCommanding(null);
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white mb-1">Dashboard</h1>
          <p className="text-neutral-400 text-sm">Personal PC control ecosystem.</p>
        </div>
        <Badge variant={overallOnline ? "success" : "offline"}>
          {overallOnline ? "System Online" : "System Offline"}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* PC Status Card */}
        <Card className="col-span-1 lg:col-span-2">
          <CardHeader>
            <CardTitle><Monitor className="w-5 h-5 text-neutral-400" /> System Status</CardTitle>
            <CardDescription>Real-time connection overview.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <StatusItem label="Device Name" value={agentDev?.device_id ?? "Not seen"} />
              <StatusItem label="Connection" value={agentOnline ? "Connected" : "Disconnected"} active={agentOnline} />
              <StatusItem label="Agent Status" value={agentDev ? (agentOnline ? "Running" : "Offline") : "Not seen"} active={agentOnline} />
              <StatusItem label="Relay" value="Active" active />
              <StatusItem label="Wake Bridge" value={bridgeDev ? (bridgeDev.status === "online" ? "Ready" : "Offline") : "Not connected"} active={bridgeDev?.status === "online"} />
              <StatusItem label="Last Heartbeat" value={agentDev ? timeAgo(agentDev.last_heartbeat) : "N/A"} />
              <StatusItem label="Agent Version" value={agentDev?.version ?? "N/A"} />
              <StatusItem label="Reconnects" value={String(agentDev?.reconnect_count ?? 0)} />
            </div>
          </CardContent>
        </Card>

        {/* Quick Controls Card */}
        <Card className="col-span-1 border-white/20 shadow-[0_0_30px_rgba(255,255,255,0.05)]">
          <CardHeader>
            <CardTitle><Zap className="w-5 h-5 text-neutral-400" /> Quick Actions</CardTitle>
            <CardDescription>Direct power control commands.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <Button className="w-full flex gap-2" disabled><Power className="w-4 h-4" /> Wake PC</Button>
              <Button variant="outline" className="w-full flex gap-2" disabled={!agentOnline || commanding === "sleep"} onClick={() => sendCommand("sleep")}><EyeOff className="w-4 h-4" /> Sleep</Button>
              <Button variant="outline" className="w-full flex gap-2" disabled={!agentOnline || commanding === "lock"} onClick={() => sendCommand("lock")}><Shield className="w-4 h-4" /> Lock</Button>
              <Button variant="outline" className="w-full flex gap-2" disabled={!agentOnline || commanding === "restart"} onClick={() => sendCommand("restart", { delay_s: 5 })}><RefreshCw className="w-4 h-4" /> Restart</Button>
              <Button variant="danger" className="col-span-2 flex gap-2" disabled={!agentOnline || commanding === "shutdown"} onClick={() => sendCommand("shutdown", { delay_s: 10 })}><Power className="w-4 h-4" /> Shutdown</Button>
            </div>
          </CardContent>
        </Card>

        {/* Live Activity Card */}
        <Card className="col-span-1 lg:col-span-3">
          <CardHeader>
            <CardTitle><Activity className="w-5 h-5 text-neutral-400" /> Live Activity</CardTitle>
            <CardDescription>Recent commands and events stream.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 font-mono text-xs">
              {logs.length === 0 && (
                <div className="py-4 text-center text-neutral-600 italic">No log events yet. Interact with the system to generate activity.</div>
              )}
              {logs.map((log, i) => (
                <ActivityRow
                  key={`${log.timestamp}-${i}`}
                  time={new Date(log.timestamp).toLocaleTimeString()}
                  event={`[${log.service}] ${log.event}: ${log.message}`}
                  level={log.level}
                  id={log.request_id ?? ""}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatusItem({ label, value, active }: { label: string; value: string; active?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-neutral-500 uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-2">
        {active && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
        <span className="text-sm font-medium text-neutral-200">{value}</span>
      </div>
    </div>
  );
}

function ActivityRow({ time, event, level, id }: { time: string; event: string; level: string; id: string }) {
  return (
    <div className="flex items-center gap-4 py-2 border-b border-white/5 last:border-0">
      <span className="text-neutral-500 w-20 shrink-0">{time}</span>
      <span className={`w-12 font-bold shrink-0 ${
        level === "info" ? "text-blue-400" :
        level === "warn" ? "text-yellow-400" :
        level === "error" ? "text-red-400" : "text-neutral-400"
      }`}>{level.toUpperCase()}</span>
      <span className="text-neutral-300 flex-1 truncate">{event}</span>
      {id && <span className="text-neutral-600 w-20 shrink-0 truncate text-right">{id.slice(0, 8)}</span>}
    </div>
  );
}
