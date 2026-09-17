import type { AppSettings, ClimateRecord, ClimateThreshold } from '../db/types';
import { agroIndicators, dataQuality, hourRange, runLabel, type AgroIndicators, type DataQuality } from './agro';
import { thresholdFor } from './alerts';
import { fmtDate } from './dates';
import { consecutiveChanges } from './stats';
import { fmt, fmtHours } from './variables';

// Módulo de resolución de problemas prácticos.
// Principios de redacción:
//  - HECHOS: solo lo que muestran los registros (con fechas, horas y valores).
//  - INTERPRETACIÓN: lenguaje prudente («condición que requiere observación», «posible riesgo»).
//  - RECOMENDACIONES: verificación en campo y manejo; nunca diagnósticos.
//  - La aplicación NO diagnostica enfermedades: no hay datos fitosanitarios.

export type ProblemSeverity = 'alta' | 'media' | 'observacion' | 'datos';
export const SEVERITY_LABELS: Record<ProblemSeverity, string> = {
  alta: 'Prioridad alta',
  media: 'Prioridad media',
  observacion: 'Requiere observación',
  datos: 'Calidad de datos',
};

export type ProblemCategory =
  | 'Exceso de temperatura'
  | 'Temperatura baja'
  | 'Humedad relativa elevada'
  | 'Humedad relativa baja'
  | 'Variaciones bruscas'
  | 'Falta de datos'
  | 'Datos sospechosos';

export interface ClimateProblem {
  id: string;
  category: ProblemCategory;
  severity: ProblemSeverity;
  title: string;
  facts: string[];
  interpretation: string;
  recommendations: string[];
}

export interface ProblemAnalysis {
  problems: ClimateProblem[];
  ind: AgroIndicators;
  quality: DataQuality;
  /** Respuesta resumida al problema práctico planteado */
  verdict: string[];
  canInterpret: boolean;
}

const pct = (part: number, total: number) => (total > 0 ? (part / total) * 100 : 0);

