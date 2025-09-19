import { useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";

import SessionsPage from "./pages/SessionsPage";
import PSITablePage from "./pages/PSITablePage";
import MasterPage from "./pages/MasterPage";
import "./App.css";

export default function App() {
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMasterMenuOpen, setIsMasterMenuOpen] = useState(location.pathname.startsWith("/masters"));

  useEffect(() => {
    if (location.pathname.startsWith("/masters")) {
      setIsMasterMenuOpen(true);
    }
  }, [location.pathname]);

  const masters = [
    { path: "/masters/products", label: "Product Master", icon: "📦" },
    { path: "/masters/customers", label: "Customer Master", icon: "🧑" },
    { path: "/masters/suppliers", label: "Supplier Master", icon: "🚚" },
  ];

  return (
    <div className={`app ${isSidebarOpen ? "" : "sidebar-collapsed"}`}>
      <nav className={`sidebar ${isSidebarOpen ? "open" : "collapsed"}`}>
        <div className="sidebar-header">
          <h1 className="app-title">PSI ERP</h1>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setIsSidebarOpen((prev) => !prev)}
            aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            aria-expanded={isSidebarOpen}
          >
            ☰
          </button>
        </div>
        <ul className="sidebar-menu">
          <li>
            <NavLink to="/sessions" className={({ isActive }) => (isActive ? "active" : undefined)}>
              <span className="menu-icon" aria-hidden="true">
                🗓
              </span>
              <span className="menu-label">Sessions</span>
            </NavLink>
          </li>
          <li className={`has-children ${isMasterMenuOpen ? "open" : ""}`}>
            <button
              type="button"
              onClick={() => setIsMasterMenuOpen((prev) => !prev)}
              className="submenu-toggle"
              aria-expanded={isMasterMenuOpen}
            >
              <span className="menu-icon" aria-hidden="true">
                🧾
              </span>
              <span className="menu-label">Masters</span>
              <span className="submenu-icon">{isMasterMenuOpen ? "▲" : "▼"}</span>
            </button>
            <ul className="submenu">
              {masters.map((master) => (
                <li key={master.path}>
                  <NavLink
                    to={master.path}
                    className={({ isActive }) => (isActive ? "active" : undefined)}
                    onClick={() => setIsMasterMenuOpen(true)}
                  >
                    <span className="menu-icon" aria-hidden="true">
                      {master.icon}
                    </span>
                    <span className="menu-label">{master.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </li>
          <li>
            <NavLink to="/psi" className={({ isActive }) => (isActive ? "active" : undefined)}>
              <span className="menu-icon" aria-hidden="true">
                📊
              </span>
              <span className="menu-label">PSI Table</span>
            </NavLink>
          </li>
        </ul>
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/sessions" replace />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/masters/:masterId" element={<MasterPage />} />
          <Route path="/psi" element={<PSITablePage />} />
          <Route path="/masters" element={<Navigate to={masters[0].path} replace />} />
        </Routes>
      </main>
    </div>
  );
}
