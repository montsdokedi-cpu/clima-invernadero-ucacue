import { CalendarDays, ClipboardPen, Cpu, Info, Leaf, Save, Thermometer, Upload } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertItem, Field, PageHeader } from '../components/ui';
import { db } from '../db/db';
import {
  MEASUREMENT_METHODS,
  OUTSIDE_WEATHER,
  PHENOLOGICAL_STAGES,
  VALIDATION_LABELS,
  type ClimateRecord,
  type DataValidation,
  type RecordSource,
} from '../db/types';
import { stageForDate } from '../lib/agro';
import { recordAlerts, thresholdFor } from '../lib/alerts';
import { nowTime, todayISO, toTimestamp } from '../lib/dates';
import { assessRecord, parseNumber, validateRecord } from '../lib/validation';
import { ALL_KEYS, enabledVariables, isNum, VARIABLES, type NumericKey } from '../lib/variables';
import { useData } from '../state/DataContext';
import { useToast } from '../state/Toast';

type FormState = {
  date: string;
  time: string;
  greenhouseId: string;
  cropId: string;
  phenologicalStage: string;
  recordedBy: string;
  method: string;
  outsideWeather: string;
  observations: string;
  cropObservations: string;
  source: RecordSource;
  sensorId: string;
  validation: DataValidation;
  validationNote: string;
} & Record<NumericKey, string>;

const STICKY_KEY = 'clima-ucc-ultimo-formulario';
const PLACEHOLDERS: Partial<Record<NumericKey, string>> = {
  airTemp: '22.5', relHumidity: '78', soilTemp: '21', soilMoisture: '65', luminosity: '25000', solarRadiation: '450', windSpeed: '0.8', precipitation: '0', outsideTemp: '19.5', outsideHumidity: '85',
};

const blankNumbers = () => Object.fromEntries(ALL_KEYS.map((k) => [k, ''])) as Record<NumericKey, string>;

function emptyForm(defaults: Partial<FormState>): FormState {
  return {
    date: todayISO(), time: nowTime(), greenhouseId: '', cropId: '', phenologicalStage: '', recordedBy: '', method: 'Termohigrómetro digital',
    outsideWeather: '', observations: '', cropObservations: '', source: 'manual', sensorId: '', validation: 'valido', validationNote: '',
    ...blankNumbers(), ...defaults,
  };
}

function loadSticky(): Partial<FormState> {
  try {
    return JSON.parse(localStorage.getItem(STICKY_KEY) || '{}');
  } catch {
    return {};
  }
}

