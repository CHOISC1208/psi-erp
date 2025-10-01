import { FormEvent, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import { useAuth } from "../hooks/useAuth";
import api from "../lib/api";
import type {
  CategoryRankParameter,
  PSIMetricDefinition,
  UserAccount,
  WarehouseMaster,
} from "../types";

type StatusMessage = { type: "success" | "error"; text: string };

interface MetricFormState {
  name: string;
  is_editable: boolean;
  display_order: string;
}

interface WarehouseFormState {
  warehouse_name: string;
  region: string;
  main_channel: string;
}

interface RankParameterFormState {
  rank_type: string;
  category_1: string;
  category_2: string;
  threshold: string;
}

interface RankParameterKey {
  rank_type: string;
  category_1: string;
  category_2: string;
}

interface UserFormState {
  username: string;
  password: string;
  confirmPassword: string;
}

interface UserCreatePayload {
  username: string;
  password: string;
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
  const { data } = await api.put<PSIMetricDefinition>(
    `/psi-metrics/${encodeURIComponent(metricName)}`,
    payload,
  );
  return data;
};

const deleteMetric = async (metricName: string): Promise<void> => {
  await api.delete(`/psi-metrics/${encodeURIComponent(metricName)}`);
};

const fetchWarehouses = async (): Promise<WarehouseMaster[]> => {
  const { data } = await api.get<WarehouseMaster[]>("/warehouses/");
  return data;
};

const createWarehouse = async (payload: WarehouseMaster): Promise<WarehouseMaster> => {
  const { data } = await api.post<WarehouseMaster>("/warehouses/", payload);
  return data;
};

const updateWarehouse = async (
  warehouseName: string,
  payload: Partial<WarehouseMaster>,
): Promise<WarehouseMaster> => {
  const { data } = await api.put<WarehouseMaster>(
    `/warehouses/${encodeURIComponent(warehouseName)}`,
    payload,
  );
  return data;
};

const deleteWarehouse = async (warehouseName: string): Promise<void> => {
  await api.delete(`/warehouses/${encodeURIComponent(warehouseName)}`);
};

const fetchRankParameters = async (): Promise<CategoryRankParameter[]> => {
  const { data } = await api.get<CategoryRankParameter[]>("/category-rank-parameters/");
  return data;
};

const createRankParameter = async (
  payload: CategoryRankParameter,
): Promise<CategoryRankParameter> => {
  const { data } = await api.post<CategoryRankParameter>("/category-rank-parameters/", payload);
  return data;
};

const updateRankParameter = async (
  key: RankParameterKey,
  payload: Partial<CategoryRankParameter>,
): Promise<CategoryRankParameter> => {
  const { data } = await api.put<CategoryRankParameter>(
    `/category-rank-parameters/${encodeURIComponent(key.rank_type)}/${encodeURIComponent(key.category_1)}/${encodeURIComponent(key.category_2)}`,
    payload,
  );
  return data;
};

const deleteRankParameter = async (key: RankParameterKey): Promise<void> => {
  await api.delete(
    `/category-rank-parameters/${encodeURIComponent(key.rank_type)}/${encodeURIComponent(key.category_1)}/${encodeURIComponent(key.category_2)}`,
  );
};

const createUserAccount = async (payload: UserCreatePayload): Promise<UserAccount> => {
  const { data } = await api.post<UserAccount>("/users", payload);
  return data;
};

function PSIMetricsMaster() {
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

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!formState.name.trim()) {
      setStatus({ type: "error", text: "Name is required." });
      return;
    }

    const displayOrder = Number(formState.display_order);
    if (!Number.isInteger(displayOrder) || displayOrder < 0) {
      setStatus({ type: "error", text: "Display order must be zero or greater." });
      return;
    }

    createMetricMutation.mutate({
      name: formState.name.trim(),
      is_editable: formState.is_editable,
      display_order: displayOrder,
    });
  };

  const startEditing = (metric: PSIMetricDefinition) => {
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

    if (!editState.name.trim()) {
      setStatus({ type: "error", text: "Name is required." });
      return;
    }

    const displayOrder = Number(editState.display_order);
    if (!Number.isInteger(displayOrder) || displayOrder < 0) {
      setStatus({ type: "error", text: "Display order must be zero or greater." });
      return;
    }

    updateMetricMutation.mutate({
      metricName: editingName,
      payload: {
        name: editState.name.trim(),
        is_editable: editState.is_editable,
        display_order: displayOrder,
      },
    });
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
        <h1>Metrics</h1>
        <p>Define the PSI metrics shown in the planning table.</p>
      </header>

      {status ? <div className={`status-message ${status.type}`}>{status.text}</div> : null}

      <section>
        <h2>Add Metric</h2>
        <form onSubmit={handleSubmit} className="form-grid">
          <label>
            Name
            <input
              type="text"
              value={formState.name}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, name: event.target.value }))
              }
              required
            />
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
                          <button
                            type="button"
                            className="secondary"
                            onClick={handleEditCancel}
                            disabled={updateMetricMutation.isPending}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="action-buttons">
                          <button type="button" className="secondary" onClick={() => startEditing(metric)}>
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

