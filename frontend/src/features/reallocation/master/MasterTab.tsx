import { FormEvent, useEffect, useMemo, useState } from "react";
import axios from "axios";

import { useAuth } from "../../../hooks/useAuth";
import {
  useReallocationPolicyQuery,
  useUpdateReallocationPolicyMutation,
} from "../../../hooks/useReallocationPolicy";

const ROUNDING_OPTIONS: Array<"floor" | "round" | "ceil"> = ["floor", "round", "ceil"];
const FAIR_SHARE_OPTIONS: Array<
  "off" | "equalize_ratio_closing" | "equalize_ratio_start"
> = ["off", "equalize_ratio_closing", "equalize_ratio_start"];

type StatusMessage = { type: "success" | "error"; text: string } | null;

type MasterTabKey = "policy";

const MASTER_TABS: Array<{ key: MasterTabKey; label: string }> = [
  { key: "policy", label: "在庫再配置ポリシー" },
];

type FormState = {
  take_from_other_main: boolean;
  rounding_mode: "floor" | "round" | "ceil";
  allow_overfill: boolean;
  fair_share_mode: "off" | "equalize_ratio_closing" | "equalize_ratio_start";
  updated_by: string;
};

const DEFAULT_FORM: FormState = {
  take_from_other_main: false,
  rounding_mode: "floor",
  allow_overfill: false,
  fair_share_mode: "off",
  updated_by: "",
};

const ROUNDING_OPTION_LABELS: Record<FormState["rounding_mode"], string> = {
  floor: "切り捨て",
  round: "四捨五入",
  ceil: "切り上げ",
};

