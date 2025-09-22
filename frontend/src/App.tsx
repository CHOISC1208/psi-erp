import { useEffect, useMemo, useState } from "react";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";

import SessionsPage from "./pages/SessionsPage";
import PSITablePage from "./pages/PSITablePage";
import MasterPage from "./pages/MasterPage";
import TransferPage from "./pages/TransferPage";
import DocsPage from "./pages/DocsPage";
import LoginPage from "./pages/LoginPage";
import { useAuth } from "./hooks/useAuth";
import "./App.css";
import "./styles/psi-sticky.css";

function ProtectedLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMasterMenuOpen, setIsMasterMenuOpen] = useState(
    location.pathname.startsWith("/masters"),
  );

  useEffect(() => {
    if (location.pathname.startsWith("/masters")) {
      setIsMasterMenuOpen(true);
    }
  }, [location.pathname]);

  const masters = useMemo(
    () => [{ path: "/masters/psi-metrics", label: "PSI Metrics Master", icon: "🧮" }],
    [],
  );

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

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
        <div className="sidebar-user">
          <span className="user-name" title={user?.username}>
            {user?.username}
          </span>
          <button type="button" className="logout-button" onClick={handleLogout}>
            Log out
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
          <li>
            <NavLink to="/psi" className={({ isActive }) => (isActive ? "active" : undefined)}>
              <span className="menu-icon" aria-hidden="true">
                📊
              </span>
              <span className="menu-label">PSI Table</span>
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/transfer"
              className={({ isActive }) => (isActive ? "active" : undefined)}
            >
              <span className="menu-icon" aria-hidden="true">
                🔄
              </span>
              <span className="menu-label">Transfer</span>
            </NavLink>
          </li>
          <li>
            <NavLink to="/docs" className={({ isActive }) => (isActive ? "active" : undefined)}>
              <span className="menu-icon" aria-hidden="true">
                📚
              </span>
              <span className="menu-label">Docs</span>
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
        </ul>
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/sessions" replace />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/masters/:masterId" element={<MasterPage />} />
          <Route path="/psi" element={<PSITablePage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/transfer" element={<TransferPage />} />
          <Route path="/masters" element={<Navigate to={masters[0].path} replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <div className="app-loading">Checking session…</div>;
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="*"
          element={(
            <Navigate
              to="/login"
              replace
              state={{ from: location.pathname + location.search }}
            />
          )}
        />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/sessions" replace />} />
      <Route path="/*" element={<ProtectedLayout />} />
    </Routes>
  );
}
