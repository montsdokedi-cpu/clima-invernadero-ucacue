import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import './agro.css';
import { Layout } from './components/Layout';
import Analysis from './pages/Analysis';
import Charts from './pages/Charts';
import Crops from './pages/Crops';
import Dashboard from './pages/Dashboard';
import History from './pages/History';
import ImportData from './pages/ImportData';
import Problems from './pages/Problems';
import RecordForm from './pages/RecordForm';
import Reports from './pages/Reports';
import SettingsPage from './pages/Settings';
import { DataProvider } from './state/DataContext';
import { ToastProvider } from './state/Toast';

// HashRouter: funciona igual en navegador, PWA instalada y APK (Capacitor, file://).
export default function App() {
  return (
    <ToastProvider>
      <DataProvider>
        <HashRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="registrar" element={<RecordForm />} />
              <Route path="registrar/:id" element={<RecordForm />} />
              <Route path="importar" element={<ImportData />} />
              <Route path="historial" element={<History />} />
              <Route path="graficos" element={<Charts />} />
              <Route path="problemas" element={<Problems />} />
              <Route path="analisis" element={<Analysis />} />
              <Route path="cultivos" element={<Crops />} />
              <Route path="reportes" element={<Reports />} />
              <Route path="configuracion" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </HashRouter>
      </DataProvider>
    </ToastProvider>
  );
}
