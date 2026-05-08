import { useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { Ghost, Loader2 } from "lucide-react";
import { ApiError } from "../../api/client";
import { useAuth } from "../../api/auth";
import { Button } from "../components/core/Button";
import { Input } from "../components/core/Input";

export function Login() {
  const { authenticated, login, error: authError } = useAuth();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (authenticated) {
    return <Navigate to="/" replace />;
  }

  const error = localError || authError;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    setLocalError(null);
    try {
      await login(password);
    } catch (err) {
      if (err instanceof ApiError) {
        setLocalError(err.message);
      } else {
        setLocalError("Authentication failed.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center relative overflow-hidden">
      <div className="fixed inset-0 pointer-events-none z-0 flex items-center justify-center">
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[60vw] h-[30vh] bg-white/[0.02] blur-[100px] rounded-[100%]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:16px_16px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,#000000_100%)] opacity-80" />
      </div>

      <form onSubmit={handleSubmit} className="relative z-10 w-full max-w-sm p-8 space-y-6">
        <div className="flex flex-col items-center gap-3 mb-8">
          <Ghost className="w-10 h-10 text-white/60" />
          <h1 className="text-xl font-semibold tracking-tight text-white">Ghostyc</h1>
          <p className="text-sm text-neutral-500">Private PC control ecosystem</p>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-neutral-400 uppercase tracking-wider">Password</label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter admin password"
            autoFocus
            disabled={loading}
          />
        </div>

        {error && (
          <div className="text-xs text-neutral-400 bg-white/5 border border-white/10 rounded-lg p-3">
            {error}
          </div>
        )}

        <Button type="submit" disabled={loading || !password.trim()} className="w-full flex gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {loading ? "Authenticating..." : "Sign In"}
        </Button>
      </form>
    </div>
  );
}
