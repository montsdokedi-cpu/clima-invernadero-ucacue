import type { AppSettings, ClimateRecord, ClimateThreshold } from '../db/types';
import { TOMATO_STAGES } from '../db/types';
import { compareDayParts, compareStages, hourRange, runLabel, type AgroIndicators } from './agro';
import { fmtDate, fmtDateLong } from './dates';
import type { ProblemAnalysis } from './problems';
import { correlation, dailySummaries, describeCorrelation, hourlyMeans, summarize } from './stats';
import { fmt, fmtHours } from './variables';

// Climatología aplicada: respuestas a las preguntas prácticas y conclusiones.
// Todas las respuestas se construyen con los registros; si faltan datos, se indica.

export interface PracticalAnswer {
  question: string;
  answer: string[];
  basis: string;
  insufficient: boolean;
}

const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);

function peakHour(values: (number | null)[], max = true): number | null {
  let best: number | null = null;
  values.forEach((v, h) => {
    if (v === null) return;
    if (best === null || (max ? v > values[best]! : v < values[best]!)) best = h;
  });
  return best;
}

export function practicalQuestions(
  records: ClimateRecord[],
  thresholds: ClimateThreshold[],
  settings: AppSettings,
  pa: ProblemAnalysis,
): PracticalAnswer[] {
  const n = records.length;
  const ind: AgroIndicators = pa.ind;
  const basis = `${n} registros válidos`;
  const none = (q: string, why = 'No existen registros en el periodo.'): PracticalAnswer => ({ question: q, answer: [why], basis, insufficient: true });
  const Q = [
    '¿Cuál es la temperatura real dentro del invernadero?',
    '¿Cómo cambia la temperatura durante el día?',
    '¿La humedad relativa es adecuada para el tomate?',
    '¿Existen periodos de exceso de calor?',
    '¿Existen condiciones de humedad excesiva?',
    '¿Cuáles son las horas más críticas del día?',
    '¿Cómo varían las condiciones climáticas entre días?',
    '¿Qué relación existe entre temperatura y humedad?',
    '¿Se presentan condiciones que podrían favorecer problemas fisiológicos o enfermedades?',
    '¿Cómo se comporta el microclima del invernadero durante el periodo de estudio?',
  ];
  if (n === 0) return Q.map((q) => none(q));

  const t = summarize(records, 'airTemp');
  const h = summarize(records, 'relHumidity');
  const last = records[records.length - 1];
  const covered = ind.coveredHours;
  const tHour = hourlyMeans(records, 'airTemp');
  const hHour = hourlyMeans(records, 'relHumidity');
  const hoursWithData = tHour.filter((v) => v !== null).length;
  const days = dailySummaries(records);
  const multi = days.filter((d) => d.stats.airTemp.n >= 2);
  const out: PracticalAnswer[] = [];

  // 1
  out.push({
    question: Q[0],
    answer: [
      `Temperatura promedio del periodo: ${fmt(t.mean)} °C, con valores entre ${fmt(t.min)} °C (${fmtDate(t.minRecord!.date)} ${t.minRecord!.time}) y ${fmt(t.max)} °C (${fmtDate(t.maxRecord!.date)} ${t.maxRecord!.time}).`,
      `Última medición: ${fmt(last.airTemp)} °C el ${fmtDate(last.date)} a las ${last.time}.`,
    ],
    basis,
    insufficient: false,
  });

  // 2
  if (hoursWithData >= 6) {
    const hMax = peakHour(tHour)!;
    const hMin = peakHour(tHour, false)!;
    const amp = multi.length ? multi.reduce((a, d) => a + d.stats.airTemp.range!, 0) / multi.length : null;
    out.push({
      question: Q[1],
      answer: [
        `En promedio, la temperatura más baja se presentó entre ${hourRange(hMin)} (${fmt(tHour[hMin])} °C) y la más alta entre ${hourRange(hMax)} (${fmt(tHour[hMax])} °C).`,
        amp !== null ? `La amplitud térmica diaria promedio fue de ${fmt(amp)} °C (${multi.length} días con al menos dos mediciones).` : 'No hay días con dos o más mediciones para calcular la amplitud diaria.',
      ],
      basis: `${basis}; datos en ${hoursWithData} de las 24 horas del día`,
      insufficient: hoursWithData < 12,
    });
  } else out.push(none(Q[1], `Solo hay mediciones en ${hoursWithData} horas distintas del día; se necesitan al menos 6 para describir el ciclo diario.`));

  // 3
  out.push({
    question: Q[2],
    answer: [
      `La humedad relativa promedio fue ${fmt(h.mean, 0)} % (mínima ${fmt(h.min, 0)} %, máxima ${fmt(h.max, 0)} %).`,
      `Estuvo dentro del rango de referencia el ${fmt(pct(ind.hoursHumInRange, covered), 0)} % del tiempo registrado; por encima el ${fmt(pct(ind.hoursHumHigh, covered), 0)} % y por debajo el ${fmt(pct(ind.hoursHumLow, covered), 0)} %.`,
      pct(ind.hoursHumInRange, covered) >= 70
        ? 'Según la referencia configurada, la humedad relativa fue mayoritariamente adecuada durante el periodo.'
        : 'Según la referencia configurada, una parte importante del tiempo la humedad relativa estuvo fuera del rango adecuado.',
    ],
    basis: `${basis}; ${fmtHours(covered)} estimadas`,
    insufficient: !ind.sufficient,
  });

  // 4
  out.push({
    question: Q[3],
    answer: ind.countTempHigh
      ? [
          `Sí. Se estimaron ${fmtHours(ind.hoursTempHigh)} con temperatura sobre la referencia (${ind.countTempHigh} registros).`,
          ...ind.hotRuns.slice(0, 3).map((r) => `Periodo de ${fmtHours(r.hours)}: ${runLabel(r)} (pico ${fmt(r.peak)} °C).`),
        ]
      : ['No. Ningún registro superó la temperatura máxima de referencia en el periodo.'],
    basis,
    insufficient: !ind.sufficient,
  });

  // 5
  out.push({
    question: Q[4],
    answer: ind.countHumHigh
      ? [
          `Sí. Se estimaron ${fmtHours(ind.hoursHumHigh)} con humedad relativa sobre la referencia (${ind.countHumHigh} registros).`,
          ...ind.humidRuns.slice(0, 3).map((r) => `Periodo de ${fmtHours(r.hours)}: ${runLabel(r)} (máximo ${fmt(r.peak, 0)} %).`),
        ]
      : ['No. Ningún registro superó la humedad relativa máxima de referencia en el periodo.'],
    basis,
    insufficient: !ind.sufficient,
  });

  // 6
  const crit: string[] = [];
  if (ind.hottestHours.length) crit.push(`Mayor frecuencia de temperatura elevada: ${ind.hottestHours.map((p) => `${hourRange(p.hour)} (${fmt(p.pctHot, 0)} % de las lecturas)`).join(', ')}.`);
  if (ind.mostHumidHours.length) crit.push(`Mayor frecuencia de humedad relativa elevada: ${ind.mostHumidHours.map((p) => `${hourRange(p.hour)} (${fmt(p.pctHumid, 0)} %)`).join(', ')}.`);
  const coldest = ind.hourProfile.filter((p) => p.pctCold > 0).sort((a, b) => b.pctCold - a.pctCold).slice(0, 2);
  if (coldest.length) crit.push(`Mayor frecuencia de temperatura baja: ${coldest.map((p) => `${hourRange(p.hour)} (${fmt(p.pctCold, 0)} %)`).join(', ')}.`);
  out.push({
    question: Q[5],
    answer: crit.length ? crit : ['No se identificaron horas con valores fuera de la referencia.'],
    basis: `${basis}; frecuencia por hora del día`,
    insufficient: hoursWithData < 12,
  });

  // 7
  if (multi.length >= 2) {
    const means = multi.map((d) => d.stats.airTemp.mean!);
    const avg = means.reduce((a, b) => a + b, 0) / means.length;
    const sd = Math.sqrt(means.reduce((a, b) => a + (b - avg) ** 2, 0) / (means.length - 1));
    const warm = multi.reduce((a, b) => (b.stats.airTemp.mean! > a.stats.airTemp.mean! ? b : a));
    const cool = multi.reduce((a, b) => (b.stats.airTemp.mean! < a.stats.airTemp.mean! ? b : a));
    const humid = multi.reduce((a, b) => (b.stats.relHumidity.mean! > a.stats.relHumidity.mean! ? b : a));
    out.push({
      question: Q[6],
      answer: [
        `El promedio diario de temperatura varió entre ${fmt(cool.stats.airTemp.mean)} °C (${fmtDate(cool.key)}) y ${fmt(warm.stats.airTemp.mean)} °C (${fmtDate(warm.key)}); desviación estándar entre días: ${fmt(sd, 1)} °C.`,
        `El día con mayor humedad relativa promedio fue el ${fmtDate(humid.key)} (${fmt(humid.stats.relHumidity.mean, 0)} %).`,
        ind.maxAmplitudeDay ? `La mayor amplitud térmica se registró el ${fmtDate(ind.maxAmplitudeDay.date)} (${fmt(ind.maxAmplitudeDay.range)} °C).` : '',
      ].filter(Boolean),
      basis: `${multi.length} días con datos`,
      insufficient: multi.length < 3,
    });
  } else out.push(none(Q[6], 'Se necesitan al menos 2 días con dos o más mediciones para comparar días.'));

  // 8
  const c = correlation(records, 'airTemp', 'relHumidity');
  if (c.r !== null && c.n >= 10) {
    out.push({
      question: Q[7],
      answer: [
        `Coeficiente de Pearson r = ${fmt(c.r, 2)} (${describeCorrelation(c.r)}); R² = ${fmt(c.r * c.r, 2)}.`,
        c.r < -0.4
          ? `Cuando la temperatura aumenta, la humedad relativa tiende a disminuir: por cada 1 °C, la HR cambia en promedio ${fmt(c.slope, 1)} %. Es el comportamiento esperado, porque el aire más caliente admite más vapor de agua.`
          : 'La relación lineal observada no es fuerte; otros factores (ventilación, riego, clima exterior) podrían influir, pero no fueron medidos en este análisis.',
      ],
      basis: `${c.n} pares de datos`,
      insufficient: false,
    });
  } else out.push(none(Q[7], `No se calcula la correlación: hay ${c.n} pares de datos y se necesitan al menos 10.`));

  // 9
  const risk: string[] = [];
  for (const p of pa.problems.filter((x) => ['Exceso de temperatura', 'Temperatura baja', 'Humedad relativa elevada', 'Humedad relativa baja'].includes(x.category))) {
    risk.push(`${p.category}: ${p.interpretation.split('. ')[0]}.`);
  }
  if (!risk.length) risk.push('Con los rangos configurados no se identificaron condiciones climáticas de riesgo en el periodo.');
  risk.push('La aplicación no diagnostica enfermedades ni desórdenes fisiológicos: estas son condiciones climáticas que se recomienda verificar en campo.');
  out.push({ question: Q[8], answer: risk, basis, insufficient: !pa.canInterpret });

  // 10
  const parts = compareDayParts(records, thresholds).filter((p) => p.n > 0);
  const hottestPart = parts.length ? parts.reduce((a, b) => ((b.meanT ?? -99) > (a.meanT ?? -99) ? b : a)) : null;
  const humidPart = parts.length ? parts.reduce((a, b) => ((b.meanH ?? -1) > (a.meanH ?? -1) ? b : a)) : null;
  const stages = compareStages(records, thresholds, TOMATO_STAGES).filter((s) => s.key !== 'Sin etapa registrada');
  const micro = [
    `El microclima registrado tuvo una temperatura media de ${fmt(t.mean)} °C y una humedad relativa media de ${fmt(h.mean, 0)} %, con una amplitud total de ${fmt(t.range)} °C.`,
    hottestPart && humidPart ? `Por franja horaria, la ${hottestPart.key.split(' (')[0].toLowerCase()} fue la más cálida (${fmt(hottestPart.meanT)} °C en promedio) y la ${humidPart.key.split(' (')[0].toLowerCase()} la más húmeda (${fmt(humidPart.meanH, 0)} %).` : '',
    stages.length > 1 ? `Por etapa fenológica: ${stages.map((s) => `${s.key} ${fmt(s.meanT)} °C / ${fmt(s.meanH, 0)} %`).join('; ')}.` : '',
  ].filter(Boolean);
  out.push({ question: Q[9], answer: micro, basis: `${basis}; ${settings.gapHours ? '' : ''}${pa.quality.daysWithData} días con datos`, insufficient: !pa.canInterpret });
  void hHour;
  return out;
}

