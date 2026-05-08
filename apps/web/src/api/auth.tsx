import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { api, ApiError } from "./client";

interface AuthState {
  authenticated: boolean;
  loading: boolean;
  login: (password: string) => Promise<void>;
  logout: () => void;
  error: string | null;
}

const AuthContext = createContext<AuthState>({
  authenticated: false,
  loading: true,
  login: async () => {},
  logout: () => {},
  error: null,
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("ghostyc_token");
    if (!token) {
      setLoading(false);
      return;
    }
    api.whoami()
      .then(() => {
        setAuthenticated(true);
        setLoading(false);
      })
      .catch(() => {
        localStorage.removeItem("ghostyc_token");
        setLoading(false);
      });
  }, []);

  const login = useCallback(async (password: string) => {
    setError(null);
    try {
      const res = await api.login(password);
      localStorage.setItem("ghostyc_token", res.token);
      setAuthenticated(true);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Connection failed";
      setError(msg);
      throw err;
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("ghostyc_token");
    setAuthenticated(false);
  }, []);

  return (
    <AuthContext.Provider value={{ authenticated, loading, login, logout, error }}>
      {children}
    </AuthContext.Provider>
  );
}
