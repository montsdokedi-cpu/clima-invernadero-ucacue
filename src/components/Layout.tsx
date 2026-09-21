import {
  ChartLine,
  ClipboardPen,
  Ellipsis,
  FileText,
  FlaskConical,
  History,
  LayoutDashboard,
  Microscope,
  Settings,
  ShieldAlert,
  ShowerHead,
  Sprout,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { saveSettings } from '../db/db';
import { useData } from '../state/DataContext';
import { Esp32Badge } from './irrigation';

const NAV = [
  { to: '/', label: 'Dashboard', short: 'Inicio', icon: LayoutDashboard, end: true },
  { to: '/riego', label: 'Riego y parcelas', short: 'Riego', icon: ShowerHead },
  { to: '/registrar', label: 'Registrar datos', short: 'Registrar', icon: ClipboardPen },
  { to: '/graficos', label: 'Gráficos', short: 'Gráficos', icon: ChartLine },
  { to: '/problemas', label: 'Problemas climáticos', short: 'Problemas', icon: ShieldAlert },
  { to: '/historial', label: 'Historial', short: 'Historial', icon: History },
  { to: '/analisis', label: 'Análisis climático', short: 'Análisis', icon: Microscope },
  { to: '/cultivos', label: 'Cultivo de tomate', short: 'Cultivo', icon: Sprout },
  { to: '/reportes', label: 'Reportes académicos', short: 'Reportes', icon: FileText },
  { to: '/configuracion', label: 'Configuración', short: 'Ajustes', icon: Settings },
];

function Logo() {
  return <img src="./icon.svg" alt="" className="logo" width={38} height={38} />;
}

export function Layout() {
  const { isDemo, greenhouses, greenhouseFilter, setGreenhouseFilter, settings } = useData();
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMoreOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  const moreActive = NAV.slice(5).some((n) => location.pathname.startsWith(n.to));

  return (
    <div className={`app ${isDemo ? 'is-demo' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <Logo />
          <div>
            <strong>Clima Invernadero UCACUE</strong>
            <span>Climatología aplicada · Tomate</span>
          </div>
        </div>
        <nav>
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Icon size={19} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span>{settings.institution}</span>
          <span>{settings.campus}</span>
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <div className="topbar-brand">
            <Logo />
            <strong>Clima UCACUE</strong>
          </div>
          <div className="topbar-right">
            {greenhouses.length > 1 && (
              <select
                id="greenhouse-filter"
                className="gh-select"
                aria-label="Invernadero"
                value={greenhouseFilter ?? ''}
                onChange={(e) => setGreenhouseFilter(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Todos los invernaderos</option>
                {greenhouses.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.code} · {g.name}
                  </option>
                ))}
              </select>
            )}
            {greenhouses.length === 1 && <span className="gh-name">{greenhouses[0].code} · {greenhouses[0].name}</span>}
            <NavLink to="/riego" style={{ textDecoration: 'none' }}><Esp32Badge compact /></NavLink>
            <span className={`mode-badge ${isDemo ? 'demo' : 'real'}`}>{isDemo ? 'Datos de demostración' : 'Datos reales'}</span>
          </div>
        </header>

        {isDemo && (
          <div className="demo-banner" role="note">
            <FlaskConical size={18} />
            <span>
              <strong>Modo demostración.</strong> Datos simulados de un datalogger: no corresponden a mediciones del invernadero de la UCACUE y no deben usarse en el análisis académico.
            </span>
            <button className="btn btn-sm btn-light" onClick={() => saveSettings({ dataMode: 'real' })}>
              Ver datos reales
            </button>
          </div>
        )}

        <main className="content">
          <Outlet />
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Navegación principal">
        {NAV.slice(0, 5).map(({ to, short, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `bn-item ${isActive ? 'active' : ''}`}>
            <Icon size={21} />
            <span>{short}</span>
          </NavLink>
        ))}
        <button className={`bn-item ${moreActive || moreOpen ? 'active' : ''}`} onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen}>
          {moreOpen ? <X size={21} /> : <Ellipsis size={21} />}
          <span>Más</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="sheet-backdrop" onClick={() => setMoreOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            {NAV.slice(5).map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={({ isActive }) => `sheet-item ${isActive ? 'active' : ''}`}>
                <Icon size={22} />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
