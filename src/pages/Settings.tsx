import { BookOpen, Database, FlaskConical, Pencil, Plus, Settings as SettingsIcon, Sprout, Trash2, Warehouse } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Esp32SettingsCard } from '../components/Esp32Settings';
import { ConfirmModal, Field, Modal, PageHeader } from '../components/ui';
import { db, DEFAULT_SETTINGS, getSettings, saveSettings, tomatoThresholds } from '../db/db';
import { hasDemoData, removeDemoData, seedDemoData } from '../db/seed';
import { REAL_SOURCES, SOURCE_LABELS, TOMATO_STAGES, type AppSettings, type ClimateThreshold, type Greenhouse, type OptionalField, type Role, type User } from '../db/types';
import { todayISO } from '../lib/dates';
import { downloadBlob } from '../lib/download';
import { parseNumber } from '../lib/validation';
import { VARIABLES } from '../lib/variables';
import { useData } from '../state/DataContext';
import { useToast } from '../state/Toast';

const OPTIONAL: OptionalField[] = ['soilTemp', 'soilMoisture', 'luminosity', 'solarRadiation', 'windSpeed', 'precipitation', 'outsideTemp', 'outsideHumidity'];
const ROLES: Role[] = ['estudiante', 'docente', 'investigador', 'productor'];
type RefRow = { id?: number; stage: string | null; tempMin: string; tempMax: string; humidityMin: string; humidityMax: string };

