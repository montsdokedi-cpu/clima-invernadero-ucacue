import type { AppSettings, ClimateRecord, ClimateThreshold } from '../db/types';
import { abruptChangeAlerts, thresholdFor } from './alerts';
import { daysBetween, fmtDateLong, partOfDay } from './dates';
import { consecutiveChanges, correlation, dailySummaries, describeCorrelation, groupBy, summarize } from './stats';
import { fmt, isNum } from './variables';

// Interpretaciones automáticas. Regla: cada frase se construye exclusivamente
// a partir de los registros existentes; si no hay datos suficientes, se dice.

export interface AnalysisSection {
  title: string;
  paragraphs: string[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function momentOfMax(records: ClimateRecord[], key: 'airTemp' | 'relHumidity'): string | null {
  const groups = groupBy(records.filter((r) => isNum(r[key])), (r) => partOfDay(r.time));
  if (groups.size < 2) return null;
  let best: [string, number] | null = null;
  for (const [part, recs] of groups) {
    const m = summarize(recs, key).mean!;
    if (!best || m > best[1]) best = [part, m];
  }
  const labels: Record<string, string> = { madrugada: 'la madrugada', mañana: 'las horas de la mañana', tarde: 'las horas de la tarde', noche: 'la noche' };
  return best ? labels[best[0]] : null;
}

function momentOfMin(records: ClimateRecord[], key: 'airTemp' | 'relHumidity'): string | null {
  const groups = groupBy(records.filter((r) => isNum(r[key])), (r) => partOfDay(r.time));
  if (groups.size < 2) return null;
  let best: [string, number] | null = null;
  for (const [part, recs] of groups) {
    const m = summarize(recs, key).mean!;
    if (!best || m < best[1]) best = [part, m];
  }
  const labels: Record<string, string> = { madrugada: 'la madrugada', mañana: 'la mañana', tarde: 'la tarde', noche: 'la noche' };
  return best ? labels[best[0]] : null;
}

/** Interpretación de un solo día. */
export function analyzeDay(records: ClimateRecord[], date: string): string[] {
  const recs = records.filter((r) => r.date === date);
  if (recs.length === 0) return [`No existen registros para el ${fmtDateLong(date)}.`];
  const t = summarize(recs, 'airTemp');
  const h = summarize(recs, 'relHumidity');
  const out: string[] = [];

  if (recs.length === 1) {
    out.push(
      `El ${fmtDateLong(date)} se realizó un único registro (${recs[0].time}) con ${fmt(recs[0].airTemp)} °C y ${fmt(recs[0].relHumidity, 0)} % de humedad relativa. Se necesitan más registros para calcular promedios representativos del día.`,
    );
    return out;
  }

  out.push(
    `Durante el día ${fmtDateLong(date)} se registró una temperatura promedio de ${fmt(t.mean)} °C, con una máxima de ${fmt(t.max)} °C (${t.maxRecord!.time}) y una mínima de ${fmt(t.min)} °C (${t.minRecord!.time}). La amplitud térmica fue de ${fmt(t.range)} °C, a partir de ${plural(recs.length, 'registro', 'registros')}.`,
  );

  const moistMoment = momentOfMax(recs, 'relHumidity');
  out.push(
    `Se observó una humedad relativa promedio del ${fmt(h.mean, 0)} %, con valores entre ${fmt(h.min, 0)} % y ${fmt(h.max, 0)} %` +
      (moistMoment ? `, y mayor humedad durante ${moistMoment}.` : '.'),
  );

  const soil = summarize(recs, 'soilTemp');
  const soilM = summarize(recs, 'soilMoisture');
  if (soil.n >= 2 || soilM.n >= 2) {
    const parts: string[] = [];
    if (soil.n >= 2) parts.push(`la temperatura del suelo promedió ${fmt(soil.mean)} °C (${fmt(soil.min)}–${fmt(soil.max)} °C)`);
    if (soilM.n >= 2) parts.push(`la humedad del suelo promedió ${fmt(soilM.mean, 0)} %`);
    out.push(`En el suelo, ${parts.join(' y ')}.`);
  }

  const tempChanges = consecutiveChanges(recs, 'airTemp');
  if (tempChanges.length) {
    const biggest = tempChanges.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a));
    out.push(
      `La mayor variación entre registros consecutivos fue de ${biggest.delta > 0 ? '+' : ''}${fmt(biggest.delta)} °C, entre las ${biggest.from.time} y las ${biggest.to.time}.`,
    );
  }
  return out;
}

