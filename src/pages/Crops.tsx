import { Pencil, Plus, Sprout, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmModal, EmptyState, Field, Modal, PageHeader } from '../components/ui';
import { db } from '../db/db';
import { PHENOLOGICAL_STAGES, TOMATO_STAGES, type ClimateThreshold, type Crop, type StageChange } from '../db/types';
import { stageForDate } from '../lib/agro';
import { addDays, daysBetween, fmtDate, todayISO } from '../lib/dates';
import { summarize } from '../lib/stats';
import { parseNumber } from '../lib/validation';
import { fmt } from '../lib/variables';
import { useData } from '../state/DataContext';
import { useToast } from '../state/Toast';

// Valores referenciales de partida para rangos propios del cultivo (opcionales).
const PRESETS: Record<string, [number, number, number, number]> = {
  Tomate: [15, 30, 60, 85],
  'Tomate cherry': [16, 30, 60, 85],
  'Tomate riñón': [15, 30, 60, 85],
};

interface CropForm {
  name: string; variety: string; sowingDate: string; transplantDate: string; greenhouseId: string; active: boolean; notes: string;
  stageHistory: StageChange[];
  ownRange: boolean;
  tempMin: string; tempMax: string; humidityMin: string; humidityMax: string;
}

export default function Crops() {
  const { ready, crops, greenhouses, greenhouseById, thresholds, allRecords, isDemo } = useData();
  const toast = useToast();
  const [editing, setEditing] = useState<Crop | 'new' | null>(null);
  const [form, setForm] = useState<CropForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toDelete, setToDelete] = useState<Crop | null>(null);
  const [applyStages, setApplyStages] = useState(true);

  if (!ready) return <div className="loading">Cargando…</div>;

  const general = thresholds.find((t) => t.cropId === null && !t.stage);

  const open = (c: Crop | 'new') => {
    const th = c === 'new' ? undefined : thresholds.find((t) => t.cropId === c.id && !t.stage);
    const base = th ?? general;
    setEditing(c);
    setErrors({});
    setForm({
      name: c === 'new' ? 'Tomate' : c.name, variety: c === 'new' ? '' : c.variety ?? '', sowingDate: c === 'new' ? '' : c.sowingDate ?? '',
      transplantDate: c === 'new' ? '' : c.transplantDate ?? '',
      stageHistory: c === 'new' ? [{ stage: 'Semillero', from: todayISO() }] : c.stageHistory?.length ? c.stageHistory : [{ stage: c.stage, from: c.transplantDate || c.sowingDate || todayISO() }],
      greenhouseId: String(c === 'new' ? greenhouses[0]?.id ?? '' : c.greenhouseId), active: c === 'new' ? true : c.active, notes: c === 'new' ? '' : c.notes ?? '',
      ownRange: !!th,
      tempMin: String(base?.tempMin ?? 15), tempMax: String(base?.tempMax ?? 30), humidityMin: String(base?.humidityMin ?? 60), humidityMax: String(base?.humidityMax ?? 85),
    });
  };

  const set = <K extends keyof CropForm>(k: K, v: CropForm[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const setStage = (i: number, patch: Partial<StageChange>) => form && set('stageHistory', form.stageHistory.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  async function save() {
    if (!form || !editing) return;
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Indica el nombre del cultivo.';
    if (!form.greenhouseId) e.greenhouseId = 'Selecciona el invernadero.';
    if (form.sowingDate && form.transplantDate && form.transplantDate < form.sowingDate) e.transplantDate = 'El trasplante no puede ser anterior a la siembra.';
    const history = form.stageHistory.filter((s) => s.stage.trim() && s.from).sort((a, b) => (a.from < b.from ? -1 : 1));
    if (!history.length) e.stages = 'Registra al menos una etapa con su fecha de inicio.';
    if (new Set(history.map((s) => s.from)).size !== history.length) e.stages = 'Dos etapas no pueden empezar el mismo día.';
    const [tMin, tMax, hMin, hMax] = [form.tempMin, form.tempMax, form.humidityMin, form.humidityMax].map(parseNumber);
    if (form.ownRange) {
      if (![tMin, tMax].every((v) => typeof v === 'number' && !Number.isNaN(v) && v >= -10 && v <= 60)) e.temp = 'Temperaturas entre -10 y 60 °C.';
      else if (tMin! >= tMax!) e.temp = 'La mínima debe ser menor que la máxima.';
      if (![hMin, hMax].every((v) => typeof v === 'number' && !Number.isNaN(v) && v >= 0 && v <= 100)) e.hum = 'Humedad entre 0 y 100 %.';
      else if (hMin! >= hMax!) e.hum = 'La mínima debe ser menor que la máxima.';
    }
    setErrors(e);
    if (Object.keys(e).length) return;

    const data: Crop = {
      name: form.name.trim(), variety: form.variety.trim(), sowingDate: form.sowingDate || undefined, transplantDate: form.transplantDate || undefined,
      stageHistory: history, stage: stageForDate({ stage: history.at(-1)!.stage, stageHistory: history } as Crop, todayISO()) || history.at(-1)!.stage,
      greenhouseId: Number(form.greenhouseId), active: form.active, notes: form.notes.trim(),
      isDemo: editing === 'new' ? isDemo : editing.isDemo, createdAt: editing === 'new' ? Date.now() : editing.createdAt,
    };
    let cropId: number;
    if (editing === 'new') cropId = (await db.crops.add(data)) as number;
    else {
      cropId = editing.id!;
      await db.crops.put({ ...data, id: cropId });
    }
    const existing = thresholds.find((t) => t.cropId === cropId && !t.stage);
    if (form.ownRange) {
      const th: ClimateThreshold = {
        ...(existing ?? { soilTempMin: null, soilTempMax: null, soilMoistureMin: null, soilMoistureMax: null }),
        cropId, stage: null, label: `${data.name}${data.variety ? ` (${data.variety})` : ''}`, tempMin: tMin!, tempMax: tMax!, humidityMin: hMin!, humidityMax: hMax!, isDemo: data.isDemo,
      };
      if (existing) await db.climateThresholds.put({ ...th, id: existing.id });
      else await db.climateThresholds.add(th);
    } else if (existing) await db.climateThresholds.delete(existing.id!);

    let updated = 0;
    if (applyStages) {
      const full = { ...data, id: cropId };
      await db.climateRecords
        .where('cropId')
        .equals(cropId)
        .modify((r) => {
          const s = stageForDate(full, r.date);
          if (s && r.phenologicalStage !== s) {
            r.phenologicalStage = s;
            updated++;
          }
        });
    }
    toast(`${editing === 'new' ? 'Cultivo registrado' : 'Cultivo actualizado'}${updated ? `; etapa actualizada en ${updated} registros` : ''}.`);
    setEditing(null);
  }

  const since = (d?: string) => (d ? `${daysBetween(d, todayISO())} días` : '—');

  return (
    <>
      <PageHeader
        title="Cultivo de tomate"
        description="Relaciona los datos climáticos con el cultivo y su etapa fenológica."
        icon={<Sprout size={22} />}
        actions={<button className="btn btn-primary" onClick={() => open('new')}><Plus size={17} /> Nuevo ciclo de cultivo</button>}
      />

      <div className="notice info" style={{ marginBottom: 16 }}>
        <Sprout size={18} />
        <span>
          Cada cultivo tiene una <strong>cronología de etapas</strong> (semillero, crecimiento vegetativo, floración, fructificación, maduración). La aplicación asigna la etapa a cada registro según su fecha, para comparar las condiciones climáticas entre etapas. Los rangos de referencia por etapa se configuran en <Link to="/configuracion">Configuración</Link>.
        </span>
      </div>

      {crops.length === 0 ? (
        <EmptyState icon={<Sprout size={30} />} title="No hay cultivos registrados" action={<button className="btn btn-primary" onClick={() => open('new')}><Plus size={17} /> Registrar cultivo de tomate</button>}>
          Registra el ciclo de tomate del invernadero para asociarlo a los datos climáticos.
        </EmptyState>
      ) : (
        <div className="grid-3">
          {[...crops].sort((a, b) => Number(b.active) - Number(a.active)).map((c) => {
            const recs = allRecords.filter((r) => r.cropId === c.id && r.validation !== 'descartado');
            const last = recs[recs.length - 1];
            const recent = last ? recs.filter((r) => r.date >= addDays(last.date, -6)) : [];
            const t = summarize(recent, 'airTemp');
            const h = summarize(recent, 'relHumidity');
            const own = thresholds.find((x) => x.cropId === c.id && !x.stage);
            const history = [...(c.stageHistory ?? [])].sort((a, b) => (a.from < b.from ? -1 : 1));
            return (
              <article key={c.id} className="card crop-card">
                <header>
                  <div>
                    <h3>{c.name}</h3>
                    <span className="muted small">{c.variety || 'Variedad no especificada'}</span>
                  </div>
                  <span className={`tag ${c.active ? 'green' : ''}`}>{c.active ? 'Activo' : 'Finalizado'}</span>
                </header>
                <dl className="crop-meta">
                  <div><dt>Etapa actual</dt><dd>{stageForDate(c, todayISO()) || c.stage}</dd></div>
                  <div><dt>Invernadero</dt><dd>{greenhouseById.get(c.greenhouseId)?.code ?? '—'}</dd></div>
                  <div><dt>Siembra</dt><dd>{c.sowingDate ? `${fmtDate(c.sowingDate)} · ${since(c.sowingDate)}` : '—'}</dd></div>
                  <div><dt>Trasplante</dt><dd>{c.transplantDate ? `${fmtDate(c.transplantDate)} · ${since(c.transplantDate)}` : '—'}</dd></div>
                  <div><dt>Rango</dt><dd>{own ? `${fmt(own.tempMin)}–${fmt(own.tempMax)} °C · ${fmt(own.humidityMin, 0)}–${fmt(own.humidityMax, 0)} %` : 'Referencias del tomate por etapa'}</dd></div>
                </dl>
                {history.length > 0 && (
                  <div className="small">
                    <strong className="muted" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.03em' }}>Cronología de etapas</strong>
                    <ul className="conclusions" style={{ gap: 2, marginTop: 4 }}>{history.map((s, i) => <li key={i}>{s.stage} · desde {fmtDate(s.from)}</li>)}</ul>
                  </div>
                )}
                <div className="kpi-row" style={{ marginTop: 0 }}>
                  <span className="kpi">Registros <b>{recs.length}</b></span>
                  {t.n > 0 && <span className="kpi">T. prom 7 días <b>{fmt(t.mean)} °C</b></span>}
                  {h.n > 0 && <span className="kpi">HR prom 7 días <b>{fmt(h.mean, 0)} %</b></span>}
                </div>
                {c.notes && <p className="small muted">{c.notes}</p>}
                <div className="quick-actions" style={{ marginTop: 'auto' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => open(c)}><Pencil size={15} /> Editar</button>
                  <button className="btn btn-danger-outline btn-sm" onClick={() => setToDelete(c)}><Trash2 size={15} /> Eliminar</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editing && form && (
        <Modal
          title={editing === 'new' ? 'Nuevo ciclo de cultivo' : `Editar ${editing.name}`}
          onClose={() => setEditing(null)}
          wide
          footer={<><button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar</button></>}
        >
          <div className="form-grid">
            <Field label="Cultivo" htmlFor="crop-name" error={errors.name} required>
              <input id="crop-name" type="text" list="crop-names" value={form.name} onChange={(e) => set('name', e.target.value)} />
              <datalist id="crop-names">{Object.keys(PRESETS).map((p) => <option key={p} value={p} />)}</datalist>
            </Field>
            <Field label="Variedad" htmlFor="crop-variety"><input id="crop-variety" type="text" value={form.variety} onChange={(e) => set('variety', e.target.value)} placeholder="Pietro, Dominique…" /></Field>
            <Field label="Invernadero" htmlFor="crop-gh" error={errors.greenhouseId} required>
              <select id="crop-gh" value={form.greenhouseId} onChange={(e) => set('greenhouseId', e.target.value)}>
                {greenhouses.map((g) => <option key={g.id} value={g.id}>{g.code} · {g.name}</option>)}
              </select>
            </Field>
            <Field label="Fecha de siembra" htmlFor="crop-sow"><input id="crop-sow" type="date" value={form.sowingDate} onChange={(e) => set('sowingDate', e.target.value)} /></Field>
            <Field label="Fecha de trasplante" htmlFor="crop-tr" error={errors.transplantDate}><input id="crop-tr" type="date" value={form.transplantDate} onChange={(e) => set('transplantDate', e.target.value)} /></Field>
          </div>

          <h3 style={{ fontSize: 14.5, margin: '18px 0 8px' }}>Cronología de etapas fenológicas</h3>
          {errors.stages && <p className="field-error" style={{ marginBottom: 8 }}>{errors.stages}</p>}
          <div className="stage-timeline">
            {form.stageHistory.map((s, i) => (
              <div key={i} className="stage-row">
                <select id={`stage-${i}`} aria-label="Etapa" value={s.stage} onChange={(e) => setStage(i, { stage: e.target.value })}>
                  {[...new Set([...TOMATO_STAGES, ...PHENOLOGICAL_STAGES, s.stage])].map((st) => <option key={st}>{st}</option>)}
                </select>
                <input id={`stage-from-${i}`} aria-label="Inicio" type="date" value={s.from} onChange={(e) => setStage(i, { from: e.target.value })} />
                <button className="icon-btn danger" aria-label="Quitar etapa" onClick={() => set('stageHistory', form.stageHistory.filter((_, j) => j !== i))}><X size={16} /></button>
              </div>
            ))}
          </div>
          <button
            className="btn btn-secondary btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => {
              const last = form.stageHistory.at(-1);
              const nextStage = TOMATO_STAGES[Math.min(TOMATO_STAGES.indexOf((last?.stage ?? 'Semillero') as never) + 1, TOMATO_STAGES.length - 1)];
              set('stageHistory', [...form.stageHistory, { stage: nextStage, from: todayISO() }]);
            }}
          >
            <Plus size={15} /> Agregar cambio de etapa
          </button>
          <label className="check"><input id="apply-stages" type="checkbox" checked={applyStages} onChange={(e) => setApplyStages(e.target.checked)} /> Actualizar la etapa de los registros existentes de este cultivo según la cronología</label>

          <h3 style={{ fontSize: 14.5, margin: '18px 0 8px' }}>Rango de referencia</h3>
          <label className="check"><input id="own-range" type="checkbox" checked={form.ownRange} onChange={(e) => set('ownRange', e.target.checked)} /> Usar un rango propio para este cultivo (en lugar de las referencias del tomate por etapa)</label>
          {form.ownRange && (
            <div className="form-grid">
              <Field label="Temperatura mínima (°C)" htmlFor="c-tmin" error={errors.temp}><input id="c-tmin" type="text" inputMode="decimal" value={form.tempMin} onChange={(e) => set('tempMin', e.target.value)} /></Field>
              <Field label="Temperatura máxima (°C)" htmlFor="c-tmax"><input id="c-tmax" type="text" inputMode="decimal" value={form.tempMax} onChange={(e) => set('tempMax', e.target.value)} /></Field>
              <Field label="HR mínima (%)" htmlFor="c-hmin" error={errors.hum}><input id="c-hmin" type="text" inputMode="decimal" value={form.humidityMin} onChange={(e) => set('humidityMin', e.target.value)} /></Field>
              <Field label="HR máxima (%)" htmlFor="c-hmax"><input id="c-hmax" type="text" inputMode="decimal" value={form.humidityMax} onChange={(e) => set('humidityMax', e.target.value)} /></Field>
            </div>
          )}

          <div className="form-grid" style={{ marginTop: 12 }}>
            <div className="field span-all"><label htmlFor="crop-notes">Observaciones</label><textarea id="crop-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
            <label className="check span-all"><input id="crop-active" type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Cultivo activo (aparece en registro e importación)</label>
          </div>
        </Modal>
      )}

      {toDelete && (() => {
        const n = allRecords.filter((r) => r.cropId === toDelete.id).length;
        return (
          <ConfirmModal
            title="Eliminar cultivo"
            message={n ? <>El cultivo <strong>{toDelete.name}</strong> tiene {n} registros asociados. Los registros climáticos se conservarán, pero quedarán sin cultivo. Si el ciclo terminó, considera marcarlo como finalizado.</> : <>¿Eliminar el cultivo <strong>{toDelete.name}</strong>?</>}
            onClose={() => setToDelete(null)}
            onConfirm={async () => {
              await db.transaction('rw', [db.crops, db.climateRecords, db.climateThresholds], async () => {
                await db.climateRecords.where('cropId').equals(toDelete.id!).modify({ cropId: null });
                await db.climateThresholds.where('cropId').equals(toDelete.id!).delete();
                await db.crops.delete(toDelete.id!);
              });
              toast('Cultivo eliminado.');
            }}
          />
        );
      })()}
    </>
  );
}