const FAIR_SHARE_OPTION_LABELS: Record<FormState["fair_share_mode"], string> = {
  off: "OFF",
  equalize_ratio_closing: "STD 比率揃え（期末）",
  equalize_ratio_start: "STD 比率揃え（期首）",
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
  return "ポリシーの保存に失敗しました";
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
  const [activeTab, setActiveTab] = useState<MasterTabKey>("policy");

  const isAdmin = Boolean(user?.is_admin);

  useEffect(() => {
    if (!policyQuery.data) {
      return;
    }
    const nextState: FormState = {
      take_from_other_main: policyQuery.data.take_from_other_main,
      rounding_mode: policyQuery.data.rounding_mode,
      allow_overfill: policyQuery.data.allow_overfill,
      fair_share_mode: policyQuery.data.fair_share_mode,
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
      savedState.fair_share_mode !== formState.fair_share_mode ||
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
        fair_share_mode: formState.fair_share_mode,
        updated_by: formState.updated_by.trim() || undefined,
      };
      const data = await updateMutation.mutateAsync(payload);
      const nextSaved: FormState = {
        take_from_other_main: data.take_from_other_main,
        rounding_mode: data.rounding_mode,
        allow_overfill: data.allow_overfill,
        fair_share_mode: data.fair_share_mode,
        updated_by: data.updated_by ?? "",
      };
      setSavedState(nextSaved);
      setFormState((prev) => ({ ...prev, updated_by: nextSaved.updated_by }));
      setStatus({ type: "success", text: "ポリシーを保存しました" });
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
      <h2>マスター</h2>
      <div className="master-tabs">
        <div className="master-tab-list" role="tablist" aria-label="マスター設定">
          {MASTER_TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            const tabId = `master-tab-${tab.key}`;
            const panelId = `master-panel-${tab.key}`;
            return (
              <button
                key={tab.key}
                id={tabId}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={panelId}
                className={`master-tab-trigger${isActive ? " active" : ""}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {MASTER_TABS.map((tab) => {
          if (tab.key !== activeTab) {
            return null;
          }
          const panelId = `master-panel-${tab.key}`;
          const tabId = `master-tab-${tab.key}`;
          return (
            <div
              key={tab.key}
              id={panelId}
              role="tabpanel"
              aria-labelledby={tabId}
              className="master-tab-panel"
            >
              {tab.key === "policy" && (
                <>
                  {loading && <p>ポリシーを読み込んでいます…</p>}
                  {loadError && !loading && (
                    <p className="error-text">ポリシーの読み込みに失敗しました。しばらくしてから再度お試しください。</p>
                  )}
                  {!loading && !loadError && (
                    <div className="master-policy-layout">
                      <article className="master-policy-guidance">
                        <h3>在庫再配置ポリシーについて</h3>
                        <p>
                          在庫再配置の推奨ロジックがどのように在庫を移動させるかを決める全社共通の
                          設定です。ここで保存した内容は全ユーザーに即時反映され、推奨作成や再計算の
                          結果に影響します。
                        </p>
                        <ul>
                          <li>
                            <strong>① 他倉庫メインチャネルからの引当を許可</strong>：優先ドナーを使い切った
                            後に、他倉庫のメインチャネル在庫を追加の供給源として使用します。
                          </li>
                          <li>
                            <strong>② 端数処理モード</strong>：計算上の小数点以下をどのように丸めて移動数量を
                            決定するか（切り捨て／四捨五入／切り上げ）を指定します。
                          </li>
                          <li>
                            <strong>③ フェアシェアモード</strong>：メインチャネルの在庫水準が均等になるよう、
                            STD 比率（期末または期首）を揃える分配ロジックを有効化します。
                          </li>
                          <li>
                            <strong>④ STD 超過の許可</strong>：受け側の在庫が STD を上回る場合でも移動を許可
                            するかどうかを制御します。OFF にすると STD を超える手前で数量が調整されます。
                          </li>
                        </ul>
                        <p className="guidance-note">
                          ※ 保存操作は管理者のみ実行できます。内容を更新すると更新者と時刻が記録され
                          ます。
                        </p>
                      </article>

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
                            <span>① 他倉庫メインチャネルからの引当を許可</span>
                          </label>
                          <p className="field-hint">
                            ON にすると、非メインチャネルの供給源を使い切った後に他倉庫のメイン
                            チャネル在庫を追加のドナーとして利用します。
                          </p>
                        </div>

                        <div className="form-field">
                          <label htmlFor="rounding-mode">② 端数処理モード</label>
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
                                {ROUNDING_OPTION_LABELS[option]}
                              </option>
                            ))}
                          </select>
                          <p className="field-hint">
                            在庫移動数量の小数点以下をどのように丸めて整数化するかを制御します。
                          </p>
                        </div>

                        <div className="form-field">
                          <label htmlFor="fair-share-mode">③ フェアシェアモード</label>
                          <select
                            id="fair-share-mode"
                            value={formState.fair_share_mode}
                            onChange={(event) =>
                              setFormState((prev) => ({
                                ...prev,
                                fair_share_mode: event.target.value as FormState["fair_share_mode"],
                              }))
                            }
                            disabled={!isAdmin || updateMutation.isPending}
                          >
                            {FAIR_SHARE_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {FAIR_SHARE_OPTION_LABELS[option]}
                              </option>
                            ))}
                          </select>
                          <p className="field-hint">
                            メインチャネルの在庫／STD 比率（期末または期首ベース）を揃えるようにドナー
                            を分配します。
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
                            <span>④ STD 超過の許可</span>
                          </label>
                          <p className="field-hint">
                            OFF にすると、受け側が STD 在庫を超える手前で移動数量を自動的に調整します。
                          </p>
                        </div>

                        <div className="form-field">
                          <label htmlFor="updated-by">更新者（任意）</label>
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
                              最終更新日時：<strong>{formatDate(lastUpdatedAt)}</strong>
                            </span>
                            <span>
                              更新者：<strong>{lastUpdatedBy?.trim() || "—"}</strong>
                            </span>
                          </div>
                          <div className="form-actions">
                            {!isAdmin && (
                              <span className="field-hint">
                                ポリシーを更新できるのは管理者のみです。
                              </span>
                            )}
                            <button
                              type="submit"
                              disabled={!isAdmin || !isDirty || updateMutation.isPending}
                            >
                              {updateMutation.isPending ? "保存中…" : "保存"}
                            </button>
                          </div>
                        </div>

                        {status && (
                          <p className={`status-message ${status.type}`}>{status.text}</p>
                        )}
                      </form>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
