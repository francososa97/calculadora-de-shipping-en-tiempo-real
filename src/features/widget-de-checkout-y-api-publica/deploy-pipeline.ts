/**
 * E3-T3 — Pipeline de deploy MVP
 * Épica: Widget de checkout y API pública
 *
 * Orquestador de deploy para el MVP de la Calculadora de Shipping en Tiempo Real.
 * Ejecuta una secuencia ordenada de stages (build → test → healthcheck previo →
 * deploy → smoke test → activación) con soporte para:
 *  - Ejecución secuencial con fail-fast.
 *  - Reintentos por stage con backoff.
 *  - Rollback automático de los stages ya completados si uno falla.
 *  - Reporte estructurado y tipado del resultado del pipeline.
 *
 * Diseñado para ser agnóstico del runner concreto: cada stage recibe un
 * `DeployContext` y devuelve un `StageOutcome`. La infraestructura real
 * (build de bundle del widget, publicación de la API, etc.) se inyecta como
 * funciones, de modo que este módulo sea testeable sin efectos de red.
 */

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

/** Entornos de despliegue soportados por el MVP. */
export type DeployTarget = 'staging' | 'production';

/** Estado final de un stage individual. */
export type StageStatus = 'success' | 'failed' | 'skipped' | 'rolled_back';

/** Estado final del pipeline completo. */
export type PipelineStatus = 'success' | 'failed' | 'rolled_back';

/** Nivel de severidad de una entrada de log del pipeline. */
export type LogLevel = 'info' | 'warn' | 'error';

/** Una entrada de log estructurada emitida durante el deploy. */
export interface LogEntry {
  readonly level: LogLevel;
  readonly stage: string;
  readonly message: string;
  /** Marca temporal en epoch millis, inyectada por el `clock` del contexto. */
  readonly at: number;
}

/** Contexto compartido que reciben todos los stages. */
export interface DeployContext {
  readonly target: DeployTarget;
  /** Identificador único e inmutable de esta ejecución del pipeline. */
  readonly releaseId: string;
  /** SHA / referencia de commit que se está desplegando. */
  readonly commitSha: string;
  /** Reloj inyectable — facilita tests deterministas. */
  readonly clock: () => number;
  /** Logger inyectable — por defecto acumula en memoria. */
  readonly log: (entry: LogEntry) => void;
}

/** Resultado que devuelve la función de ejecución de un stage. */
export interface StageOutcome {
  readonly ok: boolean;
  /** Mensaje legible del resultado (éxito o causa de fallo). */
  readonly detail: string;
  /** Metadata arbitraria y serializable producida por el stage. */
  readonly meta?: Readonly<Record<string, string | number | boolean>>;
}

/** Definición de un stage del pipeline. */
export interface DeployStage {
  readonly name: string;
  /** Lógica principal del stage. */
  readonly run: (ctx: DeployContext) => Promise<StageOutcome>;
  /**
   * Compensación opcional. Se invoca (en orden inverso) sobre los stages
   * completados con éxito cuando un stage posterior falla.
   */
  readonly rollback?: (ctx: DeployContext) => Promise<void>;
  /** Cantidad de reintentos ante fallo o excepción. Default: 0. */
  readonly retries?: number;
  /** Backoff base en ms entre reintentos (crece linealmente). Default: 250. */
  readonly retryBackoffMs?: number;
}

/** Reporte por stage incluido en el resultado del pipeline. */
export interface StageReport {
  readonly name: string;
  readonly status: StageStatus;
  readonly detail: string;
  readonly attempts: number;
  readonly durationMs: number;
  readonly meta?: Readonly<Record<string, string | number | boolean>>;
}

/** Resultado completo y tipado de la ejecución del pipeline. */
export interface PipelineResult {
  readonly status: PipelineStatus;
  readonly target: DeployTarget;
  readonly releaseId: string;
  readonly commitSha: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly durationMs: number;
  readonly stages: readonly StageReport[];
  readonly logs: readonly LogEntry[];
  /** Nombre del stage que provocó el fallo, si lo hubo. */
  readonly failedStage?: string;
}