export function detectProblems(
  records: ClimateRecord[],
  allInPeriod: ClimateRecord[],
  thresholds: ClimateThreshold[],
  settings: AppSettings,
  from: string,
  to: string,
): ProblemAnalysis {
  const ind = agroIndicators(records, thresholds);
  const quality = dataQuality(allInPeriod, from, to, settings.gapHours);
  const problems: ClimateProblem[] = [];
  const general = thresholds.find((t) => t.cropId === null && !t.stage);

  // ---------- Falta de datos ----------
  const dataFacts: string[] = [];
  if (records.length === 0) dataFacts.push('No existen registros válidos en el periodo seleccionado.');
  else {
    dataFacts.push(`Se dispone de ${records.length} registros válidos en ${quality.daysWithData} de ${quality.totalDays} días del periodo (cobertura ${fmt(quality.coveragePct, 0)} %).`);
    if (quality.medianIntervalMin) dataFacts.push(`Intervalo típico entre mediciones: ${quality.medianIntervalMin >= 60 ? `${fmt(quality.medianIntervalMin / 60, 1)} h` : `${Math.round(quality.medianIntervalMin)} min`}.`);
    if (quality.missingDays.length) dataFacts.push(`Días sin registros: ${quality.missingDays.slice(0, 8).map(fmtDate).join(', ')}${quality.missingDays.length > 8 ? ` y ${quality.missingDays.length - 8} más` : ''}.`);
    for (const g of quality.gaps.slice(0, 3)) dataFacts.push(`Vacío de ${fmt(g.hours, 1)} h sin datos: desde ${fmtDate(g.from.date)} ${g.from.time} hasta ${fmtDate(g.to.date)} ${g.to.time}.`);
  }
  const insufficient = !ind.sufficient || quality.coveragePct < 50;
  if (records.length === 0 || insufficient || quality.gaps.length > 0 || quality.missingDays.length > 0) {
    problems.push({
      id: 'datos',
      category: 'Falta de datos',
      severity: insufficient ? 'alta' : 'datos',
      title: insufficient ? 'No existen suficientes registros para realizar una interpretación completa del periodo.' : 'El periodo presenta vacíos de datos.',
      facts: ind.reason ? [ind.reason, ...dataFacts] : dataFacts,
      interpretation: insufficient
        ? 'Las conclusiones de este periodo tienen validez limitada: los indicadores se calculan solo con los registros existentes y no se estiman valores faltantes.'
        : `Los vacíos mayores a ${settings.gapHours} h pueden ocultar eventos de temperatura o humedad; las horas estimadas no incluyen esos intervalos.`,
      recommendations: [
        'Verificar la batería, la memoria y el intervalo de registro del sensor o datalogger.',
        'Descargar e importar los datos pendientes antes de elaborar el informe.',
      ],
    });
  }
  if (records.length === 0) return { problems, ind, quality, verdict: ['No existen registros válidos para responder al problema planteado.'], canInterpret: false };

  const n = records.length;
  const covered = ind.coveredHours;

  // ---------- Exceso de temperatura ----------
  if (ind.countTempHigh > 0) {
    const hot = records.filter((r) => { const t = thresholdFor(r, thresholds); return t && r.airTemp > t.tempMax; });
    const max = hot.reduce((a, b) => (b.airTemp > a.airTemp ? b : a));
    const maxRef = thresholdFor(max, thresholds)!;
    const days = new Set(hot.map((r) => r.date));
    const longest = ind.hotRuns[0];
    const facts = [
      `${ind.countTempHigh} registros (${fmt(pct(ind.countTempHigh, n), 0)} %) superaron la temperatura máxima de referencia, equivalentes a ${fmtHours(ind.hoursTempHigh)} estimadas (${fmt(pct(ind.hoursTempHigh, covered), 0)} % del tiempo registrado), en ${days.size} ${days.size === 1 ? 'día' : 'días'}.`,
      `Valor más alto: ${fmt(max.airTemp)} °C el ${fmtDate(max.date)} a las ${max.time} (referencia máxima ${fmt(maxRef.tempMax)} °C${max.phenologicalStage ? `, etapa ${max.phenologicalStage}` : ''}).`,
    ];
    if (longest) facts.push(`Periodo continuo más largo: ${fmtHours(longest.hours)}, ${runLabel(longest)}, con un pico de ${fmt(longest.peak)} °C.`);
    if (ind.hottestHours.length) facts.push(`Horas con mayor frecuencia de exceso: ${ind.hottestHours.map((h) => `${hourRange(h.hour)} (${fmt(h.pctHot, 0)} % de las lecturas)`).join(', ')}.`);
    const inFlower = hot.filter((r) => r.phenologicalStage === 'Floración' || r.phenologicalStage === 'Fructificación');
    if (inFlower.length) facts.push(`${inFlower.length} de estos registros ocurrieron durante floración o fructificación.`);
    const excess = max.airTemp - maxRef.tempMax;
    problems.push({
      id: 'calor',
      category: 'Exceso de temperatura',
      severity: excess >= 5 || pct(ind.hoursTempHigh, covered) >= 15 ? 'alta' : ind.countTempHigh <= 2 ? 'observacion' : 'media',
      title: 'Se identificaron registros superiores al rango de referencia configurado para el cultivo de tomate.',
      facts,
      interpretation:
        'Temperaturas sostenidas por encima del rango de referencia representan un posible riesgo de estrés térmico para el tomate.' +
        (inFlower.length ? ' Al coincidir con floración o fructificación, es una condición que requiere observación en relación con la viabilidad del polen y el cuajado de frutos.' : ''),
      recommendations: [
        `Se recomienda verificar en campo, durante ${ind.hottestHours.length ? ind.hottestHours.map((h) => hourRange(h.hour)).join(', ') : 'las horas de mayor temperatura'}, síntomas como marchitez temporal, aborto de flores o caída de frutos pequeños.`,
        'Revisar el manejo de ventilación (apertura de cortinas o ventanas) y la posible necesidad de sombreo en esas horas.',
        'Confirmar que el sensor esté protegido de la radiación solar directa (abrigo o caseta), ya que la exposición puede elevar la lectura.',
      ],
    });
  }

  // ---------- Temperatura baja ----------
  if (ind.countTempLow > 0) {
    const cold = records.filter((r) => { const t = thresholdFor(r, thresholds); return t && r.airTemp < t.tempMin; });
    const min = cold.reduce((a, b) => (b.airTemp < a.airTemp ? b : a));
    const minRef = thresholdFor(min, thresholds)!;
    const longest = ind.coldRuns[0];
    const nightShare = pct(cold.filter((r) => Number(r.time.slice(0, 2)) < 7 || Number(r.time.slice(0, 2)) >= 19).length, cold.length);
    const facts = [
      `${ind.countTempLow} registros (${fmt(pct(ind.countTempLow, n), 0)} %) estuvieron por debajo de la temperatura mínima de referencia, equivalentes a ${fmtHours(ind.hoursTempLow)} estimadas.`,
      `Valor más bajo: ${fmt(min.airTemp)} °C el ${fmtDate(min.date)} a las ${min.time} (referencia mínima ${fmt(minRef.tempMin)} °C).`,
      `${fmt(nightShare, 0)} % de estos registros ocurrieron entre las 19:00 y las 07:00.`,
    ];
    if (longest) facts.push(`Periodo continuo más largo: ${fmtHours(longest.hours)}, ${runLabel(longest)}, con un mínimo de ${fmt(longest.peak)} °C.`);
    problems.push({
      id: 'frio',
      category: 'Temperatura baja',
      severity: minRef.tempMin - min.airTemp >= 5 ? 'alta' : ind.countTempLow <= 2 ? 'observacion' : 'media',
      title: 'Se registraron temperaturas inferiores al rango de referencia del tomate.',
      facts,
      interpretation: 'Temperaturas por debajo del rango de referencia constituyen una condición que puede ralentizar el crecimiento y el desarrollo del cultivo; su efecto depende de la duración y de la etapa fenológica.',
      recommendations: [
        'Se recomienda observar en campo el ritmo de crecimiento y la coloración del follaje en los días señalados.',
        'Evaluar el cierre oportuno de cortinas al atardecer para conservar el calor acumulado durante el día.',
      ],
    });
  }

  // ---------- Humedad relativa elevada ----------
  if (ind.countHumHigh > 0) {
    const longest = ind.humidRuns[0];
    const prolonged = ind.humidRuns.filter((r) => r.hours >= 4);
    const saturated = records.filter((r) => r.relHumidity >= 95);
    const facts = [
      `${ind.countHumHigh} registros (${fmt(pct(ind.countHumHigh, n), 0)} %) superaron la humedad relativa máxima de referencia, equivalentes a ${fmtHours(ind.hoursHumHigh)} estimadas (${fmt(pct(ind.hoursHumHigh, covered), 0)} % del tiempo registrado).`,
    ];
    if (longest) facts.push(`Periodo continuo más largo: ${fmtHours(longest.hours)}, ${runLabel(longest)}, con un máximo de ${fmt(longest.peak, 0)} %.`);
    if (prolonged.length) facts.push(`Se identificaron ${prolonged.length} periodos de 4 h o más con humedad relativa sobre la referencia.`);
    if (ind.mostHumidHours.length) facts.push(`Horas con mayor frecuencia de humedad elevada: ${ind.mostHumidHours.map((h) => `${hourRange(h.hour)} (${fmt(h.pctHumid, 0)} %)`).join(', ')}.`);
    if (saturated.length) facts.push(`${saturated.length} registros alcanzaron 95 % o más de humedad relativa.`);
    problems.push({
      id: 'humedad',
      category: 'Humedad relativa elevada',
      severity: prolonged.length >= 3 || pct(ind.hoursHumHigh, covered) >= 30 ? 'alta' : prolonged.length ? 'media' : 'observacion',
      title: prolonged.length ? 'Se observaron periodos prolongados de humedad relativa elevada.' : 'Se observaron registros de humedad relativa superiores a la referencia.',
      facts,
      interpretation:
        'La humedad relativa elevada y persistente representa condiciones favorables para el desarrollo de enfermedades foliares de origen fúngico y para la condensación sobre el follaje. ' +
        'Estos datos NO permiten afirmar la presencia de ninguna enfermedad: no se registró información fitosanitaria ni humedad de la hoja.',
      recommendations: [
        'Se recomienda verificar en campo el estado sanitario del cultivo (manchas, moho o lesiones en hojas, tallos y frutos), en especial después de los periodos señalados.',
        'Revisar la ventilación durante las primeras horas de la mañana y la programación del riego, evitando mojar el follaje al final del día.',
        'Registrar las observaciones sanitarias en la aplicación para relacionarlas con los datos climáticos.',
      ],
    });
  }

  // ---------- Humedad relativa baja ----------
  if (ind.countHumLow > 0) {
    const low = records.filter((r) => { const t = thresholdFor(r, thresholds); return t && r.relHumidity < t.humidityMin; });
    const min = low.reduce((a, b) => (b.relHumidity < a.relHumidity ? b : a));
    const withHeat = low.filter((r) => { const t = thresholdFor(r, thresholds)!; return r.airTemp > t.tempMax; });
    const facts = [
      `${ind.countHumLow} registros (${fmt(pct(ind.countHumLow, n), 0)} %) estuvieron por debajo de la humedad relativa mínima de referencia (${fmtHours(ind.hoursHumLow)} estimadas).`,
      `Valor más bajo: ${fmt(min.relHumidity, 0)} % el ${fmtDate(min.date)} a las ${min.time}, con ${fmt(min.airTemp)} °C.`,
    ];
    if (withHeat.length) facts.push(`${withHeat.length} de estos registros coincidieron con temperatura sobre la referencia.`);
    problems.push({
      id: 'seco',
      category: 'Humedad relativa baja',
      severity: withHeat.length >= 3 ? 'media' : 'observacion',
      title: 'Se registraron periodos de humedad relativa inferior a la referencia.',
      facts,
      interpretation:
        'La humedad relativa baja, sobre todo junto con temperaturas altas, aumenta la demanda de transpiración del cultivo; es una condición que requiere observación en relación con el riego y el cuajado.',
      recommendations: ['Se recomienda verificar en campo el estado hídrico de las plantas en las horas señaladas y revisar la frecuencia de riego.'],
    });
  }

  // ---------- Variaciones bruscas ----------
  const abruptT = consecutiveChanges(records, 'airTemp').filter((c) => Math.abs(c.delta) >= settings.abruptTempChange && c.hours <= 3);
  const abruptH = consecutiveChanges(records, 'relHumidity').filter((c) => Math.abs(c.delta) >= settings.abruptHumidityChange && c.hours <= 3);
  if (abruptT.length || abruptH.length) {
    const top = [...abruptT].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3);
    const facts = top.map((c) => `${fmtDate(c.to.date)}: de ${fmt(c.from.airTemp)} °C (${c.from.time}) a ${fmt(c.to.airTemp)} °C (${c.to.time}), cambio de ${c.delta > 0 ? '+' : ''}${fmt(c.delta)} °C.`);
    if (abruptT.length > 3) facts.push(`En total, ${abruptT.length} cambios de temperatura ≥ ${settings.abruptTempChange} °C entre mediciones consecutivas (≤ 3 h).`);
    if (abruptH.length) facts.push(`${abruptH.length} cambios de humedad relativa ≥ ${settings.abruptHumidityChange} % entre mediciones consecutivas.`);
    if (ind.maxAmplitudeDay) facts.push(`Mayor amplitud térmica diaria: ${fmt(ind.maxAmplitudeDay.range)} °C el ${fmtDate(ind.maxAmplitudeDay.date)} (entre ${fmt(ind.maxAmplitudeDay.min)} y ${fmt(ind.maxAmplitudeDay.max)} °C).`);
    problems.push({
      id: 'bruscas',
      category: 'Variaciones bruscas',
      severity: abruptT.length >= 5 ? 'media' : 'observacion',
      title: 'Se detectó una variación importante de temperatura entre mediciones consecutivas.',
      facts,
      interpretation:
        'Los cambios bruscos pueden corresponder a variaciones reales del microclima (apertura o cierre de ventanas, paso de nubosidad, lluvia) o a errores de medición. Con los datos disponibles no es posible distinguir la causa.',
      recommendations: [
        'Contrastar las fechas y horas señaladas con las observaciones de manejo registradas (apertura de cortinas, riego, clima exterior).',
        'Verificar la ubicación y protección del sensor; marcar como «descartado» cualquier lectura confirmada como errónea.',
      ],
    });
  }

  // ---------- Datos sospechosos ----------
  if (quality.byValidation.sospechoso > 0) {
    const suspicious = allInPeriod.filter((r) => r.validation === 'sospechoso');
    problems.push({
      id: 'sospechosos',
      category: 'Datos sospechosos',
      severity: 'datos',
      title: `${quality.byValidation.sospechoso} registros están marcados como sospechosos.`,
      facts: [
        ...suspicious.slice(0, 3).map((r) => `${fmtDate(r.date)} ${r.time}: ${fmt(r.airTemp)} °C, ${fmt(r.relHumidity, 0)} % — ${r.validationNote || 'marcado manualmente'}.`),
        quality.byValidation.descartado ? `${quality.byValidation.descartado} registros descartados se excluyeron del análisis.` : 'Los registros sospechosos se incluyen en los cálculos hasta que se revisen.',
      ],
      interpretation: 'Los valores atípicos pueden alterar promedios, máximos y la detección de problemas.',
      recommendations: ['Revisar estos registros en el Historial y marcarlos como «válido» o «descartado» según la verificación.'],
    });
  }

  // ---------- Respuesta al problema práctico ----------
  const verdict: string[] = [];
  const canInterpret = ind.sufficient && quality.coveragePct >= 50;
  verdict.push(
    `Con base en ${n} registros válidos (${fmtHours(covered)} estimadas), la temperatura se mantuvo dentro del rango de referencia durante el ${fmt(pct(ind.hoursTempInRange, covered), 0)} % del tiempo registrado y la humedad relativa durante el ${fmt(pct(ind.hoursHumInRange, covered), 0)} %.`,
  );
  verdict.push(`Ambas variables estuvieron simultáneamente dentro de la referencia el ${fmt(pct(ind.hoursBothInRange, covered), 0)} % del tiempo (${fmtHours(ind.hoursBothInRange)}).`);
  const main = problems.filter((p) => p.severity === 'alta' || p.severity === 'media').map((p) => p.category.toLowerCase());
  if (main.length) verdict.push(`Se identificaron periodos de posible estrés climático asociados a: ${main.join(', ')}.`);
  else if (!problems.some((p) => ['Exceso de temperatura', 'Temperatura baja', 'Humedad relativa elevada', 'Humedad relativa baja'].includes(p.category)))
    verdict.push('No se identificaron registros fuera de los rangos de referencia configurados.');
  if (!canInterpret) verdict.push('Advertencia: la cantidad o continuidad de los datos es insuficiente para una conclusión completa del periodo.');
  if (general) verdict.push(`Referencia general utilizada: ${fmt(general.tempMin)}–${fmt(general.tempMax)} °C y ${fmt(general.humidityMin, 0)}–${fmt(general.humidityMax, 0)} % HR (se aplican rangos por etapa cuando el registro la indica). ${settings.referenceSource}`);

  const order: ProblemSeverity[] = ['alta', 'media', 'observacion', 'datos'];
  problems.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  return { problems, ind, quality, verdict, canInterpret };
}
