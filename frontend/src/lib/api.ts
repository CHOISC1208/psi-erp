import axios, { AxiosError } from "axios";

/**
 * Cookie セッション方式で動かすための axios クライアント
 * - baseURL: 相対パス（同一オリジン運用 / Viteプロキシ前提）
 * - withCredentials: true で Cookie を常に送受信
 * - Content-Type: application/json をデフォルト指定
 * - CSRF を使う場合は xsrfCookieName / xsrfHeaderName をサーバ仕様に合わせる
 */
const api = axios.create({
  baseURL: "", // ← 相対パス（Viteのproxyで 8000 に飛ばす）
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

// （将来CSRFを有効化するなら）サーバ設定に合わせて使う
api.defaults.xsrfCookieName = "csrf_token";
api.defaults.xsrfHeaderName = "X-CSRF-Token";

// --- 任意：共通エラーハンドリング（401でログイン画面に誘導など） ---
api.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    if (err.response?.status === 401) {
      // 例: 未ログインなら状態をクリアしてログイン画面へ
      // window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export default api;

/* 使い方例：
import api from "@/lib/api";

// ログイン
await api.post("/auth/login", { username: "admin", password: "admin" });

// 認証確認
const { data } = await api.get("/auth/me");
console.log(data);
*/
