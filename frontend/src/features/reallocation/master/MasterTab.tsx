import { FormEvent, useEffect, useMemo, useState } from "react";
import axios from "axios";

import { useAuth } from "../../../hooks/useAuth";
import {
  useReallocationPolicyQuery,
  useUpdateReallocationPolicyMutation,
} from "../../../hooks/useReallocationPolicy";

const ROUNDING_OPTIONS: Array<"floor" | "round" | "ceil"> = ["floor", "round", "ceil"];

type StatusMessage = { type: "success" | "error"; text: string } | null;

type FormState = {
  take_from_other_main: boolean;
  rounding_mode: "floor" | "round" | "ceil";
  allow_overfill: boolean;
  updated_by: string;
};

const DEFAULT_FORM: FormState = {
  take_from_other_main: false,
  rounding_mode: "floor",
  allow_overfill: false,
  updated_by: "",
};

const getErrorMessage = (error: unknown) => {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail;
    if (detail) {
      return detail;
    }
    if (error.message) {
      return error.message;
    }
  } else if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Failed to save policy";
};

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export default function MasterTab() {
  const { user } = useAuth();
  const policyQuery = useReallocationPolicyQuery();
  const updateMutation = useUpdateReallocationPolicyMutation();
  const [formState, setFormState] = useState<FormState>(DEFAULT_FORM);
  const [savedState, setSavedState] = useState<FormState | null>(null);
  const [status, setStatus] = useState<StatusMessage>(null);

  const isAdmin = Boolean(user?.is_admin);

  useEffect(() => {
    if (!policyQuery.data) {
      return;
    }
    const nextState: FormState = {
      take_from_other_main: policyQuery.data.take_from_other_main,
      rounding_mode: policyQuery.data.rounding_mode,
      allow_overfill: policyQuery.data.allow_overfill,
      updated_by: policyQuery.data.updated_by ?? "",
    };
    setFormState(nextState);
    setSavedState(nextState);
  }, [policyQuery.data]);

  const isDirty = useMemo(() => {
    if (!savedState) {
      return false;
    }
    return (
      savedState.take_from_other_main !== formState.take_from_other_main ||
      savedState.rounding_mode !== formState.rounding_mode ||
      savedState.allow_overfill !== formState.allow_overfill ||
      (savedState.updated_by ?? "").trim() !== formState.updated_by.trim()
    );
  }, [formState, savedState]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isAdmin) {
      return;
    }
    setStatus(null);
    try {
      const payload = {
        take_from_other_main: formState.take_from_other_main,
        rounding_mode: formState.rounding_mode,
        allow_overfill: formState.allow_overfill,
        updated_by: formState.updated_by.trim() || undefined,
      };
      const data = await updateMutation.mutateAsync(payload);
      const nextSaved: FormState = {
        take_from_other_main: data.take_from_other_main,
        rounding_mode: data.rounding_mode,
        allow_overfill: data.allow_overfill,
        updated_by: data.updated_by ?? "",
      };
      setSavedState(nextSaved);
      setFormState((prev) => ({ ...prev, updated_by: nextSaved.updated_by }));
      setStatus({ type: "success", text: "Policy saved successfully" });
    } catch (error) {
      setStatus({ type: "error", text: getErrorMessage(error) });
    }
  };

  const loading = policyQuery.isLoading;
  const loadError = policyQuery.isError;
  const lastUpdatedAt = policyQuery.data?.updated_at ?? null;
  const lastUpdatedBy = policyQuery.data?.updated_by ?? null;

  return (
    <section className="reallocation-master">
      <h2>Reallocation Policy (Master)</h2>
      {loading && <p>Loading policy…</p>}
      {loadError && !loading && (
        <p className="error-text">Failed to load policy. Please try again later.</p>
      )}
      {!loading && !loadError && (
        <form className="master-policy-form" onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={formState.take_from_other_main}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    take_from_other_main: event.target.checked,
                  }))
                }
                disabled={!isAdmin || updateMutation.isPending}
              />
              <span>Allow taking stock from other warehouses&apos; main channels</span>
            </label>
            <p className="field-hint">
              When enabled, other warehouses&apos; main channels may act as donors after non-main
              sources are exhausted.
            </p>
          </div>

          <div className="form-field">
            <label htmlFor="rounding-mode">Rounding mode</label>
            <select
              id="rounding-mode"
              value={formState.rounding_mode}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  rounding_mode: event.target.value as FormState["rounding_mode"],
                }))
              }
              disabled={!isAdmin || updateMutation.isPending}
            >
              {ROUNDING_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <p className="field-hint">
              Controls how fractional transfer quantities are converted to integers.
            </p>
          </div>

          <div className="form-field">
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={formState.allow_overfill}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    allow_overfill: event.target.checked,
                  }))
                }
                disabled={!isAdmin || updateMutation.isPending}
              />
              <span>Allow filling beyond STD stock</span>
            </label>
            <p className="field-hint">
              Disable to cap moves when the receiving channel would exceed its STD stock.
            </p>
          </div>

          <div className="form-field">
            <label htmlFor="updated-by">Updated by (optional)</label>
            <input
              id="updated-by"
              type="text"
              value={formState.updated_by}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, updated_by: event.target.value }))
              }
              disabled={!isAdmin || updateMutation.isPending}
            />
          </div>

          <div className="form-footer">
            <div className="last-updated">
              <span>
                Last updated: <strong>{formatDate(lastUpdatedAt)}</strong>
              </span>
              <span>
                Updated by: <strong>{lastUpdatedBy?.trim() || "—"}</strong>
              </span>
            </div>
            <div className="form-actions">
              {!isAdmin && (
                <span className="field-hint">Only administrators can update the policy.</span>
              )}
              <button
                type="submit"
                disabled={!isAdmin || !isDirty || updateMutation.isPending}
              >
                {updateMutation.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          {status && <p className={`status-message ${status.type}`}>{status.text}</p>}
        </form>
      )}
    </section>
  );
}