/** Conclusiones descriptivas basadas en datos (sin atribuir causas no medidas). */
export function dataConclusions(records: ClimateRecord[], thresholds: ClimateThreshold[], pa: ProblemAnalysis, from: string, to: string): string[] {
  if (records.length === 0) return ['No es posible formular conclusiones: no existen registros válidos en el periodo analizado.'];
  const out: string[] = [];
  const ind = pa.ind;
  const covered = ind.coveredHours;
  const t = summarize(records, 'airTemp');
  const h = summarize(records, 'relHumidity');
  const tHour = hourlyMeans(records, 'airTemp');
  const hHour = hourlyMeans(records, 'relHumidity');
  const hMax = peakHour(tHour);
  const hHum = peakHour(hHour);
  const periodText = from === to ? `el ${fmtDateLong(from)}` : `el periodo del ${fmtDateLong(from)} al ${fmtDateLong(to)}`;

  const rad = hourlyMeans(records, 'solarRadiation');
  const radPeak = rad.some((v) => v !== null) ? peakHour(rad) : null;
  let timing = '';
  if (hMax !== null) {
    if (radPeak !== null && Math.abs(radPeak - hMax) <= 2) timing = `, y los valores más elevados se registraron entre ${hourRange(hMax)}, coincidiendo con las horas de mayor radiación solar medida`;
    else if (hMax >= 10 && hMax <= 15) timing = `, y los valores más elevados se registraron durante las horas centrales del día (${hourRange(hMax)})`;
    else timing = `, y los valores más elevados se registraron en promedio entre ${hourRange(hMax)}`;
  }
  out.push(`Durante ${periodText}, la temperatura presentó una variación entre ${fmt(t.min)} °C y ${fmt(t.max)} °C, con un promedio de ${fmt(t.mean)} °C${timing}.`);
  if (hHum !== null) {
    const early = hHum < 9 ? 'en las primeras horas del día' : hHum >= 18 ? 'durante la noche' : `entre ${hourRange(hHum)}`;
    out.push(`La humedad relativa promedió ${fmt(h.mean, 0)} % y mostró una tendencia a valores más elevados ${early}${hHum < 9 ? `, lo que representa una condición que debe observarse en relación con la ventilación y el estado sanitario del cultivo` : ''}.`);
  }
  out.push(`Respecto a los rangos de referencia del tomate, la temperatura se mantuvo dentro del rango el ${fmt(pct(ind.hoursTempInRange, covered), 0)} % del tiempo registrado y la humedad relativa el ${fmt(pct(ind.hoursHumInRange, covered), 0)} %.`);
  const main = pa.problems.filter((p) => p.severity === 'alta' || p.severity === 'media');
  if (main.length) out.push(`Los principales problemas climáticos identificados fueron: ${main.map((p) => p.category.toLowerCase()).join(', ')}. Se recomienda su verificación en campo antes de tomar decisiones de manejo.`);
  const stages = compareStages(records, thresholds, TOMATO_STAGES).filter((s) => s.key !== 'Sin etapa registrada');
  if (stages.length > 1) {
    const worst = stages.reduce((a, b) => ((b.pctTempInRange ?? 100) < (a.pctTempInRange ?? 100) ? b : a));
    out.push(`Entre las etapas fenológicas registradas, ${worst.key.toLowerCase()} presentó el menor porcentaje de lecturas de temperatura dentro de la referencia (${fmt(worst.pctTempInRange, 0)} %).`);
  }
  if (!pa.canInterpret) out.push('Estas conclusiones deben considerarse preliminares porque la cantidad o continuidad de los datos del periodo es limitada.');
  out.push('Las conclusiones describen el comportamiento de las variables medidas; no se atribuyen causas a factores que no fueron registrados.');
  return out;
}