/** Interpretación de un periodo completo. */
export function analyzePeriod(
  records: ClimateRecord[],
  from: string,
  to: string,
  thresholds: ClimateThreshold[],
  settings: AppSettings,
): AnalysisSection[] {
  const sections: AnalysisSection[] = [];
  const periodText = from === to ? `el ${fmtDateLong(from)}` : `el periodo del ${fmtDateLong(from)} al ${fmtDateLong(to)}`;

  if (records.length === 0) {
    return [{ title: 'Sin datos', paragraphs: [`No existen registros climáticos para ${periodText}. No es posible generar conclusiones.`] }];
  }

  const days = dailySummaries(records);
  const totalDays = daysBetween(from, to) + 1;
  const t = summarize(records, 'airTemp');
  const h = summarize(records, 'relHumidity');

  // Resumen general
  const general: string[] = [];
  general.push(
    `Para ${periodText} se analizaron ${plural(records.length, 'registro', 'registros')} distribuidos en ${plural(days.length, 'día', 'días')} con datos` +
      (totalDays > days.length ? ` (de ${totalDays} días del periodo, ${plural(totalDays - days.length, 'día quedó', 'días quedaron')} sin registros).` : '.'),
  );
  general.push(
    `La temperatura del aire promedió ${fmt(t.mean)} °C. El valor máximo fue ${fmt(t.max)} °C (${fmtDateLong(t.maxRecord!.date, false)}, ${t.maxRecord!.time}) y el mínimo ${fmt(t.min)} °C (${fmtDateLong(t.minRecord!.date, false)}, ${t.minRecord!.time}), lo que representa una amplitud térmica del periodo de ${fmt(t.range)} °C.`,
  );
  const hotMoment = momentOfMax(records, 'airTemp');
  const coldMoment = momentOfMin(records, 'airTemp');
  if (hotMoment && coldMoment)
    general.push(`En promedio, las temperaturas más altas se registraron durante ${hotMoment} y las más bajas durante ${coldMoment}.`);
  const moistMoment = momentOfMax(records, 'relHumidity');
  general.push(
    `La humedad relativa promedio fue del ${fmt(h.mean, 0)} % (mínima ${fmt(h.min, 0)} %, máxima ${fmt(h.max, 0)} %)` +
      (moistMoment ? `, con mayor humedad durante ${moistMoment}.` : '.'),
  );
  sections.push({ title: 'Resumen climático', paragraphs: general });

  // Comportamiento diario
  const multi = days.filter((d) => d.stats.airTemp.n >= 2);
  if (multi.length >= 2) {
    const amps = multi.map((d) => d.stats.airTemp.range!);
    const avgAmp = amps.reduce((a, b) => a + b, 0) / amps.length;
    const warmest = multi.reduce((a, b) => (b.stats.airTemp.mean! > a.stats.airTemp.mean! ? b : a));
    const coldest = multi.reduce((a, b) => (b.stats.airTemp.mean! < a.stats.airTemp.mean! ? b : a));
    const widest = multi.reduce((a, b) => (b.stats.airTemp.range! > a.stats.airTemp.range! ? b : a));
    const daily: string[] = [
      `La amplitud térmica diaria promedio fue de ${fmt(avgAmp)} °C. El día con mayor amplitud fue el ${fmtDateLong(widest.key, false)} (${fmt(widest.stats.airTemp.range)} °C).`,
      `El día más cálido en promedio fue el ${fmtDateLong(warmest.key, false)} (${fmt(warmest.stats.airTemp.mean)} °C) y el más fresco el ${fmtDateLong(coldest.key, false)} (${fmt(coldest.stats.airTemp.mean)} °C).`,
    ];
    const avgPerDay = records.length / days.length;
    daily.push(`Se realizaron en promedio ${fmt(avgPerDay, 1)} registros por día con datos.`);
    sections.push({ title: 'Comportamiento diario', paragraphs: daily });
  }

  // Rangos y extremos
  const range: string[] = [];
  const outHigh = records.filter((r) => { const th = thresholdFor(r, thresholds); return th && r.airTemp > th.tempMax; });
  const outLow = records.filter((r) => { const th = thresholdFor(r, thresholds); return th && r.airTemp < th.tempMin; });
  const humHigh = records.filter((r) => { const th = thresholdFor(r, thresholds); return th && r.relHumidity > th.humidityMax; });
  const humLow = records.filter((r) => { const th = thresholdFor(r, thresholds); return th && r.relHumidity < th.humidityMin; });
  const pct = (n: number) => fmt((n / records.length) * 100, 0);
  if (outHigh.length + outLow.length === 0) range.push('Todos los registros de temperatura se mantuvieron dentro de los rangos configurados.');
  else {
    const extremeDays = new Set([...outHigh, ...outLow].map((r) => r.date));
    range.push(
      `${plural(outHigh.length, 'registro superó', 'registros superaron')} la temperatura máxima configurada (${pct(outHigh.length)} %) y ${plural(outLow.length, 'registro estuvo', 'registros estuvieron')} por debajo de la mínima (${pct(outLow.length)} %). Hubo ${plural(extremeDays.size, 'día', 'días')} con valores de temperatura fuera de rango.`,
    );
  }
  if (humHigh.length + humLow.length === 0) range.push('La humedad relativa se mantuvo dentro del rango configurado en todos los registros.');
  else
    range.push(
      `La humedad relativa superó el máximo configurado en ${plural(humHigh.length, 'registro', 'registros')} (${pct(humHigh.length)} %) y quedó por debajo del mínimo en ${plural(humLow.length, 'registro', 'registros')} (${pct(humLow.length)} %).`,
    );
  const abrupt = abruptChangeAlerts(records, settings);
  if (abrupt.length)
    range.push(
      `Se identificaron ${plural(abrupt.length, 'cambio brusco', 'cambios bruscos')} entre registros consecutivos del mismo día (umbral: ${settings.abruptTempChange} °C o ${settings.abruptHumidityChange} % de HR).`,
    );
  else range.push(`No se identificaron cambios bruscos entre registros consecutivos (umbral: ${settings.abruptTempChange} °C o ${settings.abruptHumidityChange} % de HR).`);
  sections.push({ title: 'Rangos, extremos y cambios bruscos', paragraphs: range });

  // Relación entre variables
  const rel: string[] = [];
  const c = correlation(records, 'airTemp', 'relHumidity');
  if (c.r !== null && c.n >= 10)
    rel.push(
      `Entre la temperatura del aire y la humedad relativa se obtuvo un coeficiente de Pearson r = ${fmt(c.r, 2)} (${describeCorrelation(c.r)}, n = ${c.n}).` +
        (c.r < -0.4 ? ' Es decir, cuando la temperatura sube la humedad relativa tiende a bajar, comportamiento esperado en un invernadero.' : ''),
    );
  const cs = correlation(records, 'airTemp', 'soilTemp');
  if (cs.r !== null && cs.n >= 10)
    rel.push(`La temperatura del aire y la del suelo presentan r = ${fmt(cs.r, 2)} (${describeCorrelation(cs.r)}, n = ${cs.n}).`);
  const soilT = summarize(records, 'soilTemp');
  if (soilT.n >= 3)
    rel.push(`En promedio el suelo estuvo ${fmt(Math.abs(t.mean! - soilT.mean!))} °C ${soilT.mean! < t.mean! ? 'más fresco' : 'más cálido'} que el aire (${fmt(soilT.mean)} °C frente a ${fmt(t.mean)} °C), con una variación más estable (desviación ${fmt(soilT.std)} °C frente a ${fmt(t.std)} °C).`);
  if (rel.length === 0) rel.push('No hay suficientes pares de datos (mínimo 10) para analizar la relación entre variables.');
  sections.push({ title: 'Relación entre variables', paragraphs: rel });

  // Otras variables
  const other: string[] = [];
  const lux = summarize(records, 'luminosity');
  if (lux.n) other.push(`Luminosidad: promedio ${fmt(lux.mean, 0)} lux, máxima ${fmt(lux.max, 0)} lux (n = ${lux.n}).`);
  const rad = summarize(records, 'solarRadiation');
  if (rad.n) other.push(`Radiación solar: promedio ${fmt(rad.mean, 0)} W/m², máxima ${fmt(rad.max, 0)} W/m² (n = ${rad.n}).`);
  const wind = summarize(records, 'windSpeed');
  if (wind.n) other.push(`Velocidad del viento: promedio ${fmt(wind.mean)} m/s, máxima ${fmt(wind.max)} m/s (n = ${wind.n}).`);
  const rain = summarize(records, 'precipitation');
  if (rain.n) other.push(`Precipitación acumulada registrada: ${fmt(rain.sum)} mm en ${plural(rain.n, 'registro', 'registros')}.`);
  if (other.length) sections.push({ title: 'Otras variables registradas', paragraphs: other });

  sections.push({
    title: 'Nota metodológica',
    paragraphs: [
      'Estas interpretaciones se calculan automáticamente a partir de los registros existentes; no se estiman ni se completan datos faltantes. Los promedios dependen de las horas en que se tomaron las mediciones, por lo que conviene mantener horarios de registro constantes.',
    ],
  });
  return sections;
}
