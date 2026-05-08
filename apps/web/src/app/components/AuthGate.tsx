import { Navigate, Outlet } from "react-router";
import { useAuth } from "../../api/auth";
import { WsProvider } from "../../api/ws";

export function AuthGate() {
  const { authenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-neutral-500 animate-pulse">Loading...</div>
      </div>
    );
  }

  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <WsProvider>
      <Outlet />
    </WsProvider>
  );
}
