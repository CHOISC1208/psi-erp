import axios from "axios";

// Vite の環境変数はビルド時にだけ展開される
const envBase =
  import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_BASE ?? "";

const baseURL =
  // ブラウザで動いている時は、指定が無ければ相対パスにする（同一オリジン）
  typeof window !== "undefined" ? (envBase || "") 
  // SSR/テストなど window が無い環境では、指定が無ければローカルを使う
  : (envBase || "http://127.0.0.1:8000");

if (typeof console !== "undefined") {
  console.info(`[api] Using base URL: ${baseURL || "(relative)"}`);
}

export const api = axios.create({
  baseURL,
  headers: { "Content-Type": "application/json" },
  // Cookie ベースのセッションを利用するため、常に `credentials` を送る
  withCredentials: true
});
