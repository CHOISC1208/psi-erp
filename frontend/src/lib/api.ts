import axios from "axios";

const baseURL =
  import.meta.env.VITE_API_BASE_URL ??
  import.meta.env.VITE_API_BASE ??
  "http://127.0.0.1:8000";

if (typeof console !== "undefined") {
  console.info(`[api] Using base URL: ${baseURL}`);
}

export const api = axios.create({
  baseURL,
  headers: {
    "Content-Type": "application/json"
  }
});