function WarehouseMasterManager() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [formState, setFormState] = useState<WarehouseFormState>({
    warehouse_name: "",
    region: "",
    main_channel: "",
  });
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editState, setEditState] = useState<WarehouseFormState>({
    warehouse_name: "",
    region: "",
    main_channel: "",
  });

  const warehousesQuery = useQuery({
    queryKey: ["warehouses"],
    queryFn: fetchWarehouses,
  });

  const warehouses = warehousesQuery.data ?? [];

  const normalizePayload = (payload: WarehouseFormState): WarehouseMaster => ({
    warehouse_name: payload.warehouse_name.trim(),
    region: payload.region.trim() || null,
    main_channel: payload.main_channel.trim() || null,
  });

  const createWarehouseMutation = useMutation({
    mutationFn: (payload: WarehouseFormState) => createWarehouse(normalizePayload(payload)),
    onMutate: () => {
      setStatus(null);
    },
    onSuccess: () => {
      setStatus({ type: "success", text: "Warehouse created." });
      queryClient.invalidateQueries({ queryKey: ["warehouses"] });
      setFormState({ warehouse_name: "", region: "", main_channel: "" });
    },
    onError: (error) => {
      setStatus({
        type: "error",
        text: getErrorMessage(error, "Unable to create warehouse. Try again."),
      });
    },
  });

  const updateWarehouseMutation = useMutation({
    mutationFn: ({
      warehouseName,
      payload,
    }: {
      warehouseName: string;
      payload: WarehouseFormState;
    }) => updateWarehouse(warehouseName, normalizePayload(payload)),
    onMutate: () => {
      setStatus(null);
    },
    onSuccess: () => {
      setStatus({ type: "success", text: "Warehouse updated." });
      queryClient.invalidateQueries({ queryKey: ["warehouses"] });
      setEditingName(null);
      setEditState({ warehouse_name: "", region: "", main_channel: "" });
    },
    onError: (error) => {
      setStatus({
        type: "error",
        text: getErrorMessage(error, "Unable to update warehouse. Try again."),
      });
    },
  });

  const deleteWarehouseMutation = useMutation({
    mutationFn: deleteWarehouse,
    onMutate: () => {
      setStatus(null);
    },
    onSuccess: () => {
      setStatus({ type: "success", text: "Warehouse deleted." });
      queryClient.invalidateQueries({ queryKey: ["warehouses"] });
    },
    onError: (error) => {
      setStatus({
        type: "error",
        text: getErrorMessage(error, "Unable to delete warehouse. Try again."),
      });
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!formState.warehouse_name.trim()) {
      setStatus({ type: "error", text: "Warehouse name is required." });
      return;
    }

    createWarehouseMutation.mutate(formState);
  };

  const startEditing = (warehouse: WarehouseMaster) => {
    setEditingName(warehouse.warehouse_name);
    setEditState({
      warehouse_name: warehouse.warehouse_name,
      region: warehouse.region ?? "",
      main_channel: warehouse.main_channel ?? "",
    });
  };

  const handleEditCancel = () => {
    setEditingName(null);
    setEditState({ warehouse_name: "", region: "", main_channel: "" });
  };

  const handleEditSave = () => {
    if (!editingName) {
      return;
    }

    if (!editState.warehouse_name.trim()) {
      setStatus({ type: "error", text: "Warehouse name is required." });
      return;
    }

    updateWarehouseMutation.mutate({ warehouseName: editingName, payload: editState });
  };

  const handleDelete = (warehouseName: string) => {
    if (!window.confirm(`Delete warehouse "${warehouseName}"?`)) {
      return;
    }
    deleteWarehouseMutation.mutate(warehouseName);
  };

  return (
    <div className="page master-page">
      <header>
        <h1>Warehouse</h1>
        <p>Maintain the warehouse master including the main channel mapping.</p>
      </header>

      {status ? <div className={`status-message ${status.type}`}>{status.text}</div> : null}

      <section>
        <h2>Add Warehouse</h2>
        <form onSubmit={handleSubmit} className="form-grid">
          <label>
            Warehouse Name
            <input
              type="text"
              value={formState.warehouse_name}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, warehouse_name: event.target.value }))
              }
              required
            />
          </label>
          <label>
            Region
            <input
              type="text"
              value={formState.region}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, region: event.target.value }))
              }
            />
          </label>
          <label>
            Main Channel
            <input
              type="text"
              value={formState.main_channel}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, main_channel: event.target.value }))
              }
            />
            <small>Optional. Must exist in the channel master to satisfy the foreign key.</small>
          </label>
          <button type="submit" disabled={createWarehouseMutation.isPending}>
            {createWarehouseMutation.isPending ? "Saving..." : "Add"}
          </button>
        </form>
      </section>

      <section>
        <h2>Existing Warehouses</h2>
        {warehousesQuery.isLoading && !warehouses.length ? <p>Loading warehouses…</p> : null}
        {warehousesQuery.error ? (
          <p className="error-text">Failed to load warehouses. Please try again.</p>
        ) : null}
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Region</th>
                <th>Main Channel</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {warehouses.map((warehouse) => {
                const isEditing = editingName === warehouse.warehouse_name;
                return (
                  <tr key={warehouse.warehouse_name}>
                    <td>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editState.warehouse_name}
                          onChange={(event) =>
                            setEditState((previous) => ({
                              ...previous,
                              warehouse_name: event.target.value,
                            }))
                          }
                        />
                      ) : (
                        warehouse.warehouse_name
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editState.region}
                          onChange={(event) =>
                            setEditState((previous) => ({ ...previous, region: event.target.value }))
                          }
                        />
                      ) : (
                        warehouse.region ?? "—"
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editState.main_channel}
                          onChange={(event) =>
                            setEditState((previous) => ({
                              ...previous,
                              main_channel: event.target.value,
                            }))
                          }
                        />
                      ) : (
                        warehouse.main_channel ?? "—"
                      )}
                    </td>
                    <td className="actions">
                      {isEditing ? (
                        <div className="action-buttons">
                          <button
                            type="button"
                            onClick={handleEditSave}
                            disabled={updateWarehouseMutation.isPending}
                          >
                            {updateWarehouseMutation.isPending ? "Saving..." : "Apply"}
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={handleEditCancel}
                            disabled={updateWarehouseMutation.isPending}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="action-buttons">
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => startEditing(warehouse)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => handleDelete(warehouse.warehouse_name)}
                            disabled={deleteWarehouseMutation.isPending}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {warehouses.length === 0 ? (
                <tr>
                  <td colSpan={4}>No warehouses registered yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function RankParametersMaster() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [formState, setFormState] = useState<RankParameterFormState>({
    rank_type: "",
    category_1: "",
    category_2: "",
    threshold: "",
  });
  const [editingKey, setEditingKey] = useState<RankParameterKey | null>(null);
  const [editState, setEditState] = useState<RankParameterFormState>({
    rank_type: "",
    category_1: "",
    category_2: "",
    threshold: "",
  });

  const rankParametersQuery = useQuery({
    queryKey: ["category-rank-parameters"],
    queryFn: fetchRankParameters,
  });

  const rankParameters = rankParametersQuery.data ?? [];

  const normalizePayload = (payload: RankParameterFormState): CategoryRankParameter => ({
    rank_type: payload.rank_type.trim(),
    category_1: payload.category_1.trim(),
    category_2: payload.category_2.trim(),
    threshold: payload.threshold.trim(),
  });

  const validateForm = (payload: RankParameterFormState): string | null => {
    if (!payload.rank_type.trim()) {
      return "Rank type is required.";
    }
    if (!payload.category_1.trim()) {
      return "Category 1 is required.";
    }
    if (!payload.category_2.trim()) {
      return "Category 2 is required.";
    }
    if (!payload.threshold.trim()) {
      return "Threshold is required.";
    }
    const numeric = Number(payload.threshold);
    if (!Number.isFinite(numeric)) {
      return "Threshold must be a number.";
    }
    return null;
  };

  const createRankParameterMutation = useMutation({
    mutationFn: (payload: RankParameterFormState) =>
      createRankParameter(normalizePayload(payload)),
    onMutate: () => {
      setStatus(null);
    },
    onSuccess: () => {
      setStatus({ type: "success", text: "Rank parameter created." });
      queryClient.invalidateQueries({ queryKey: ["category-rank-parameters"] });
      setFormState({ rank_type: "", category_1: "", category_2: "", threshold: "" });
    },
    onError: (error) => {
      setStatus({
        type: "error",
        text: getErrorMessage(error, "Unable to create rank parameter. Try again."),
      });
    },
  });

  const updateRankParameterMutation = useMutation({
    mutationFn: ({
      key,
      payload,
    }: {
      key: RankParameterKey;
      payload: RankParameterFormState;
    }) => updateRankParameter(key, normalizePayload(payload)),
    onMutate: () => {
      setStatus(null);
    },
    onSuccess: () => {
      setStatus({ type: "success", text: "Rank parameter updated." });
      queryClient.invalidateQueries({ queryKey: ["category-rank-parameters"] });
      setEditingKey(null);
      setEditState({ rank_type: "", category_1: "", category_2: "", threshold: "" });
    },
    onError: (error) => {
      setStatus({
        type: "error",
        text: getErrorMessage(error, "Unable to update rank parameter. Try again."),
      });
    },
  });

  const deleteRankParameterMutation = useMutation({
    mutationFn: deleteRankParameter,
    onMutate: () => {
      setStatus(null);
    },
    onSuccess: () => {
      setStatus({ type: "success", text: "Rank parameter deleted." });
      queryClient.invalidateQueries({ queryKey: ["category-rank-parameters"] });
    },
    onError: (error) => {
      setStatus({
        type: "error",
        text: getErrorMessage(error, "Unable to delete rank parameter. Try again."),
      });
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationError = validateForm(formState);
    if (validationError) {
      setStatus({ type: "error", text: validationError });
      return;
    }

    createRankParameterMutation.mutate(formState);
  };

  const startEditing = (parameter: CategoryRankParameter) => {
    setEditingKey({
      rank_type: parameter.rank_type,
      category_1: parameter.category_1,
      category_2: parameter.category_2,
    });
    setEditState({
      rank_type: parameter.rank_type,
      category_1: parameter.category_1,
      category_2: parameter.category_2,
      threshold: parameter.threshold,
    });
  };

  const handleEditCancel = () => {
    setEditingKey(null);
    setEditState({ rank_type: "", category_1: "", category_2: "", threshold: "" });
  };

  const handleEditSave = () => {
    if (!editingKey) {
      return;
    }
    const validationError = validateForm(editState);
    if (validationError) {
      setStatus({ type: "error", text: validationError });
      return;
    }

    updateRankParameterMutation.mutate({ key: editingKey, payload: editState });
  };

  const handleDelete = (parameter: CategoryRankParameter) => {
    if (!window.confirm(`Delete rank parameter ${parameter.rank_type}/${parameter.category_1}/${parameter.category_2}?`)) {
      return;
    }
    deleteRankParameterMutation.mutate({
      rank_type: parameter.rank_type,
      category_1: parameter.category_1,
      category_2: parameter.category_2,
    });
  };

  return (
    <div className="page master-page">
      <header>
        <h1>Rank Parameters</h1>
        <p>Maintain FW/SS thresholds per category combination.</p>
      </header>

      {status ? <div className={`status-message ${status.type}`}>{status.text}</div> : null}

      <section>
        <h2>Add Rank Parameter</h2>
        <form onSubmit={handleSubmit} className="form-grid">
          <label>
            Rank Type
            <input
              type="text"
              value={formState.rank_type}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, rank_type: event.target.value }))
              }
              required
            />
          </label>
          <label>
            Category 1
            <input
              type="text"
              value={formState.category_1}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, category_1: event.target.value }))
              }
              required
            />
          </label>
          <label>
            Category 2
            <input
              type="text"
              value={formState.category_2}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, category_2: event.target.value }))
              }
              required
            />
          </label>
          <label>
            Threshold
            <input
              type="number"
              step="0.000001"
              value={formState.threshold}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, threshold: event.target.value }))
              }
              required
            />
            <small>Numeric value used by the ranking logic (supports 6 decimal places).</small>
          </label>
          <button type="submit" disabled={createRankParameterMutation.isPending}>
            {createRankParameterMutation.isPending ? "Saving..." : "Add"}
          </button>
        </form>
      </section>

      <section>
        <h2>Existing Rank Parameters</h2>
        {rankParametersQuery.isLoading && !rankParameters.length ? <p>Loading rank parameters…</p> : null}
        {rankParametersQuery.error ? (
          <p className="error-text">Failed to load rank parameters. Please try again.</p>
        ) : null}
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Rank Type</th>
                <th>Category 1</th>
                <th>Category 2</th>
                <th>Threshold</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rankParameters.map((parameter) => {
                const isEditing =
                  editingKey?.rank_type === parameter.rank_type &&
                  editingKey?.category_1 === parameter.category_1 &&
                  editingKey?.category_2 === parameter.category_2;
                return (
                  <tr
                    key={`${parameter.rank_type}__${parameter.category_1}__${parameter.category_2}`}
                  >
                    <td>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editState.rank_type}
                          onChange={(event) =>
                            setEditState((previous) => ({ ...previous, rank_type: event.target.value }))
                          }
                        />
                      ) : (
                        parameter.rank_type
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editState.category_1}
                          onChange={(event) =>
                            setEditState((previous) => ({
                              ...previous,
                              category_1: event.target.value,
                            }))
                          }
                        />
                      ) : (
                        parameter.category_1
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editState.category_2}
                          onChange={(event) =>
                            setEditState((previous) => ({
                              ...previous,
                              category_2: event.target.value,
                            }))
                          }
                        />
                      ) : (
                        parameter.category_2
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.000001"
                          value={editState.threshold}
                          onChange={(event) =>
                            setEditState((previous) => ({
                              ...previous,
                              threshold: event.target.value,
                            }))
                          }
                        />
                      ) : (
                        parameter.threshold
                      )}
                    </td>
                    <td className="actions">
                      {isEditing ? (
                        <div className="action-buttons">
                          <button
                            type="button"
                            onClick={handleEditSave}
                            disabled={updateRankParameterMutation.isPending}
                          >
                            {updateRankParameterMutation.isPending ? "Saving..." : "Apply"}
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={handleEditCancel}
                            disabled={updateRankParameterMutation.isPending}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="action-buttons">
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => startEditing(parameter)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => handleDelete(parameter)}
                            disabled={deleteRankParameterMutation.isPending}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rankParameters.length === 0 ? (
                <tr>
                  <td colSpan={5}>No rank parameters registered yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function UserRegistrationMaster({ isAdmin }: { isAdmin: boolean }) {
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [formState, setFormState] = useState<UserFormState>({
    username: "",
    password: "",
    confirmPassword: "",
  });

  const createUserMutation = useMutation({
    mutationFn: (payload: UserCreatePayload) => createUserAccount(payload),
    onMutate: () => {
      setStatus(null);
    },
    onSuccess: (user) => {
      setStatus({
        type: "success",
        text: `User "${user.username}" was created successfully.`,
      });
      setFormState({ username: "", password: "", confirmPassword: "" });
    },
    onError: (error) => {
      setStatus({
        type: "error",
        text: getErrorMessage(error, "Unable to create user. Try again."),
      });
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const username = formState.username.trim();

    if (!username) {
      setStatus({ type: "error", text: "Username is required." });
      return;
    }

    if (!formState.password) {
      setStatus({ type: "error", text: "Password is required." });
      return;
    }

    if (formState.password !== formState.confirmPassword) {
      setStatus({ type: "error", text: "Passwords do not match." });
      return;
    }

    createUserMutation.mutate({ username, password: formState.password });
  };

  return (
    <div className="page master-page">
      <header>
        <h1>User Accounts</h1>
        <p>Register new dashboard users. Only administrators can access this screen.</p>
      </header>

      {status ? <div className={`status-message ${status.type}`}>{status.text}</div> : null}

      {isAdmin ? (
        <section>
          <h2>Create User</h2>
          <form onSubmit={handleSubmit} className="form-grid">
            <label>
              Username
              <input
                type="text"
                value={formState.username}
                onChange={(event) =>
                  setFormState((previous) => ({ ...previous, username: event.target.value }))
                }
                required
              />
              <small>Each username must be unique.</small>
            </label>
            <label>
              Password
              <input
                type="password"
                value={formState.password}
                onChange={(event) =>
                  setFormState((previous) => ({ ...previous, password: event.target.value }))
                }
                required
              />
              <small>Share the credentials securely with the new user.</small>
            </label>
            <label>
              Confirm Password
              <input
                type="password"
                value={formState.confirmPassword}
                onChange={(event) =>
                  setFormState((previous) => ({
                    ...previous,
                    confirmPassword: event.target.value,
                  }))
                }
                required
              />
            </label>
            <button type="submit" disabled={createUserMutation.isPending}>
              {createUserMutation.isPending ? "Saving..." : "Create"}
            </button>
          </form>
        </section>
      ) : (
        <section>
          <p className="error-text">You must be an administrator to manage user accounts.</p>
        </section>
      )}
    </div>
  );
}

export default function MasterPage() {
  const { masterId } = useParams();
  const { user } = useAuth();

  if (!masterId || masterId === "metrics") {
    return <PSIMetricsMaster />;
  }

  if (masterId === "warehouses") {
    return <WarehouseMasterManager />;
  }

  if (masterId === "rank-parameters") {
    return <RankParametersMaster />;
  }

  if (masterId === "users") {
    return <UserRegistrationMaster isAdmin={Boolean(user?.is_admin)} />;
  }

  return (
    <div className="page">
      <header>
        <h1>Masters</h1>
        <p>This master does not have a dedicated management screen yet.</p>
      </header>
    </div>
  );
}
