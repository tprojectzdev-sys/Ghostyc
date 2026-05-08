import { useState } from "react";
import { Camera, Download, RefreshCw, Monitor, ImageIcon, Loader2, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/core/Card";
import { Button } from "../components/core/Button";
import { api } from "../../api/client";
import { useWsEvent } from "../../api/ws";

interface CaptureState {
  loading: boolean;
  imageData: string | null;
  capturedAt: string | null;
  error: string | null;
  requestId: string | null;
}

export function Screenshots() {
  const [capture, setCapture] = useState<CaptureState>({
    loading: false,
    imageData: null,
    capturedAt: null,
    error: null,
    requestId: null,
  });

  useWsEvent("command.result", (env) => {
    if (!capture.requestId || env.request_id !== capture.requestId) return;
    const data = env.data as {
      state: string;
      result?: { image_base64?: string };
      error?: { code: string; message: string };
    };
    if (data.state === "success" && data.result?.image_base64) {
      setCapture((c) => ({
        ...c,
        loading: false,
        imageData: data.result!.image_base64!,
        capturedAt: new Date().toISOString(),
        error: null,
      }));
    } else {
      setCapture((c) => ({
        ...c,
        loading: false,
        error: data.error?.message ?? `Command ${data.state}`,
      }));
    }
  });

  async function requestCapture() {
    setCapture((c) => ({ ...c, loading: true, error: null }));
    try {
      const res = await api.postCommand("agent", "screenshot", { max_dimension: 1920, quality: 80 }, 15000);
      setCapture((c) => ({ ...c, requestId: res.request_id }));
      let retries = 0;
      const poll = async () => {
        try {
          const cmd = await api.getCommand(res.request_id);
          if (cmd.state === "success" && cmd.result) {
            const r = cmd.result as { image_base64?: string };
            if (r.image_base64) {
              setCapture((c) => ({
                ...c,
                loading: false,
                imageData: r.image_base64!,
                capturedAt: new Date().toISOString(),
                error: null,
              }));
              return;
            }
          }
          if (cmd.state === "failed" || cmd.state === "timeout") {
            setCapture((c) => ({
              ...c,
              loading: false,
              error: cmd.error?.message ?? `Command ${cmd.state}`,
            }));
            return;
          }
        } catch {
          // retry
        }
        if (retries < 30) {
          retries++;
          setTimeout(poll, 500);
        } else {
          setCapture((c) => ({ ...c, loading: false, error: "Timed out waiting for screenshot" }));
        }
      };
      setTimeout(poll, 1000);
    } catch (err) {
      setCapture((c) => ({ ...c, loading: false, error: String(err) }));
    }
  }

  function downloadImage() {
    if (!capture.imageData) return;
    const byteCharacters = atob(capture.imageData);
    const bytes = new Uint8Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) bytes[i] = byteCharacters.charCodeAt(i);
    const blob = new Blob([bytes], { type: "image/jpeg" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ghostyc-screenshot-${new Date().toISOString().slice(0, 19)}.jpg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white mb-1">Display Capture</h1>
          <p className="text-neutral-400 text-sm">Request and view remote display screenshots.</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="flex gap-2" onClick={requestCapture} disabled={capture.loading}>
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
          <Button className="flex gap-2" onClick={requestCapture} disabled={capture.loading}>
            {capture.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
            Capture Display
          </Button>
        </div>
      </div>

      <Card className="flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle><Monitor className="w-5 h-5 text-neutral-400" /> Latest Capture</CardTitle>
            <CardDescription>
              {capture.capturedAt
                ? `Captured ${new Date(capture.capturedAt).toLocaleString()}`
                : "No capture yet"}
            </CardDescription>
          </div>
          {capture.imageData && (
            <Button variant="ghost" size="icon" onClick={downloadImage}><Download className="w-4 h-4" /></Button>
          )}
        </CardHeader>
        <CardContent className="flex-1 flex flex-col items-center justify-center min-h-[400px] p-0 relative group">
          {capture.loading && (
            <div className="absolute inset-0 m-6 rounded-xl border border-dashed border-white/10 bg-black/40 flex flex-col items-center justify-center text-neutral-500 space-y-4">
              <Loader2 className="w-12 h-12 animate-spin opacity-20" />
              <p className="text-sm font-medium text-neutral-400">Capturing display...</p>
            </div>
          )}
          {!capture.loading && capture.error && (
            <div className="absolute inset-0 m-6 rounded-xl border border-dashed border-white/10 bg-black/40 flex flex-col items-center justify-center text-neutral-500 space-y-4">
              <AlertTriangle className="w-12 h-12 opacity-20" />
              <div className="text-center px-8">
                <p className="text-sm font-medium text-neutral-400">Capture failed</p>
                <p className="text-xs mt-2 text-neutral-500 max-w-md">{capture.error}</p>
              </div>
            </div>
          )}
          {!capture.loading && !capture.error && capture.imageData && (
            <img
              src={`data:image/jpeg;base64,${capture.imageData}`}
              alt="Remote display screenshot"
              className="w-full h-auto rounded-lg"
            />
          )}
          {!capture.loading && !capture.error && !capture.imageData && (
            <div className="absolute inset-0 m-6 rounded-xl border border-dashed border-white/10 bg-black/40 flex flex-col items-center justify-center text-neutral-500 space-y-4">
              <ImageIcon className="w-12 h-12 opacity-20" />
              <div className="text-center">
                <p className="text-sm font-medium text-neutral-400">No recent capture available</p>
                <p className="text-xs mt-1 max-w-sm mx-auto">Click 'Capture Display' to request a new screenshot from the remote agent.</p>
              </div>
              <Button variant="outline" size="sm" className="mt-4" onClick={requestCapture}><Camera className="w-4 h-4 mr-2" /> Request Capture</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
