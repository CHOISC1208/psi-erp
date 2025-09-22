import { FormEvent, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../hooks/useAuth";
import "../styles/forms.css";

interface LocationState {
  from?: string;
}

export default function LoginPage() {
  const { login, error, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const fromState = (location.state as LocationState | undefined)?.from;
  const redirectTo = fromState && !fromState.startsWith("/login") ? fromState : "/sessions";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setLocalError(null);
    try {
      await login({ username, password });
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setLocalError((err as Error).message ?? "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  const message = localError ?? error;

  return (
    <div className="login-page">
      <form className="login-form" onSubmit={handleSubmit}>
        <h1>PSI ERP Login</h1>
        <label htmlFor="username">
          Username
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </label>
        <label htmlFor="password">
          Password
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {message ? <p className="form-error" role="alert">{message}</p> : null}
        <button type="submit" disabled={submitting || isLoading}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
