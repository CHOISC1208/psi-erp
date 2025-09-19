import { FormEvent, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import { api } from "../lib/api";
import type { MasterRecord } from "../types";

type FieldType = "text" | "number";

interface MasterField {
  key: string;
  label: string;
  helper: string;
  type?: FieldType;
  required?: boolean;
}

interface MasterConfig {
  title: string;
  description: string;
  fields: MasterField[];
}

type MasterFormState = Record<string, string>;
type MasterPayload = Record<string, string | number | null>;

const masterConfigs: Record<string, MasterConfig> = {
  products: {
    title: "Product Master",
    description:
      "Manage product catalog information including SKU, name, and stock control details.",
    fields: [
      { key: "sku_code", label: "SKU", helper: "Unique product identifier", required: true },
      { key: "name", label: "Name", helper: "Display name", required: true },
      { key: "category", label: "Category", helper: "Grouping for reporting" },
      {
        key: "safety_stock",
        label: "Safety Stock",
        helper: "Minimum quantity to keep on hand",
        type: "number",
      },
    ],
  },
  customers: {
    title: "Customer Master",
    description: "Maintain customer records used for order and PSI planning.",
    fields: [
      { key: "code", label: "Customer Code", helper: "Unique customer reference", required: true },
      { key: "name", label: "Name", helper: "Billing or trading name", required: true },
      { key: "contact", label: "Contact", helper: "Primary contact information" },
      { key: "region", label: "Region", helper: "Sales territory" },
    ],
  },
  suppliers: {
    title: "Supplier Master",
    description: "Define suppliers that provide materials feeding the PSI calculations.",
    fields: [
      {
        key: "code",
        label: "Supplier Code",
        helper: "Unique supplier reference",
        required: true,
      },
      { key: "name", label: "Name", helper: "Supplier name", required: true },
      {
        key: "lead_time",
        label: "Lead Time (days)",
        helper: "Average delivery lead time",
        type: "number",
      },
      { key: "currency", label: "Currency", helper: "Default purchasing currency" },
    ],
  },
};

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

const createEmptyFormState = (config: MasterConfig): MasterFormState => {
  return config.fields.reduce<MasterFormState>((accumulator, field) => {
    accumulator[field.key] = "";
    return accumulator;
  }, {});
};

const buildPayload = (config: MasterConfig, values: MasterFormState): MasterPayload => {
  return config.fields.reduce<MasterPayload>((accumulator, field) => {
    const rawValue = values[field.key] ?? "";
    const trimmed = rawValue.trim();

    if (!trimmed) {
      accumulator[field.key] = null;
      return accumulator;
    }

    if (field.type === "number") {
      const numericValue = Number(trimmed);
      accumulator[field.key] = Number.isNaN(numericValue) ? trimmed : numericValue;
    } else {
      accumulator[field.key] = trimmed;
    }

    return accumulator;
  }, {});
};

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toString() : String(value);
  }

  return String(value);
};

