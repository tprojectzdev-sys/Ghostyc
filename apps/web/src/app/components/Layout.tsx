import { NavLink, Outlet } from "react-router";
import { Ghost, Home, Sliders, Terminal, Activity, Image as ImageIcon, FileText, CheckCircle, Settings, LogOut, Wifi, WifiOff } from "lucide-react";
import { useAuth } from "../../api/auth";
import { useWs } from "../../api/ws";

export function Layout() {
  const { logout } = useAuth();
  const { connected } = useWs();

  return (
    <div className="min-h-screen bg-black text-white selection:bg-white/20 font-sans relative overflow-x-hidden">
      {/* Background Elements */}
      <div className="fixed inset-0 pointer-events-none z-0 flex items-center justify-center">
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[80vw] h-[40vh] bg-white/[0.03] blur-[120px] rounded-[100%]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:16px_16px]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff0a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0a_1px,transparent_1px)] bg-[size:64px_64px]" />
        <svg className="absolute inset-0 w-full h-full opacity-[0.15]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="dots" x="0" y="0" width="64" height="64" patternUnits="userSpaceOnUse">
              <circle cx="0" cy="0" r="1.5" fill="#ffffff" opacity="0.6" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dots)" />
          <path d="M0,0 L64,64 M64,0 L0,64 M128,64 L64,128 M192,0 L128,64 M256,128 L192,192 M320,64 L256,128" stroke="#ffffff" strokeWidth="0.5" fill="none" opacity="0.3" strokeDasharray="4 4" />
          <path d="M0,128 L64,64 L128,128 L192,64 L256,128" stroke="#ffffff" strokeWidth="0.5" fill="none" opacity="0.2" />
        </svg>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,#000000_100%)] opacity-80" />
      </div>

      {/* Main Content */}
      <div className="relative z-10 flex flex-col min-h-screen">
        <header className="sticky top-0 z-50 pt-6 pb-4 px-4 flex justify-center">
          <nav className="flex items-center gap-1 p-1 bg-neutral-900/40 backdrop-blur-md border border-white/10 rounded-full shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_4px_24px_rgba(0,0,0,0.4)]">
            <div className="flex items-center gap-2 px-4 pr-6 py-2 border-r border-white/10">
              <Ghost className="w-5 h-5 text-white/80" />
              <span className="font-semibold text-sm tracking-wide">Ghostyc</span>
              {connected
                ? <Wifi className="w-3 h-3 text-white/60" />
                : <WifiOff className="w-3 h-3 text-neutral-600" />}
            </div>

            <div className="flex items-center px-2 gap-1 overflow-x-auto no-scrollbar">
              <NavItem to="/" icon={<Home className="w-4 h-4" />} label="Home" />
              <NavItem to="/control" icon={<Sliders className="w-4 h-4" />} label="Control" />
              <NavItem to="/commands" icon={<Terminal className="w-4 h-4" />} label="Commands" />
              <NavItem to="/processes" icon={<Activity className="w-4 h-4" />} label="Processes" />
              <NavItem to="/screenshots" icon={<ImageIcon className="w-4 h-4" />} label="Screenshots" />
              <NavItem to="/logs" icon={<FileText className="w-4 h-4" />} label="Logs" />
              <NavItem to="/diagnostics" icon={<CheckCircle className="w-4 h-4" />} label="Diagnostics" />
              <NavItem to="/settings" icon={<Settings className="w-4 h-4" />} label="Settings" />
            </div>

            <div className="pl-2 border-l border-white/10">
              <button
                onClick={logout}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium text-neutral-400 hover:text-white hover:bg-white/5 border border-transparent transition-all duration-200"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </nav>
        </header>

        <main className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
          isActive
            ? "bg-white/10 text-white shadow-[0_0_10px_rgba(255,255,255,0.1)] border border-white/10"
            : "text-neutral-400 hover:text-white hover:bg-white/5 border border-transparent"
        }`
      }
    >
      {icon}
      <span className="hidden md:inline">{label}</span>
    </NavLink>
  );
}