export default function RecordForm() {
  const { id } = useParams();
  const editId = id ? Number(id) : undefined;
  const navigate = useNavigate();
  const toast = useToast();
  const { ready, settings, greenhouses, crops, thresholds, users, isDemo, cropById } = useData();
  const [form, setForm] = useState<FormState>(() => emptyForm(loadSticky()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [original, setOriginal] = useState<ClimateRecord | null>(null);

  useEffect(() => {
    if (!editId) return;
    db.climateRecords.get(editId).then((r) => {
      if (!r) {
        toast('No se encontró el registro.', 'error');
        navigate('/historial');
        return;
      }
      setOriginal(r);
      const nums = Object.fromEntries(ALL_KEYS.map((k) => [k, isNum(r[k]) ? String(r[k]) : '']));
      setForm({
        date: r.date, time: r.time, greenhouseId: String(r.greenhouseId), cropId: r.cropId ? String(r.cropId) : '',
        phenologicalStage: r.phenologicalStage ?? '', recordedBy: r.recordedBy ?? '', method: r.method ?? '', outsideWeather: r.outsideWeather ?? '',
        observations: r.observations ?? '', cropObservations: r.cropObservations ?? '', source: r.source, sensorId: r.sensorId ?? '',
        validation: r.validation ?? 'valido', validationNote: r.validationNote ?? '', ...(nums as Record<NumericKey, string>),
      });
    });
  }, [editId, navigate, toast]);

  useEffect(() => {
    if (!ready || editId) return;
    setForm((f) => {
      const ghValid = greenhouses.some((g) => String(g.id) === f.greenhouseId);
      const greenhouseId = ghValid ? f.greenhouseId : String(greenhouses.find((g) => g.id === settings.defaultGreenhouseId)?.id ?? greenhouses[0]?.id ?? '');
      const cropValid = crops.some((c) => String(c.id) === f.cropId && String(c.greenhouseId) === greenhouseId);
      const firstCrop = crops.find((c) => c.active && String(c.greenhouseId) === greenhouseId);
      const cropId = cropValid ? f.cropId : String(firstCrop?.id ?? '');
      const crop = cropById.get(Number(cropId));
      return {
        ...f,
        greenhouseId,
        cropId,
        source: isDemo ? 'demo' : f.source === 'demo' ? 'manual' : f.source,
        phenologicalStage: stageForDate(crop, f.date) || f.phenologicalStage,
        recordedBy: f.recordedBy || settings.defaultResponsible,
      };
    });
  }, [ready, isDemo, greenhouses, crops, settings.defaultGreenhouseId, settings.defaultResponsible, editId, cropById]);

  const set = (k: keyof FormState, v: string) => {
    setForm((f) => {
      const next = { ...f, [k]: v } as FormState;
      // La etapa se deduce de la cronología del cultivo al cambiar fecha o cultivo
      if (k === 'date' || k === 'cropId') {
        const stage = stageForDate(cropById.get(Number(next.cropId)), next.date);
        if (stage) next.phenologicalStage = stage;
      }
      return next;
    });
    if (errors[k]) setErrors((e) => ({ ...e, [k]: '' }));
  };

  const visibleVars = useMemo(() => {
    const enabled = enabledVariables(settings.optionalFields).map((v) => v.key);
    return ALL_KEYS.filter((k) => enabled.includes(k) || (original && isNum(original[k])));
  }, [settings.optionalFields, original]);

  const cropOptions = crops.filter((c) => String(c.greenhouseId) === form.greenhouseId && (c.active || String(c.id) === form.cropId));

  const liveAlerts = useMemo(() => {
    const t = parseNumber(form.airTemp);
    const h = parseNumber(form.relHumidity);
    if (!isNum(t) || !isNum(h)) return [];
    const draft = {
      id: 0, date: form.date, time: form.time, ts: 0, cropId: form.cropId ? Number(form.cropId) : null, phenologicalStage: form.phenologicalStage,
      airTemp: t, relHumidity: h, soilTemp: parseNumber(form.soilTemp) ?? null, soilMoisture: parseNumber(form.soilMoisture) ?? null,
    } as ClimateRecord;
    return recordAlerts(draft, thresholdFor(draft, thresholds));
  }, [form.airTemp, form.relHumidity, form.soilTemp, form.soilMoisture, form.cropId, form.phenologicalStage, form.date, form.time, thresholds]);

  async function submit(e: FormEvent, again = false) {
    e.preventDefault();
    const { errors: errs, values } = validateRecord(form);
    if (!form.greenhouseId) errs.greenhouseId = 'Selecciona el invernadero.';
    if (form.source === 'sensor' && !form.sensorId.trim()) errs.sensorId = 'Indica el identificador del sensor para datos de origen «Sensor».';
    if (Object.keys(errs).length === 0) {
      const dup = await db.climateRecords
        .where('[greenhouseId+date+time]')
        .equals([Number(form.greenhouseId), form.date, form.time])
        .filter((r) => r.isDemo === isDemo && r.id !== editId)
        .count();
      if (dup) errs.time = 'Ya existe un registro para este invernadero en la misma fecha y hora.';
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast('Revisa los campos marcados en rojo.', 'error');
      document.querySelector('.has-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setSaving(true);
    const now = Date.now();
    let validation = form.validation;
    let validationNote = form.validationNote.trim();
    if (validation === 'valido') {
      const auto = assessRecord({ airTemp: values.airTemp!, relHumidity: values.relHumidity!, soilMoisture: values.soilMoisture ?? null });
      if (auto.validation === 'sospechoso') {
        validation = 'sospechoso';
        validationNote = auto.note;
      }
    }
    const record: ClimateRecord = {
      ...(original ?? {}),
      date: form.date,
      time: form.time,
      ts: toTimestamp(form.date, form.time),
      greenhouseId: Number(form.greenhouseId),
      cropId: form.cropId ? Number(form.cropId) : null,
      airTemp: values.airTemp!,
      relHumidity: values.relHumidity!,
      soilTemp: values.soilTemp ?? null,
      soilMoisture: values.soilMoisture ?? null,
      luminosity: values.luminosity ?? null,
      solarRadiation: values.solarRadiation ?? null,
      windSpeed: values.windSpeed ?? null,
      precipitation: values.precipitation ?? null,
      outsideTemp: values.outsideTemp ?? null,
      outsideHumidity: values.outsideHumidity ?? null,
      airTemp1: values.airTemp1 ?? null,
      relHumidity1: values.relHumidity1 ?? null,
      airTemp2: values.airTemp2 ?? null,
      relHumidity2: values.relHumidity2 ?? null,
      soilMoisture1: values.soilMoisture1 ?? null,
      soilMoisture2: values.soilMoisture2 ?? null,
      soilMoisture3: values.soilMoisture3 ?? null,
      soilMoisture4: values.soilMoisture4 ?? null,
      phenologicalStage: form.phenologicalStage.trim(),
      recordedBy: form.recordedBy.trim(),
      method: form.method,
      outsideWeather: form.outsideWeather,
      observations: form.observations.trim(),
      cropObservations: form.cropObservations.trim(),
      source: isDemo && !original ? 'demo' : form.source,
      sensorId: form.sensorId.trim() || null,
      validation,
      validationNote,
      isDemo: original?.isDemo ?? isDemo,
      createdAt: original?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      if (editId) await db.climateRecords.put({ ...record, id: editId });
      else await db.climateRecords.add(record);
      try {
        localStorage.setItem(STICKY_KEY, JSON.stringify({ greenhouseId: form.greenhouseId, cropId: form.cropId, recordedBy: form.recordedBy, method: form.method, source: form.source, sensorId: form.sensorId }));
      } catch {
        /* sin almacenamiento */
      }
      toast(`${editId ? 'Registro actualizado' : 'Registro guardado'}${validation === 'sospechoso' ? ' y marcado como sospechoso para revisión' : ''}.`);
      if (again) {
        setForm((f) => ({ ...f, ...blankNumbers(), observations: '', cropObservations: '', validation: 'valido', validationNote: '', time: nowTime() }));
        window.scrollTo({ top: 0, behavior: 'smooth' });
        (document.getElementById('airTemp') as HTMLInputElement | null)?.focus();
      } else navigate(editId ? '/historial' : '/');
    } catch (err) {
      toast(`No se pudo guardar: ${(err as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!ready) return <div className="loading">Cargando…</div>;

  const numberField = (k: NumericKey) => {
    const def = VARIABLES[k];
    const required = k === 'airTemp' || k === 'relHumidity';
    return (
      <Field key={k} label={def.label} htmlFor={k} error={errors[k]} required={required} hint={required ? undefined : 'Opcional'}>
        <div className="input-unit">
          <input id={k} type="text" inputMode="decimal" autoComplete="off" placeholder={PLACEHOLDERS[k]} value={form[k]} onChange={(e) => set(k, e.target.value)} />
          <span>{def.unit}</span>
        </div>
      </Field>
    );
  };

  return (
    <>
      <PageHeader
        title={editId ? 'Editar registro' : 'Registrar datos'}
        description={editId ? 'Modifica los valores, el origen o el estado de validación.' : 'Registro manual o transcripción de la lectura de un sensor. Para archivos del datalogger usa Importar.'}
        icon={<ClipboardPen size={22} />}
        actions={!editId && <Link to="/importar" className="btn btn-secondary"><Upload size={17} /> Importar datos de sensores</Link>}
      />

      {isDemo && !editId && (
        <div className="notice warn" style={{ marginBottom: 16 }}>
          <Info size={18} />
          <span>Estás en <strong>modo demostración</strong>: este registro se guardará como dato de demostración y no se mezclará con los datos reales.</span>
        </div>
      )}

      <form className="card" onSubmit={(e) => submit(e)} noValidate>
        <div className="form-section">
          <h3><CalendarDays size={17} className="text-green" /> Fecha, hora y origen</h3>
          <div className="form-grid">
            <Field label="Fecha" htmlFor="date" error={errors.date} required>
              <input id="date" type="date" max={todayISO()} value={form.date} onChange={(e) => set('date', e.target.value)} />
            </Field>
            <Field label="Hora" htmlFor="time" error={errors.time} required>
              <input id="time" type="time" value={form.time} onChange={(e) => set('time', e.target.value)} />
            </Field>
            <Field label="Invernadero" htmlFor="greenhouseId" error={errors.greenhouseId} required>
              <select id="greenhouseId" value={form.greenhouseId} onChange={(e) => { set('greenhouseId', e.target.value); set('cropId', ''); }}>
                <option value="">Selecciona…</option>
                {greenhouses.map((g) => <option key={g.id} value={g.id}>{g.code} · {g.name}</option>)}
              </select>
            </Field>
            {!isDemo && (
              <Field label="Origen del dato" htmlFor="source" required hint={form.source === 'sensor' ? 'Lectura tomada del display o memoria de un sensor' : 'Medición realizada por una persona'}>
                <select id="source" value={form.source} onChange={(e) => set('source', e.target.value)}>
                  <option value="manual">Manual</option>
                  <option value="sensor">Sensor</option>
                  {original?.source === 'importado' && <option value="importado">Importado</option>}
                </select>
              </Field>
            )}
            <Field label="Identificador del sensor" htmlFor="sensorId" error={errors.sensorId} hint={form.source === 'sensor' ? undefined : 'Opcional'}>
              <input id="sensorId" type="text" value={form.sensorId} onChange={(e) => set('sensorId', e.target.value)} placeholder="SHT31-01" />
            </Field>
          </div>
        </div>

        <div className="form-section">
          <h3><Thermometer size={17} className="text-green" /> Variables climáticas</h3>
          <div className="form-grid">{visibleVars.map(numberField)}</div>
          {liveAlerts.length > 0 && (
            <div className="alert-list" style={{ marginTop: 14 }}>
              {liveAlerts.map((a) => <AlertItem key={a.id} alert={a} compact />)}
            </div>
          )}
          <p className="small muted" style={{ marginTop: 10 }}>
            Puedes usar punto o coma decimal. Activa más variables (radiación, temperatura exterior, etc.) en <Link to="/configuracion">Configuración</Link>.
          </p>
        </div>

        <div className="form-section">
          <h3><Leaf size={17} className="text-green" /> Cultivo y observaciones de campo</h3>
          <div className="form-grid">
            <Field label="Cultivo" htmlFor="cropId" hint={cropOptions.length === 0 ? <Link to="/cultivos">Registrar el cultivo de tomate</Link> : undefined}>
              <select id="cropId" value={form.cropId} onChange={(e) => set('cropId', e.target.value)}>
                <option value="">Sin cultivo asociado</option>
                {cropOptions.map((c) => <option key={c.id} value={c.id}>{c.name}{c.variety ? ` (${c.variety})` : ''}</option>)}
              </select>
            </Field>
            <Field label="Etapa fenológica" htmlFor="stage" hint="Se completa según la cronología del cultivo">
              <input id="stage" type="text" list="stages" value={form.phenologicalStage} onChange={(e) => set('phenologicalStage', e.target.value)} placeholder="Floración" />
              <datalist id="stages">{PHENOLOGICAL_STAGES.map((s) => <option key={s} value={s} />)}</datalist>
            </Field>
            <Field label="Responsable" htmlFor="recordedBy">
              <input id="recordedBy" type="text" list="users" value={form.recordedBy} onChange={(e) => set('recordedBy', e.target.value)} placeholder="Nombre y apellido" />
              <datalist id="users">{users.map((u) => <option key={u.id} value={u.name} />)}</datalist>
            </Field>
            <Field label="Método de medición" htmlFor="method">
              <select id="method" value={form.method} onChange={(e) => set('method', e.target.value)}>
                <option value="">—</option>
                {MEASUREMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
            <div className="field span-all">
              <label>Estado del clima exterior</label>
              <div className="chips">
                {OUTSIDE_WEATHER.map((w) => (
                  <button type="button" key={w} className={`chip chip-blue ${form.outsideWeather === w ? 'active' : ''}`} onClick={() => set('outsideWeather', form.outsideWeather === w ? '' : w)}>{w}</button>
                ))}
              </div>
            </div>
            <Field label="Observaciones de manejo" htmlFor="obs">
              <textarea id="obs" value={form.observations} onChange={(e) => set('observations', e.target.value)} placeholder="Ej. Cortinas laterales abiertas a las 10:00." />
            </Field>
            <Field label="Observaciones del cultivo (campo)" htmlFor="cropObs">
              <textarea id="cropObs" value={form.cropObservations} onChange={(e) => set('cropObservations', e.target.value)} placeholder="Ej. Flores abiertas en el 30 % de plantas; sin síntomas visibles." />
            </Field>
          </div>
        </div>

        <div className="form-section">
          <h3><Cpu size={17} className="text-green" /> Validación del dato</h3>
          <div className="form-grid">
            <Field label="Estado de validación" htmlFor="validation" hint="Los datos descartados se conservan pero no se usan en el análisis">
              <select id="validation" value={form.validation} onChange={(e) => set('validation', e.target.value)}>
                {(Object.keys(VALIDATION_LABELS) as DataValidation[]).map((v) => <option key={v} value={v}>{VALIDATION_LABELS[v]}</option>)}
              </select>
            </Field>
            <Field label="Nota de validación" htmlFor="validationNote">
              <input id="validationNote" type="text" value={form.validationNote} onChange={(e) => set('validationNote', e.target.value)} placeholder="Ej. Sensor expuesto al sol directo" />
            </Field>
          </div>
        </div>

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>Cancelar</button>
          {!editId && (
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={(e) => submit(e as unknown as FormEvent, true)}>
              Guardar y registrar otro
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <Save size={17} /> {editId ? 'Guardar cambios' : 'Guardar registro'}
          </button>
        </div>
      </form>
    </>
  );
}
