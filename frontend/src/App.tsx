import { Navigate, NavLink, Route, Routes } from "react-router-dom";

import SessionsPage from "./pages/SessionsPage";
import UploadPage from "./pages/UploadPage";
import PSITablePage from "./pages/PSITablePage";
import "./App.css";

export default function App() {
  return (
    <div className="app">
      <nav className="sidebar">
        <h1 className="app-title">PSI ERP</h1>
        <ul>
          <li>
            <NavLink to="/sessions" className={({ isActive }) => (isActive ? "active" : undefined)}>
              Sessions
            </NavLink>
          </li>
          <li>
            <NavLink to="/upload" className={({ isActive }) => (isActive ? "active" : undefined)}>
              Upload CSV
            </NavLink>
          </li>
          <li>
            <NavLink to="/psi" className={({ isActive }) => (isActive ? "active" : undefined)}>
              PSI Table
            </NavLink>
          </li>
        </ul>
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/sessions" replace />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/psi" element={<PSITablePage />} />
        </Routes>
      </main>
    </div>
  );
}