function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id: string }) {
  return (
    <label className="switch" aria-label={label}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export default function SettingsPage() {
  const { ready, settings, isDemo, greenhouses, users, thresholds, allRecords } = useData();
  const toast = useToast();
  const [general, setGeneral] = useState({ institution: '', campus: '', defaultResponsible: '' });
  const [study, setStudy] = useState({ studyTitle: '', studyProblem: '', referenceSource: '' });
  const [detect, setDetect] = useState({ abruptTempChange: '', abruptHumidityChange: '', gapHours: '' });
  const [refs, setRefs] = useState<RefRow[]>([]);
  const [soil, setSoil] = useState({ soilTempMin: '', soilTempMax: '', soilMoistureMin: '', soilMoistureMax: '' });
  const [gh, setGh] = useState<Partial<Greenhouse> | null>(null);
  const [user, setUser] = useState<Partial<User> | null>(null);
  const [confirm, setConfirm] = useState<null | 'demo-remove' | 'real-delete' | 'refs-reset' | { restore: File }>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const restoreRef = useRef<HTMLInputElement>(null);

  const refThresholds = thresholds.filter((t) => t.cropId === null);
  const refKey = refThresholds.map((t) => `${t.id}:${t.tempMin}:${t.tempMax}:${t.humidityMin}:${t.humidityMax}`).join('|');

  useEffect(() => {
    if (!ready) return;
    setGeneral({ institution: settings.institution, campus: settings.campus, defaultResponsible: settings.defaultResponsible });
    setStudy({ studyTitle: settings.studyTitle, studyProblem: settings.studyProblem, referenceSource: settings.referenceSource });
    setDetect({ abruptTempChange: String(settings.abruptTempChange), abruptHumidityChange: String(settings.abruptHumidityChange), gapHours: String(settings.gapHours) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, isDemo]);

  useEffect(() => {
    const str = (v: number | null | undefined) => (v == null ? '' : String(v));
    const rows: RefRow[] = [null, ...TOMATO_STAGES].map((stage) => {
      const t = refThresholds.find((x) => (x.stage ?? null) === stage);
      return { id: t?.id, stage, tempMin: str(t?.tempMin), tempMax: str(t?.tempMax), humidityMin: str(t?.humidityMin), humidityMax: str(t?.humidityMax) };
    });
    setRefs(rows);
    const g = refThresholds.find((x) => !x.stage);
    setSoil({ soilTempMin: str(g?.soilTempMin), soilTempMax: str(g?.soilTempMax), soilMoistureMin: str(g?.soilMoistureMin), soilMoistureMax: str(g?.soilMoistureMax) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refKey]);

  if (!ready) return <div className="loading">Cargando…</div>;

  const setMode = async (mode: AppSettings['dataMode']) => {
    setBusy(true);
    if (mode === 'demo' && !(await hasDemoData())) {
      await seedDemoData();
      toast('Se generaron 45 días de datos simulados de un datalogger.', 'info');
    }
    await saveSettings({ dataMode: mode });
    setBusy(false);
  };

  const saveRefs = async () => {
    const out: ClimateThreshold[] = [];
    for (const r of refs) {
      const [a, b, c, d] = [r.tempMin, r.tempMax, r.humidityMin, r.humidityMax].map(parseNumber);
      const label = r.stage ? `Tomate · ${r.stage}` : 'Tomate · referencia general';
      const empty = [a, b, c, d].every((v) => v === undefined);
      if (empty && r.stage) {
        if (r.id) await db.climateThresholds.delete(r.id);
        continue;
      }
      if ([a, b, c, d].some((v) => v === undefined || Number.isNaN(v))) return toast(`${label}: completa los cuatro valores numéricos.`, 'error');
      if (a! >= b! || c! >= d!) return toast(`${label}: cada mínimo debe ser menor que su máximo.`, 'error');
      if (c! < 0 || d! > 100) return toast(`${label}: la humedad relativa debe estar entre 0 y 100 %.`, 'error');
      const s = r.stage ? {} : Object.fromEntries(Object.entries(soil).map(([k, v]) => [k, parseNumber(v) ?? null]));
      out.push({ ...(r.id ? { id: r.id } : {}), cropId: null, stage: r.stage, label, tempMin: a!, tempMax: b!, humidityMin: c!, humidityMax: d!, isDemo, ...s } as ClimateThreshold);
    }
    await db.climateThresholds.bulkPut(out);
    toast('Referencias climáticas del tomate guardadas.');
  };

  const saveDetect = async () => {
    const [t, h, g] = [detect.abruptTempChange, detect.abruptHumidityChange, detect.gapHours].map(parseNumber);
    if (![t, h, g].every((v) => typeof v === 'number' && v > 0)) return toast('Ingresa valores positivos.', 'error');
    await saveSettings({ abruptTempChange: t, abruptHumidityChange: h, gapHours: g });
    toast('Parámetros de detección guardados.');
  };

  const exportBackup = async () => {
    const dump = {
      app: 'Clima Invernadero UCC', version: 2, exportedAt: new Date().toISOString(),
      settings: await getSettings(), users: await db.users.toArray(), greenhouses: await db.greenhouses.toArray(), crops: await db.crops.toArray(),
      climateRecords: await db.climateRecords.toArray(), climateThresholds: await db.climateThresholds.toArray(), reports: await db.reports.toArray(),
      parcels: await db.parcels.toArray(), valveEvents: await db.valveEvents.toArray(),
    };
    downloadBlob(new Blob([JSON.stringify(dump)], { type: 'application/json' }), `respaldo_clima_ucacue_${todayISO()}.json`);
    toast('Respaldo descargado.');
  };

  const restoreBackup = async (file: File) => {
    try {
      const dump = JSON.parse(await file.text());
      if (dump.app !== 'Clima Invernadero UCC' || !Array.isArray(dump.climateRecords)) throw new Error('El archivo no es un respaldo de esta aplicación.');
      await db.transaction('rw', [db.users, db.greenhouses, db.crops, db.climateRecords, db.climateThresholds, db.reports, db.settings, db.parcels, db.valveEvents], async () => {
        for (const t of [db.users, db.greenhouses, db.crops, db.climateRecords, db.climateThresholds, db.reports]) await t.clear();
        // Respaldos anteriores a la v3 no traen parcelas: se conservan las actuales
        if (Array.isArray(dump.parcels)) { await db.parcels.clear(); await db.parcels.bulkPut(dump.parcels); }
        if (Array.isArray(dump.valveEvents)) { await db.valveEvents.clear(); await db.valveEvents.bulkPut(dump.valveEvents); }
        await db.users.bulkPut(dump.users ?? []);
        await db.greenhouses.bulkPut(dump.greenhouses ?? []);
        await db.crops.bulkPut(dump.crops ?? []);
        await db.climateRecords.bulkPut(dump.climateRecords.map((r: { validation?: string }) => ({ validation: 'valido', ...r })));
        await db.climateThresholds.bulkPut(dump.climateThresholds ?? []);
        await db.reports.bulkPut(dump.reports ?? []);
        if (dump.settings) await db.settings.put({ ...dump.settings, id: 'app' });
      });
      toast(`Respaldo restaurado (${dump.climateRecords.length} registros).`);
    } catch (e) {
      toast(`No se pudo restaurar: ${(e as Error).message}`, 'error');
    }
  };

  const saveGh = async () => {
    if (!gh?.code?.trim() || !gh.name?.trim()) return toast('Código y nombre son obligatorios.', 'error');
    const data: Greenhouse = { code: gh.code.trim(), name: gh.name.trim(), location: gh.location?.trim() ?? '', areaM2: gh.areaM2, coverType: gh.coverType, notes: gh.notes, isDemo: gh.isDemo ?? isDemo, createdAt: gh.createdAt ?? Date.now() };
    if (gh.id) await db.greenhouses.put({ ...data, id: gh.id });
    else await db.greenhouses.add(data);
    setGh(null);
    toast('Invernadero guardado.');
  };

  const saveUser = async () => {
    if (!user?.name?.trim()) return toast('El nombre es obligatorio.', 'error');
    const data: User = { name: user.name.trim(), role: user.role ?? 'estudiante', email: user.email?.trim(), isDemo: user.isDemo ?? isDemo, createdAt: user.createdAt ?? Date.now() };
    if (user.id) await db.users.put({ ...data, id: user.id });
    else await db.users.add(data);
    setUser(null);
    toast('Responsable guardado.');
  };

  const realCount = isDemo ? null : allRecords.length;
  const setRef = (i: number, k: keyof RefRow, v: string) => setRefs((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  return (
    <>
      <PageHeader title="Configuración" description="Estudio, referencias del tomate, fuentes de datos, invernaderos y respaldo." icon={<SettingsIcon size={22} />} />

      <section className="card card-pad" style={{ marginBottom: 16 }}>
        <h3 className="card-title"><Sprout size={17} className="text-green" /> Referencias climáticas del tomate</h3>
        <div className="notice warn" style={{ marginBottom: 12 }}>
          <BookOpen size={18} />
          <span><strong>Rangos referenciales configurables según variedad, etapa fenológica y bibliografía utilizada.</strong> No son mediciones ni valores universales: el docente o investigador debe ajustarlos y citar su fuente.</span>
        </div>
        <div className="table-wrap">
          <table className="data-table ref-table">
            <thead><tr><th>Aplica a</th><th className="num">T. mín (°C)</th><th className="num">T. máx (°C)</th><th className="num">HR mín (%)</th><th className="num">HR máx (%)</th></tr></thead>
            <tbody>
              {refs.map((r, i) => (
                <tr key={r.stage ?? 'general'}>
                  <td><strong>{r.stage ?? 'Referencia general'}</strong>{!r.stage && <div className="small muted">Registros sin etapa</div>}</td>
                  {(['tempMin', 'tempMax', 'humidityMin', 'humidityMax'] as const).map((k) => (
                    <td key={k} className="num"><input id={`ref-${i}-${k}`} aria-label={`${r.stage ?? 'General'} ${k}`} type="text" inputMode="decimal" value={r[k]} onChange={(e) => setRef(i, k, e.target.value)} placeholder={r.stage ? 'general' : ''} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ margin: '8px 0 12px' }}>Deja vacía una etapa para que use la referencia general.</p>
        <div className="form-grid">
          {([['soilTempMin', 'T. suelo mínima (°C)'], ['soilTempMax', 'T. suelo máxima (°C)'], ['soilMoistureMin', 'H. suelo mínima (%)'], ['soilMoistureMax', 'H. suelo máxima (%)']] as [keyof typeof soil, string][]).map(([k, l]) => (
            <Field key={k} label={l} htmlFor={`soil-${k}`}><input id={`soil-${k}`} type="text" inputMode="decimal" value={soil[k]} onChange={(e) => setSoil({ ...soil, [k]: e.target.value })} /></Field>
          ))}
          <Field label="Fuente o criterio de los rangos" htmlFor="ref-source" hint="Aparece en el dashboard y en los reportes">
            <input id="ref-source" type="text" value={study.referenceSource} onChange={(e) => setStudy({ ...study, referenceSource: e.target.value })} />
          </Field>
        </div>
        <div className="quick-actions" style={{ marginTop: 12 }}>
          <button className="btn btn-primary btn-sm" onClick={async () => { await saveRefs(); await saveSettings({ referenceSource: study.referenceSource }); }}>Guardar referencias</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirm('refs-reset')}>Restablecer valores de partida</button>
        </div>
      </section>

      <div className="grid-2">
        <div className="stack">
          <section className="card card-pad">
            <h3 className="card-title"><BookOpen size={17} className="text-green" /> Estudio: Climatología Aplicada</h3>
            <div className="form-grid">
              <div className="field span-all">
                <label htmlFor="study-title">Título del estudio</label>
                <textarea id="study-title" value={study.studyTitle} onChange={(e) => setStudy({ ...study, studyTitle: e.target.value })} />
              </div>
              <div className="field span-all">
                <label htmlFor="study-problem">Problema práctico planteado</label>
                <textarea id="study-problem" value={study.studyProblem} onChange={(e) => setStudy({ ...study, studyProblem: e.target.value })} />
              </div>
            </div>
            <div className="quick-actions" style={{ marginTop: 12 }}>
              <button className="btn btn-primary btn-sm" onClick={async () => { await saveSettings(study); toast('Datos del estudio guardados.'); }}>Guardar</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setStudy({ studyTitle: DEFAULT_SETTINGS.studyTitle, studyProblem: DEFAULT_SETTINGS.studyProblem, referenceSource: DEFAULT_SETTINGS.referenceSource })}>Usar texto sugerido</button>
            </div>
          </section>

          <section className="card card-pad">
            <h3 className="card-title"><FlaskConical size={17} className="text-green" /> Modo y fuentes de datos</h3>
            <div className="chips" style={{ marginBottom: 10 }}>
              <button className={`chip ${!isDemo ? 'active' : ''}`} disabled={busy} onClick={() => setMode('real')}>Datos reales</button>
              <button className={`chip ${isDemo ? 'active' : ''}`} disabled={busy} onClick={() => setMode('demo')}>{busy ? 'Generando…' : 'Datos de demostración'}</button>
            </div>
            <p className="small muted" style={{ marginBottom: 10 }}>Los datos de demostración simulan un datalogger (lecturas cada 30 min) y se guardan por separado: nunca se mezclan con los datos reales del invernadero.</p>
            {!isDemo && (
              <>
                <strong className="small">Fuentes incluidas en el análisis</strong>
                {REAL_SOURCES.map((s) => (
                  <div key={s} className="toggle-row">
                    <span>{SOURCE_LABELS[s]}<br /><span className="small muted">{s === 'sensor' ? 'Archivos o lecturas de sensores y dataloggers' : s === 'manual' ? 'Mediciones registradas a mano en la aplicación' : 'Hojas de cálculo con registros previos'}</span></span>
                    <Switch id={`src-${s}`} label={SOURCE_LABELS[s]} checked={settings.sourceFilter.includes(s)} onChange={(v) => { const next = v ? [...settings.sourceFilter, s] : settings.sourceFilter.filter((x) => x !== s); if (next.length) saveSettings({ sourceFilter: next }); }} />
                  </div>
                ))}
              </>
            )}
            {isDemo && (
              <div className="quick-actions" style={{ marginTop: 12 }}>
                <button className="btn btn-secondary btn-sm" disabled={busy} onClick={async () => { setBusy(true); await seedDemoData(); setBusy(false); toast('Datos de demostración regenerados.'); }}>Regenerar demostración</button>
                <button className="btn btn-danger-outline btn-sm" onClick={() => setConfirm('demo-remove')}>Eliminar datos de demostración</button>
              </div>
            )}
          </section>

          <section className="card card-pad">
            <h3 className="card-title">Institución y responsable</h3>
            <div className="form-grid">
              <Field label="Universidad" htmlFor="inst"><input id="inst" type="text" value={general.institution} onChange={(e) => setGeneral({ ...general, institution: e.target.value })} /></Field>
              <Field label="Sede" htmlFor="campus"><input id="campus" type="text" value={general.campus} onChange={(e) => setGeneral({ ...general, campus: e.target.value })} /></Field>
              <Field label="Responsable por defecto" htmlFor="resp"><input id="resp" type="text" value={general.defaultResponsible} onChange={(e) => setGeneral({ ...general, defaultResponsible: e.target.value })} /></Field>
              <Field label="Invernadero por defecto" htmlFor="def-gh">
                <select id="def-gh" value={settings.defaultGreenhouseId ?? ''} onChange={(e) => saveSettings({ defaultGreenhouseId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">—</option>
                  {greenhouses.map((g) => <option key={g.id} value={g.id}>{g.code} · {g.name}</option>)}
                </select>
              </Field>
            </div>
            <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={async () => { await saveSettings(general); toast('Datos guardados.'); }}>Guardar</button>
          </section>

          <section className="card card-pad">
            <h3 className="card-title">Variables registradas por los sensores</h3>
            <p className="small muted" style={{ marginBottom: 4 }}>Temperatura del aire y humedad relativa siempre son obligatorias.</p>
            {OPTIONAL.map((k) => (
              <div key={k} className="toggle-row">
                <span>{VARIABLES[k].label} <span className="muted">({VARIABLES[k].unit})</span></span>
                <Switch id={`opt-${k}`} label={VARIABLES[k].label} checked={settings.optionalFields[k]} onChange={(v) => saveSettings({ optionalFields: { ...settings.optionalFields, [k]: v } })} />
              </div>
            ))}
          </section>
        </div>

        <div className="stack">
          <Esp32SettingsCard />

          <section className="card card-pad">
            <h3 className="card-title">Detección de cambios bruscos y vacíos</h3>
            <div className="form-grid">
              <Field label="Cambio brusco de temperatura (°C)" htmlFor="abr-t" hint="Entre mediciones consecutivas (≤ 3 h)"><input id="abr-t" type="text" inputMode="decimal" value={detect.abruptTempChange} onChange={(e) => setDetect({ ...detect, abruptTempChange: e.target.value })} /></Field>
              <Field label="Cambio brusco de HR (%)" htmlFor="abr-h"><input id="abr-h" type="text" inputMode="decimal" value={detect.abruptHumidityChange} onChange={(e) => setDetect({ ...detect, abruptHumidityChange: e.target.value })} /></Field>
              <Field label="Horas sin datos para considerar vacío" htmlFor="gap-h" hint="Para sensores cada 5–30 min se sugiere 2–6 h"><input id="gap-h" type="text" inputMode="numeric" value={detect.gapHours} onChange={(e) => setDetect({ ...detect, gapHours: e.target.value })} /></Field>
            </div>
            <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={saveDetect}>Guardar</button>
          </section>

          <section className="card card-pad">
            <h3 className="card-title"><Warehouse size={17} className="text-green" /> Invernaderos
              <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setGh({ code: '', name: '', location: '' })}><Plus size={15} /> Agregar</button>
            </h3>
            {greenhouses.map((g) => (
              <div key={g.id} className="toggle-row">
                <span><strong>{g.code}</strong> · {g.name}<br /><span className="small muted">{g.location}</span></span>
                <button className="icon-btn" aria-label="Editar" onClick={() => setGh(g)}><Pencil size={16} /></button>
              </div>
            ))}
          </section>

          <section className="card card-pad">
            <h3 className="card-title">Responsables
              <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setUser({ name: '', role: 'estudiante' })}><Plus size={15} /> Agregar</button>
            </h3>
            {users.length === 0 && <p className="small muted">Agrega estudiantes, docentes o investigadores para seleccionarlos rápido.</p>}
            {users.map((u) => (
              <div key={u.id} className="toggle-row">
                <span>{u.name} <span className="tag">{u.role}</span></span>
                <span>
                  <button className="icon-btn" aria-label="Editar" onClick={() => setUser(u)}><Pencil size={16} /></button>
                  <button className="icon-btn danger" aria-label="Eliminar" onClick={async () => { await db.users.delete(u.id!); toast('Responsable eliminado.'); }}><Trash2 size={16} /></button>
                </span>
              </div>
            ))}
          </section>

          <section className="card card-pad">
            <h3 className="card-title"><Database size={17} className="text-green" /> Respaldo de datos</h3>
            <p className="small muted" style={{ marginBottom: 12 }}>Los datos se guardan en este dispositivo. Descarga un respaldo periódicamente o para pasar los datos a otro equipo.</p>
            <input ref={restoreRef} id="restore-file" type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setConfirm({ restore: f }); e.target.value = ''; }} />
            <div className="quick-actions">
              <button className="btn btn-secondary btn-sm" onClick={exportBackup}>Descargar respaldo (JSON)</button>
              <button className="btn btn-secondary btn-sm" onClick={() => restoreRef.current?.click()}>Restaurar respaldo</button>
            </div>
          </section>

          {!isDemo && (
            <section className="card card-pad" style={{ borderColor: '#f2c3be' }}>
              <h3 className="card-title" style={{ color: 'var(--red)' }}>Zona de riesgo</h3>
              <p className="small muted" style={{ marginBottom: 12 }}>Elimina todos los registros climáticos reales ({realCount}). Descarga un respaldo antes.</p>
              <button className="btn btn-danger-outline btn-sm" disabled={!realCount} onClick={() => { setTyped(''); setConfirm('real-delete'); }}>Eliminar todos los registros reales</button>
            </section>
          )}

          <section className="card card-pad">
            <h3 className="card-title">Acerca de</h3>
            <p className="small muted">
              Clima Invernadero UCACUE v3.0 · Herramienta de Climatología Aplicada: monitoreo, análisis e interpretación del microclima para el cultivo de tomate, y control de las 4 electroválvulas de riego a través del ESP32. No diagnostica enfermedades.
            </p>
          </section>
        </div>
      </div>

      {gh && (
        <Modal title={gh.id ? 'Editar invernadero' : 'Nuevo invernadero'} onClose={() => setGh(null)} footer={<><button className="btn btn-ghost" onClick={() => setGh(null)}>Cancelar</button><button className="btn btn-primary" onClick={saveGh}>Guardar</button></>}>
          <div className="form-grid">
            <Field label="Código" htmlFor="gh-code" required><input id="gh-code" type="text" value={gh.code ?? ''} onChange={(e) => setGh({ ...gh, code: e.target.value })} placeholder="INV-UCACUE-02" /></Field>
            <Field label="Nombre" htmlFor="gh-name" required><input id="gh-name" type="text" value={gh.name ?? ''} onChange={(e) => setGh({ ...gh, name: e.target.value })} /></Field>
            <Field label="Ubicación" htmlFor="gh-loc"><input id="gh-loc" type="text" value={gh.location ?? ''} onChange={(e) => setGh({ ...gh, location: e.target.value })} /></Field>
            <Field label="Área (m²)" htmlFor="gh-area"><input id="gh-area" type="text" inputMode="decimal" value={gh.areaM2 ?? ''} onChange={(e) => setGh({ ...gh, areaM2: parseNumber(e.target.value) })} /></Field>
            <Field label="Tipo de cubierta" htmlFor="gh-cover"><input id="gh-cover" type="text" value={gh.coverType ?? ''} onChange={(e) => setGh({ ...gh, coverType: e.target.value })} placeholder="Polietileno" /></Field>
          </div>
        </Modal>
      )}

      {user && (
        <Modal title={user.id ? 'Editar responsable' : 'Nuevo responsable'} onClose={() => setUser(null)} footer={<><button className="btn btn-ghost" onClick={() => setUser(null)}>Cancelar</button><button className="btn btn-primary" onClick={saveUser}>Guardar</button></>}>
          <div className="form-grid">
            <Field label="Nombre" htmlFor="u-name" required><input id="u-name" type="text" value={user.name ?? ''} onChange={(e) => setUser({ ...user, name: e.target.value })} /></Field>
            <Field label="Rol" htmlFor="u-role">
              <select id="u-role" value={user.role} onChange={(e) => setUser({ ...user, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
            </Field>
            <Field label="Correo (opcional)" htmlFor="u-mail"><input id="u-mail" type="email" value={user.email ?? ''} onChange={(e) => setUser({ ...user, email: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {confirm === 'refs-reset' && (
        <ConfirmModal title="Restablecer referencias" confirmLabel="Restablecer" danger={false} message="Se reemplazarán las referencias generales y por etapa del tomate por los valores de partida. Los rangos propios de cada cultivo no cambian." onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await db.climateThresholds.bulkDelete(refThresholds.map((t) => t.id!));
            await db.climateThresholds.bulkAdd(tomatoThresholds(isDemo));
            toast('Referencias restablecidas.');
          }} />
      )}
      {confirm === 'demo-remove' && (
        <ConfirmModal title="Eliminar datos de demostración" message="Se eliminarán todos los datos simulados y volverás al modo de datos reales. Los registros reales no se modifican." onClose={() => setConfirm(null)}
          onConfirm={async () => { await saveSettings({ dataMode: 'real' }); await removeDemoData(); toast('Datos de demostración eliminados.'); }} />
      )}
      {confirm && typeof confirm === 'object' && (
        <ConfirmModal title="Restaurar respaldo" confirmLabel="Restaurar" message={<>Se reemplazarán <strong>todos</strong> los datos actuales de este dispositivo por el contenido de «{confirm.restore.name}». ¿Continuar?</>} onClose={() => setConfirm(null)} onConfirm={() => restoreBackup(confirm.restore)} />
      )}
      {confirm === 'real-delete' && (
        <Modal title="Eliminar todos los registros reales" onClose={() => setConfirm(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setConfirm(null)}>Cancelar</button><button className="btn btn-danger" disabled={typed !== 'ELIMINAR'} onClick={async () => { await db.climateRecords.filter((r) => !r.isDemo).delete(); setConfirm(null); toast('Registros reales eliminados.'); }}>Eliminar definitivamente</button></>}>
          <p style={{ marginBottom: 12 }}>Esta acción borra {realCount} registros y no se puede deshacer. Escribe <strong>ELIMINAR</strong> para confirmar.</p>
          <input id="confirm-delete" type="text" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Modal>
      )}
    </>
  );
}
