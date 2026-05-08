import { useEffect, useState } from "react";
import { Shield, Key, Server, Hash, Eye, EyeOff } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/core/Card";
import { Button } from "../components/core/Button";
import { Input } from "../components/core/Input";
import { useAuth } from "../../api/auth";
import { useWs } from "../../api/ws";
import { api, type DiagnosticsSnapshot } from "../../api/client";

export function Settings() {
  const { logout } = useAuth();
  const { connected, sessionId } = useWs();
  const [showToken, setShowToken] = useState(false);
  const [diag, setDiag] = useState<DiagnosticsSnapshot | null>(null);

  const token = localStorage.getItem("ghostyc_token") ?? "";
  const relayUrl = import.meta.env.VITE_RELAY_URL || window.location.origin;

  useEffect(() => {
    api.diagnostics().then(setDiag).catch(() => {});
  }, []);

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white mb-1">System Configuration</h1>
        <p className="text-neutral-400 text-sm">Private one-user ecosystem settings.</p>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex gap-4 items-start mb-8">
        <Shield className="w-5 h-5 text-neutral-400 shrink-0 mt-0.5" />
        <div>
          <h4 className="text-sm font-medium text-white mb-1">Security Model: Private Personal Use</h4>
          <p className="text-xs text-neutral-400 leading-relaxed">
            Ghostyc is designed strictly for a single user controlling their own personal hardware.
            There are no multi-user accounts, no OAuth, no roles, and no public signups.
            Authentication relies on private tokens and secrets managed via <code className="text-neutral-300 bg-black/30 px-1 py-0.5 rounded">.env</code> files on your infrastructure.
          </p>
        </div>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle><Key className="w-5 h-5 text-neutral-400" /> Authentication</CardTitle>
            <CardDescription>Current session and token info.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs text-neutral-400 uppercase tracking-wider">Client Token (debug)</label>
              <div className="relative">
                <Input
                  type={showToken ? "text" : "password"}
                  value={token}
                  readOnly
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-neutral-500 hover:text-white"
                  onClick={() => setShowToken(!showToken)}
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-[10px] text-neutral-500">
                This is the GHOSTYC_CLIENT_TOKEN retrieved during login. Stored in localStorage.
              </p>
            </div>
            <div className="pt-2 border-t border-white/5 flex justify-end">
              <Button variant="danger" size="sm" onClick={logout}>Sign Out</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle><Server className="w-5 h-5 text-neutral-400" /> Connection</CardTitle>
            <CardDescription>Relay and WebSocket status.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs text-neutral-400 uppercase tracking-wider">Relay URL</label>
                <Input value={relayUrl} readOnly />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-neutral-400 uppercase tracking-wider">WebSocket</label>
                <Input
                  value={connected ? `Connected (session: ${sessionId?.slice(0, 8) ?? "?"})` : "Disconnected"}
                  readOnly
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs text-neutral-400 uppercase tracking-wider">Protocol Version</label>
                <Input value={diag?.relay.protocol_version ?? "Loading..."} readOnly />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-neutral-400 uppercase tracking-wider">Relay Uptime</label>
                <Input value={diag ? formatUptime(diag.relay.uptime_s) : "Loading..."} readOnly />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle><Hash className="w-5 h-5 text-neutral-400" /> Devices</CardTitle>
            <CardDescription>Known devices in the ecosystem.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs text-neutral-400 uppercase tracking-wider">Windows Agent</label>
              <Input
                value={diag?.agent
                  ? `${diag.agent.device_id} — ${diag.agent.status} (v${diag.agent.version ?? "?"})`
                  : "Not seen"}
                readOnly
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-neutral-400 uppercase tracking-wider">WoL Bridge</label>
              <Input
                value={diag?.bridge
                  ? `${diag.bridge.device_id} — ${diag.bridge.status} (v${diag.bridge.version ?? "?"})`
                  : "Not connected (Phase 5)"}
                readOnly
                className="font-mono text-sm"
              />
            </div>
          </CardContent>
        </Card>
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
