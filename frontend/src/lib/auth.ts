import api from "./api";

export interface LoginPayload {
  username: string;
  password: string;
}

export interface LoginResponse {
  next: string;
  csrf_token?: string;
}

export interface UserProfile {
  id: string;
  username: string;
  is_active: boolean;
  is_admin: boolean;
}

export async function login(payload: LoginPayload): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>("/auth/login", payload);
  return data;
}

export async function fetchMe(): Promise<UserProfile> {
  const { data } = await api.get<UserProfile>("/auth/me");
  return data;
}

export async function logout(): Promise<void> {
  await api.post("/auth/logout");
}