export default function MasterPage() {
  const { masterId } = useParams<{ masterId: string }>();
  const queryClient = useQueryClient();

  const config = useMemo(() => {
    if (!masterId) return undefined;
    return masterConfigs[masterId];
  }, [masterId]);

  const [formState, setFormState] = useState<MasterFormState>({});
  const [editState, setEditState] = useState<MasterFormState>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (config) {
      setFormState(createEmptyFormState(config));
      setEditState(createEmptyFormState(config));
      setEditingId(null);
      setStatus(null);
    }
  }, [config]);

  const recordsQuery = useQuery({
    queryKey: ["masters", masterId],
    queryFn: async (): Promise<MasterRecord[]> => {
      if (!masterId) {
        return [];
      }
      const { data } = await api.get<MasterRecord[]>(`/masters/${masterId}`);
      return data;
    },
    enabled: Boolean(masterId && config),
  });

  const createRecord = useMutation<MasterRecord, unknown, MasterPayload>({
    mutationFn: async (payload: MasterPayload) => {
      if (!masterId) throw new Error("Master not selected");
      const { data } = await api.post<MasterRecord>(`/masters/${masterId}`, { data: payload });
      return data;
    },
    onSuccess: () => {
      if (config) {
        setFormState(createEmptyFormState(config));
      }
      setStatus({ type: "success", text: "Record added." });
      queryClient.invalidateQueries({ queryKey: ["masters", masterId] });
    },
    onError: (error) => {
      setStatus({
        type: "error",
        text: getErrorMessage(error, "Unable to add record. Try again."),
      });
    },
    onMutate: () => {
      setStatus(null);
    },
  });

  const updateRecord = useMutation<MasterRecord, unknown, { id: string; payload: MasterPayload }>({
    mutationFn: async ({ id, payload }) => {
      if (!masterId) throw new Error("Master not selected");
      const { data } = await api.put<MasterRecord>(`/masters/${masterId}/${id}`, { data: payload });
      return data;
    },
    onSuccess: () => {
      setEditingId(null);
      if (config) {
        setEditState(createEmptyFormState(config));
      }
      setStatus({ type: "success", text: "Record updated." });
      queryClient.invalidateQueries({ queryKey: ["masters", masterId] });
    },
    onError: (error) => {
      setStatus({
        type: "error",
        text: getErrorMessage(error, "Unable to update record. Try again."),
      });
    },
    onMutate: () => {
      setStatus(null);
    },
  });

  const deleteRecord = useMutation<void, unknown, string>({
    mutationFn: async (recordId: string) => {
      if (!masterId) throw new Error("Master not selected");
      await api.delete(`/masters/${masterId}/${recordId}`);
    },
    onSuccess: () => {
      setStatus({ type: "success", text: "Record deleted." });
      queryClient.invalidateQueries({ queryKey: ["masters", masterId] });
    },
    onError: (error) => {
      setStatus({
        type: "error",
        text: getErrorMessage(error, "Unable to delete record. Try again."),
      });
    },
    onMutate: (recordId) => {
      setStatus(null);
      setDeletingId(recordId);
    },
    onSettled: () => {
      setDeletingId(null);
    },
  });

  if (!config) {
    return (
      <div className="page">
        <header>
          <h1>Masters</h1>
          <p>Select a master from the sidebar to view and manage its records.</p>
        </header>
      </div>
    );
  }

  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!masterId) return;

    const missingRequired = config.fields.filter(
      (field) => field.required && !(formState[field.key] ?? "").trim(),
    );

    if (missingRequired.length > 0) {
      setStatus({ type: "error", text: "Fill in all required fields before saving." });
      return;
    }

    createRecord.mutate(buildPayload(config, formState));
  };

  const startEditing = (record: MasterRecord) => {
    setStatus(null);
    setEditingId(record.id);
    const nextState = config.fields.reduce<MasterFormState>((accumulator, field) => {
      const value = (record.data as Record<string, unknown>)[field.key];
      accumulator[field.key] = value === null || value === undefined ? "" : String(value);
      return accumulator;
    }, createEmptyFormState(config));
    setEditState(nextState);
  };

  const handleEditSave = () => {
    if (!editingId) return;

    const missingRequired = config.fields.filter(
      (field) => field.required && !(editState[field.key] ?? "").trim(),
    );

    if (missingRequired.length > 0) {
      setStatus({ type: "error", text: "Fill in all required fields before saving." });
      return;
    }

    updateRecord.mutate({ id: editingId, payload: buildPayload(config, editState) });
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditState(createEmptyFormState(config));
    setStatus(null);
  };

  return (
    <div className="page master-page">
      <header>
        <h1>{config.title}</h1>
        <p>{config.description}</p>
      </header>

      <section>
        <h2>Add New Record</h2>
        <form onSubmit={handleCreate} className="form-grid">
          {config.fields.map((field) => (
            <label key={field.key}>
              {field.label}
              <input
                type={field.type ?? "text"}
                value={formState[field.key] ?? ""}
                onChange={(event) =>
                  setFormState((previous) => ({ ...previous, [field.key]: event.target.value }))
                }
                required={field.required}
              />
              <small>{field.helper}</small>
            </label>
          ))}
          <button type="submit" disabled={createRecord.isPending}>
            {createRecord.isPending ? "Saving..." : "Add"}
          </button>
        </form>
      </section>

      <section>
        <h2>Existing Records</h2>
        {recordsQuery.isLoading && <p>Loading records...</p>}
        {recordsQuery.isError && (
          <p className="error" role="alert">
            {getErrorMessage(recordsQuery.error, "Failed to load master data.")}
          </p>
        )}
        {status && <p className={status.type === "error" ? "error" : "success"}>{status.text}</p>}
        {recordsQuery.data && recordsQuery.data.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                {config.fields.map((field) => (
                  <th key={field.key}>{field.label}</th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {recordsQuery.data.map((record) => {
                const isEditing = editingId === record.id;
                const isDeleting = deletingId === record.id && deleteRecord.isPending;
                const isSaving = updateRecord.isPending && updateRecord.variables?.id === record.id;

                return (
                  <tr key={record.id}>
                    {config.fields.map((field) => (
                      <td key={field.key}>
                        {isEditing ? (
                          <input
                            type={field.type ?? "text"}
                            value={editState[field.key] ?? ""}
                            onChange={(event) =>
                              setEditState((previous) => ({
                                ...previous,
                                [field.key]: event.target.value,
                              }))
                            }
                            required={field.required}
                          />
                        ) : (
                          formatValue((record.data as Record<string, unknown>)[field.key])
                        )}
                      </td>
                    ))}
                    <td className="actions">
                      {isEditing ? (
                        <>
                          <button type="button" onClick={handleEditSave} disabled={isSaving}>
                            {isSaving ? "Saving..." : "Save"}
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={handleEditCancel}
                            disabled={isSaving}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={() => startEditing(record)}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => deleteRecord.mutate(record.id)}
                            disabled={isDeleting}
                          >
                            {isDeleting ? "Deleting..." : "Delete"}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          !recordsQuery.isLoading && <p>No records yet.</p>
        )}
      </section>
    </div>
  );
}
