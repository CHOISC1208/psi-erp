import { AxiosError } from "axios";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  fetchMe,
  login as loginRequest,
  logout as logoutRequest,
  LoginPayload,
  UserProfile,
} from "../lib/auth";

interface AuthContextValue {
  user: UserProfile | null;
  isLoading: boolean;
  error: string | null;
  login: (payload: LoginPayload) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function normalizeError(error: unknown): string {
  if (error instanceof AxiosError) {
    return (
      (error.response?.data as { detail?: string } | undefined)?.detail ??
      error.message
    );
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "An unknown error occurred";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const profile = await fetchMe();
        if (!cancelled) {
          setUser(profile);
        }
      } catch (err) {
        if (!cancelled) {
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const profile = await fetchMe();
      setUser(profile);
      setError(null);
    } catch (err) {
      const message = normalizeError(err);
      setUser(null);
      setError(message);
      throw new Error(message);
    }
  }, []);

  const login = useCallback(async (payload: LoginPayload) => {
    setError(null);
    try {
      await loginRequest(payload);
      await refresh();
    } catch (err) {
      const message = normalizeError(err);
      setError(message);
      throw new Error(message);
    }
  }, [refresh]);

  const logout = useCallback(async () => {
    await logoutRequest();
    setUser(null);
    setError(null);
  }, []);

  const value = useMemo(
    () => ({ user, isLoading, error, login, logout, refresh }),
    [user, isLoading, error, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