/** Opciones de configuración del pipeline. */
export interface PipelineOptions {
  readonly target: DeployTarget;
  readonly releaseId: string;
  readonly commitSha: string;
  /** Reloj inyectable. Default: `Date.now`. */
  readonly clock?: () => number;
  /** Sink de logs inyectable. Default: acumulador en memoria. */
  readonly onLog?: (entry: LogEntry) => void;
  /** Función de espera inyectable (para tests). Default: `setTimeout`. */
  readonly sleep?: (ms: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function toStageOutcome(err: unknown): StageOutcome {
  const detail = err instanceof Error ? err.message : String(err);
  return { ok: false, detail };
}

// ---------------------------------------------------------------------------
// Orquestador
// ---------------------------------------------------------------------------

/**
 * Ejecuta una secuencia de stages de deploy con fail-fast, reintentos y
 * rollback automático. Nunca lanza: cualquier excepción se captura y se
 * refleja en el `PipelineResult`.
 */
export async function runDeployPipeline(
  stages: readonly DeployStage[],
  options: PipelineOptions,
): Promise<PipelineResult> {
  const clock = options.clock ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const logs: LogEntry[] = [];

  const log = (entry: LogEntry): void => {
    logs.push(entry);
    if (options.onLog) options.onLog(entry);
  };

  const ctx: DeployContext = {
    target: options.target,
    releaseId: options.releaseId,
    commitSha: options.commitSha,
    clock,
    log,
  };

  const emit = (level: LogLevel, stage: string, message: string): void =>
    log({ level, stage, message, at: clock() });

  const startedAt = clock();
  const reports: StageReport[] = [];
  const completed: DeployStage[] = [];
  let failedStage: string | undefined;

  emit('info', 'pipeline', `Iniciando deploy ${options.releaseId} → ${options.target} (${options.commitSha})`);

  for (const stage of stages) {
    const maxAttempts = Math.max(1, (stage.retries ?? 0) + 1);
    const backoff = stage.retryBackoffMs ?? 250;
    const stageStart = clock();
    let attempts = 0;
    let outcome: StageOutcome = { ok: false, detail: 'no ejecutado' };

    while (attempts < maxAttempts) {
      attempts += 1;
      try {
        outcome = await stage.run(ctx);
      } catch (err) {
        outcome = toStageOutcome(err);
      }

      if (outcome.ok) break;

      if (attempts < maxAttempts) {
        emit('warn', stage.name, `Intento ${attempts} falló: ${outcome.detail}. Reintentando…`);
        await sleep(backoff * attempts);
      }
    }

    const durationMs = clock() - stageStart;

    if (outcome.ok) {
      emit('info', stage.name, `OK (${attempts} intento(s), ${durationMs}ms): ${outcome.detail}`);
      reports.push({
        name: stage.name,
        status: 'success',
        detail: outcome.detail,
        attempts,
        durationMs,
        meta: outcome.meta,
      });
      completed.push(stage);
      continue;
    }

    // Stage falló definitivamente → fail-fast + rollback.
    failedStage = stage.name;
    emit('error', stage.name, `Falló tras ${attempts} intento(s): ${outcome.detail}`);
    reports.push({
      name: stage.name,
      status: 'failed',
      detail: outcome.detail,
      attempts,
      durationMs,
      meta: outcome.meta,
    });

    const rolledBack = await rollbackCompleted(completed, ctx, emit);
    for (const name of rolledBack) {
      const idx = reports.findIndex((r) => r.name === name && r.status === 'success');
      if (idx >= 0) {
        const prev = reports[idx];
        reports[idx] = { ...prev, status: 'rolled_back' };
      }
    }

    // Los stages no alcanzados quedan como 'skipped'.
    const reached = new Set(reports.map((r) => r.name));
    for (const remaining of stages) {
      if (!reached.has(remaining.name)) {
        reports.push({
          name: remaining.name,
          status: 'skipped',
          detail: 'no ejecutado por fallo previo',
          attempts: 0,
          durationMs: 0,
        });
        reached.add(remaining.name);
      }
    }

    const finishedAt = clock();
    const status: PipelineStatus = rolledBack.length > 0 ? 'rolled_back' : 'failed';
    emit('error', 'pipeline', `Deploy ${status}. Stage responsable: ${failedStage}`);
    return {
      status,
      target: options.target,
      releaseId: options.releaseId,
      commitSha: options.commitSha,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      stages: reports,
      logs,
      failedStage,
    };
  }

  const finishedAt = clock();
  emit('info', 'pipeline', `Deploy completado con éxito en ${finishedAt - startedAt}ms`);
  return {
    status: 'success',
    target: options.target,
    releaseId: options.releaseId,
    commitSha: options.commitSha,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    stages: reports,
    logs,
  };
}

/**
 * Ejecuta las compensaciones de los stages completados, en orden inverso.
 * Devuelve los nombres de los stages efectivamente revertidos.
 */
async function rollbackCompleted(
  completed: readonly DeployStage[],
  ctx: DeployContext,
  emit: (level: LogLevel, stage: string, message: string) => void,
): Promise<string[]> {
  const rolledBack: string[] = [];
  for (let i = completed.length - 1; i >= 0; i -= 1) {
    const stage = completed[i];
    if (!stage.rollback) continue;
    try {
      emit('warn', stage.name, 'Ejecutando rollback…');
      await stage.rollback(ctx);
      rolledBack.push(stage.name);
      emit('info', stage.name, 'Rollback OK');
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      emit('error', stage.name, `Rollback falló: ${detail}`);
    }
  }
  return rolledBack;
}
