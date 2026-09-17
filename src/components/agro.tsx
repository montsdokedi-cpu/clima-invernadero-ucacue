import { CircleAlert, ClipboardCheck, Info, Lightbulb, ScanSearch } from 'lucide-react';
import type { ReactNode } from 'react';
import { SOURCE_LABELS, VALIDATION_LABELS, type ClimateRecord, type ClimateThreshold, type DataValidation, type RecordSource } from '../db/types';
import { thresholdFor } from '../lib/alerts';
import type { PracticalAnswer } from '../lib/applied';
import { SEVERITY_LABELS, type ClimateProblem } from '../lib/problems';
import { fmt } from '../lib/variables';

/** Referencia aplicable a un conjunto de registros: por etapa/cultivo si es única, si no la general. */
export function periodReference(records: ClimateRecord[], thresholds: ClimateThreshold[]) {
  const stages = new Set(records.map((r) => r.phenologicalStage || ''));
  const crops = new Set(records.map((r) => r.cropId ?? null));
  return thresholdFor(
    { cropId: crops.size === 1 ? [...crops][0] : null, phenologicalStage: stages.size === 1 ? [...stages][0] : null },
    thresholds,
  );
}

export function SourceBadge({ source }: { source: RecordSource }) {
  return <span className={`src-badge src-${source}`}>{SOURCE_LABELS[source]}</span>;
}

export function ValidationBadge({ value, note }: { value: DataValidation; note?: string }) {
  return (
    <span className={`val-badge val-${value}`} title={note || undefined}>
      {VALIDATION_LABELS[value ?? 'valido']}
    </span>
  );
}

export function ReferenceNote({ threshold, text }: { threshold?: ClimateThreshold; text: string }) {
  if (!threshold) return null;
  return (
    <p className="ref-note">
      <Info size={14} />
      <span>
        <strong>{threshold.label}:</strong> {fmt(threshold.tempMin)}–{fmt(threshold.tempMax)} °C · {fmt(threshold.humidityMin, 0)}–{fmt(threshold.humidityMax, 0)} % HR. {text}
      </span>
    </p>
  );
}

export function InsufficientNotice({ children }: { children: ReactNode }) {
  return (
    <div className="notice warn insufficient">
      <CircleAlert size={18} />
      <span>{children}</span>
    </div>
  );
}

export function FactBlock({ items, title = 'Hechos observados en los datos' }: { items: string[]; title?: string }) {
  if (!items.length) return null;
  return (
    <div className="fact-block">
      <span className="block-label"><ScanSearch size={14} /> {title}</span>
      <ul>{items.map((f, i) => <li key={i}>{f}</li>)}</ul>
    </div>
  );
}

export function InterpretationBlock({ text }: { text: string }) {
  return (
    <div className="interp-block">
      <span className="block-label"><Lightbulb size={14} /> Interpretación agronómica</span>
      <p>{text}</p>
    </div>
  );
}

export function RecoBlock({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="reco-block">
      <span className="block-label"><ClipboardCheck size={14} /> Recomendaciones (verificar en campo)</span>
      <ul>{items.map((f, i) => <li key={i}>{f}</li>)}</ul>
    </div>
  );
}

export function ProblemCard({ problem }: { problem: ClimateProblem }) {
  return (
    <article className={`card problem-card sev-${problem.severity}`}>
      <header>
        <span className={`sev-chip sev-${problem.severity}`}>{SEVERITY_LABELS[problem.severity]}</span>
        <span className="problem-cat">{problem.category}</span>
      </header>
      <h3>{problem.title}</h3>
      <FactBlock items={problem.facts} />
      <InterpretationBlock text={problem.interpretation} />
      <RecoBlock items={problem.recommendations} />
    </article>
  );
}

export function AnswerCard({ answer, index }: { answer: PracticalAnswer; index: number }) {
  return (
    <details className="answer" open={index < 3}>
      <summary>
        <span className="q-num">P{index + 1}</span>
        <span className="q-text">{answer.question}</span>
        {answer.insufficient && <span className="tag amber">Datos limitados</span>}
      </summary>
      <div className="answer-body">
        <ul>{answer.answer.map((a, i) => <li key={i}>{a}</li>)}</ul>
        <p className="small muted">Base: {answer.basis}.</p>
      </div>
    </details>
  );
}
