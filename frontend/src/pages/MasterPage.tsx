import { FormEvent, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import api from "../lib/api";
import type { PSIMetricDefinition } from "../types";

type StatusMessage = { type: "success" | "error"; text: string };

interface MetricFormState {
  name: string;
  is_editable: boolean;
  display_order: string;
}

const getErrorMessage = (error: unknown, fallback: string) => {
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

  return fallback;
};

const fetchMetrics = async (): Promise<PSIMetricDefinition[]> => {
  const { data } = await api.get<PSIMetricDefinition[]>("/psi-metrics/");
  return data;
};

const createMetric = async (payload: PSIMetricDefinition): Promise<PSIMetricDefinition> => {
  const { data } = await api.post<PSIMetricDefinition>("/psi-metrics/", payload);
  return data;
};

const updateMetric = async (
  metricName: string,
  payload: Partial<PSIMetricDefinition>,
): Promise<PSIMetricDefinition> => {
  const { data } = await api.put<PSIMetricDefinition>(`/psi-metrics/${encodeURIComponent(metricName)}`, payload);
  return data;
};

const deleteMetric = async (metricName: string): Promise<void> => {
  await api.delete(`/psi-metrics/${encodeURIComponent(metricName)}`);
};

export default function MasterPage() {
  const { masterId } = useParams();
  const isMetricsRoute = !masterId || masterId === "psi-metrics";

  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [formState, setFormState] = useState<MetricFormState>({
    name: "",
    is_editable: false,
    display_order: "1",
  });
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editState, setEditState] = useState<MetricFormState>({
    name: "",
    is_editable: false,
    display_order: "1",
  });

  const metricsQuery = useQuery({
    queryKey: ["psi-metrics"],
    queryFn: fetchMetrics,
  });

  const metrics = metricsQuery.data ?? [];
  const nextDisplayOrder = useMemo(() => {
    if (!metrics.length) {
      return "1";
    }
    const maxOrder = metrics.reduce((max, metric) => Math.max(max, metric.display_order), 0);
    return String(maxOrder + 1);
  }, [metrics]);

  useEffect(() => {
    setFormState((previous) => {
      if (previous.name || previous.display_order !== "1") {
        return previous;
      }
      return { ...previous, display_order: nextDisplayOrder };
    });
  }, [nextDisplayOrder]);

  const createMetricMutation = useMutation({
    mutationFn: (payload: PSIMetricDefinition) => createMetric(payload),
    onMutate: () => {
      setStatus(null);
    },
    onSuccess: () => {
      setStatus({ type: "success", text: "Metric created." });
      queryClient.invalidateQueries({ queryKey: ["psi-metrics"] });
      setFormState({ name: "", is_editable: false, display_order: String(Number(nextDisplayOrder) + 1) });
    },
    onError: (error) => {
      setStatus({
        type: "error",
        text: getErrorMessage(error, "Unable to create metric. Try again."),
      });
    },
  });

  const updateMetricMutation = useMutation({
    mutationFn: ({ metricName, payload }: { metricName: string; payload: Partial<PSIMetricDefinition> }) =>
      updateMetric(metricName, payload),
    onMutate: () => {
      setStatus(null);
    },
    onSuccess: () => {
      setStatus({ type: "success", text: "Metric updated." });
      queryClient.invalidateQueries({ queryKey: ["psi-metrics"] });
      setEditingName(null);
      setEditState({ name: "", is_editable: false, display_order: "1" });
    },
    onError: (error) => {
      setStatus({
        type: "error",
        text: getErrorMessage(error, "Unable to update metric. Try again."),
      });
    },
  });

  const deleteMetricMutation = useMutation({
    mutationFn: deleteMetric,
    onMutate: () => {
      setStatus(null);
    },
    onSuccess: () => {
      setStatus({ type: "success", text: "Metric deleted." });
      queryClient.invalidateQueries({ queryKey: ["psi-metrics"] });
    },
    onError: (error) => {
      setStatus({
        type: "error",
        text: getErrorMessage(error, "Unable to delete metric. Try again."),
      });
    },
  });

  if (!isMetricsRoute) {
    return (
      <div className="page">
        <header>
          <h1>Masters</h1>
          <p>This master does not have a dedicated management screen yet.</p>
        </header>
      </div>
    );
  }

  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = formState.name.trim();
    const order = Number.parseInt(formState.display_order, 10);

    if (!name) {
      setStatus({ type: "error", text: "Metric name is required." });
      return;
    }

    if (Number.isNaN(order) || order < 0) {
      setStatus({ type: "error", text: "Display order must be zero or a positive number." });
      return;
    }

    createMetricMutation.mutate({
      name,
      is_editable: formState.is_editable,
      display_order: order,
    });
  };

  const startEditing = (metric: PSIMetricDefinition) => {
    setStatus(null);
    setEditingName(metric.name);
    setEditState({
      name: metric.name,
      is_editable: metric.is_editable,
      display_order: String(metric.display_order),
    });
  };

  const handleEditCancel = () => {
    setEditingName(null);
    setEditState({ name: "", is_editable: false, display_order: "1" });
  };

  const handleEditSave = () => {
    if (!editingName) {
      return;
    }

    const trimmedName = editState.name.trim();
    const order = Number.parseInt(editState.display_order, 10);
    const original = metrics.find((metric) => metric.name === editingName);

    if (!original) {
      setStatus({ type: "error", text: "Original metric no longer exists." });
      return;
    }

    if (!trimmedName) {
      setStatus({ type: "error", text: "Metric name is required." });
      return;
    }

    if (Number.isNaN(order) || order < 0) {
      setStatus({ type: "error", text: "Display order must be zero or a positive number." });
      return;
    }

    const payload: Partial<PSIMetricDefinition> = {};

    if (trimmedName !== original.name) {
      payload.name = trimmedName;
    }
    if (editState.is_editable !== original.is_editable) {
      payload.is_editable = editState.is_editable;
    }
    if (order !== original.display_order) {
      payload.display_order = order;
    }

    if (Object.keys(payload).length === 0) {
      setStatus({ type: "error", text: "No changes to apply." });
      return;
    }

    updateMetricMutation.mutate({ metricName: editingName, payload });
  };

  const handleDelete = (metricName: string) => {
    if (!window.confirm(`Delete metric "${metricName}"?`)) {
      return;
    }
    deleteMetricMutation.mutate(metricName);
  };

  return (
    <div className="page master-page">
      <header>
        <h1>PSI Metrics Master</h1>
        <p>Manage the metrics shown on the PSI table, their order, and whether they are editable.</p>
      </header>

      {status ? <div className={`status-message ${status.type}`}>{status.text}</div> : null}

      <section>
        <h2>Add Metric</h2>
        <form onSubmit={handleCreate} className="form-grid">
          <label>
            Metric Name
            <input
              type="text"
              value={formState.name}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, name: event.target.value }))
              }
              required
            />
            <small>Unique identifier used to reference the metric.</small>
          </label>
          <label className="checkbox-field">
            <span>Editable</span>
            <input
              type="checkbox"
              checked={formState.is_editable}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, is_editable: event.target.checked }))
              }
            />
            <small>Allow manual adjustments for this metric in the PSI table.</small>
          </label>
          <label>
            Display Order
            <input
              type="number"
              min={0}
              value={formState.display_order}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, display_order: event.target.value }))
              }
              required
            />
            <small>Lower numbers appear first in the PSI table.</small>
          </label>
          <button type="submit" disabled={createMetricMutation.isPending}>
            {createMetricMutation.isPending ? "Saving..." : "Add"}
          </button>
        </form>
      </section>

      <section>
        <h2>Existing Metrics</h2>
        {metricsQuery.isLoading && !metrics.length ? <p>Loading metrics…</p> : null}
        {metricsQuery.error ? (
          <p className="error-text">Failed to load metrics. Please try again.</p>
        ) : null}
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Editable</th>
                <th>Display Order</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric) => {
                const isEditing = editingName === metric.name;
                return (
                  <tr key={metric.name}>
                    <td>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editState.name}
                          onChange={(event) =>
                            setEditState((previous) => ({ ...previous, name: event.target.value }))
                          }
                        />
                      ) : (
                        metric.name
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          type="checkbox"
                          checked={editState.is_editable}
                          onChange={(event) =>
                            setEditState((previous) => ({
                              ...previous,
                              is_editable: event.target.checked,
                            }))
                          }
                        />
                      ) : metric.is_editable ? (
                        "Yes"
                      ) : (
                        "No"
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          type="number"
                          min={0}
                          value={editState.display_order}
                          onChange={(event) =>
                            setEditState((previous) => ({
                              ...previous,
                              display_order: event.target.value,
                            }))
                          }
                        />
                      ) : (
                        metric.display_order
                      )}
                    </td>
                    <td className="actions">
                      {isEditing ? (
                        <div className="action-buttons">
                          <button
                            type="button"
                            onClick={handleEditSave}
                            disabled={updateMetricMutation.isPending}
                          >
                            {updateMetricMutation.isPending ? "Saving..." : "Apply"}
                          </button>
                          <button type="button" onClick={handleEditCancel} disabled={updateMetricMutation.isPending}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="action-buttons">
                          <button type="button" onClick={() => startEditing(metric)}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => handleDelete(metric.name)}
                            disabled={deleteMetricMutation.isPending}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {metrics.length === 0 ? (
                <tr>
                  <td colSpan={4}>No metrics defined yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
