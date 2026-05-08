import { useState } from "react";
import { Globe, AppWindow, Send, Loader2, CheckCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/core/Card";
import { Button } from "../components/core/Button";
import { Input } from "../components/core/Input";
import { api } from "../../api/client";
import { useWsEvent } from "../../api/ws";

interface CommandResult {
  request_id: string;
  state: string;
  result?: unknown;
  error?: { code: string; message: string } | null;
}

export function Control() {
  const [appName, setAppName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [appPath, setAppPath] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<CommandResult | null>(null);

  useWsEvent("command.result", (env) => {
    const data = env.data as { state: string; result?: unknown; error?: { code: string; message: string } | null };
    if (env.request_id) {
      setLastResult({
        request_id: env.request_id,
        state: data.state,
        result: data.result,
        error: data.error,
      });
      setSending(null);
    }
  });

  async function sendOpenApp() {
    if (!appName.trim()) return;
    setSending("open_app");
    setLastResult(null);
    try {
      const res = await api.postCommand("agent", "open_app", { name: appName.trim() });
      setLastResult({ request_id: res.request_id, state: "accepted" });
      setAppName("");
    } catch (err) {
      setLastResult({ request_id: "", state: "failed", error: { code: "send_failed", message: String(err) } });
      setSending(null);
    }
  }

  async function sendOpenAppByPath() {
    if (!appPath.trim()) return;
    setSending("open_app_path");
    setLastResult(null);
    try {
      const res = await api.postCommand("agent", "open_app", { path: appPath.trim() });
      setLastResult({ request_id: res.request_id, state: "accepted" });
      setAppPath("");
    } catch (err) {
      setLastResult({ request_id: "", state: "failed", error: { code: "send_failed", message: String(err) } });
      setSending(null);
    }
  }

  async function sendOpenWebsite() {
    if (!websiteUrl.trim()) return;
    setSending("open_website");
    setLastResult(null);
    try {
      const res = await api.postCommand("agent", "open_website", { url: websiteUrl.trim() });
      setLastResult({ request_id: res.request_id, state: "accepted" });
      setWebsiteUrl("");
    } catch (err) {
      setLastResult({ request_id: "", state: "failed", error: { code: "send_failed", message: String(err) } });
      setSending(null);
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white mb-1">Control Panel</h1>
        <p className="text-neutral-400 text-sm">Execute remote actions and commands.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle><AppWindow className="w-5 h-5 text-neutral-400" /> Launch App</CardTitle>
            <CardDescription>Start applications by name.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs text-neutral-400 uppercase tracking-wider">App Name</label>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. spotify, discord, calc"
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendOpenApp()}
                />
                <Button size="icon" onClick={sendOpenApp} disabled={!appName.trim() || sending === "open_app"}>
                  {sending === "open_app" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle><Globe className="w-5 h-5 text-neutral-400" /> Open Website</CardTitle>
            <CardDescription>Open a URL in the default browser.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs text-neutral-400 uppercase tracking-wider">URL</label>
              <div className="flex gap-2">
                <Input
                  placeholder="https://..."
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendOpenWebsite()}
                />
                <Button size="icon" onClick={sendOpenWebsite} disabled={!websiteUrl.trim() || sending === "open_website"}>
                  {sending === "open_website" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-1 md:col-span-2">
          <CardHeader>
            <CardTitle><AppWindow className="w-5 h-5 text-neutral-400" /> Launch by Path</CardTitle>
            <CardDescription>Open an executable by its full file path.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <Input
                placeholder="C:\Program Files\App\app.exe"
                className="font-mono"
                value={appPath}
                onChange={(e) => setAppPath(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendOpenAppByPath()}
              />
              <Button className="w-32 flex gap-2" onClick={sendOpenAppByPath} disabled={!appPath.trim() || sending === "open_app_path"}>
                {sending === "open_app_path" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Launch
              </Button>
            </div>
            {lastResult && (
              <div className="bg-black/50 border border-white/5 rounded-lg p-4 font-mono text-xs">
                <div className="flex justify-between items-center mb-2">
                  <span className="flex items-center gap-2">
                    {lastResult.state === "success" && <CheckCircle className="w-3 h-3 text-white" />}
                    {lastResult.state === "failed" && <XCircle className="w-3 h-3 text-neutral-500" />}
                    <span className="text-neutral-300">{lastResult.state}</span>
                  </span>
                  <span className="text-neutral-500">
                    {lastResult.request_id ? `Req: ${lastResult.request_id.slice(0, 8)}` : ""}
                  </span>
                </div>
                {lastResult.error && (
                  <div className="text-neutral-400">{lastResult.error.code}: {lastResult.error.message}</div>
                )}
                {lastResult.result != null && (
                  <div className="text-neutral-400">{JSON.stringify(lastResult.result, null, 2)}</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
