/**
 * E3-T3 — Pipeline de deploy MVP
 * Épica: Widget de checkout y API pública
 *
 * Orquestador de deploy para el MVP. Ejecuta una secuencia determinística de
 * stages (build → test → deploy → smoke) con soporte de rollback automático
 * ante fallos. Está desacoplado del proveedor concreto de infraestructura vía
 * la interfaz `DeployTarget`, de modo que el mismo pipeline sirve tanto para
 * el widget de checkout (bundle estático) como para la API pública (servicio).
 *
 * No usa `any`. Todos los tipos son explícitos.
 */

export type DeployStage = 'build' | 'test' | 'deploy' | 'smoke';

export type DeployStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'rolled_back';

export interface StageResult {
  readonly stage: DeployStage;
  readonly status: Extract<DeployStatus, 'succeeded' | 'failed'>;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly durationMs: number;
  readonly output: string;
  readonly error?: string;
}

export interface DeployArtifact {
  /** Identificador único del artefacto construido (p. ej. hash de commit + timestamp). */
  readonly id: string;
  /** Componente del MVP que se despliega. */
  readonly component: 'checkout-widget' | 'public-api';
  /** Versión semántica o etiqueta de release. */
  readonly version: string;
  /** Ruta o URL del bundle/imagen resultante del build. */
  readonly location: string;
}

export interface HealthCheck {
  /** URL absoluta a chequear post-deploy. */
  readonly url: string;
  /** Códigos HTTP considerados saludables. */
  readonly expectStatus: readonly number[];
  /** Reintentos antes de declarar el smoke test como fallido. */
  readonly retries: number;
  /** Espera entre reintentos en milisegundos. */
  readonly retryDelayMs: number;
}

/**
 * Abstracción del destino de deploy. Cada proveedor (Vercel, S3+CloudFront,
 * Cloud Run, etc.) implementa esta interfaz. El pipeline no conoce detalles
 * del proveedor: sólo build/deploy/rollback.
 */
export interface DeployTarget {
  readonly name: string;
  build(component: DeployArtifact['component'], version: string): Promise<DeployArtifact>;
  test(artifact: DeployArtifact): Promise<string>;
  deploy(artifact: DeployArtifact): Promise<string>;
  rollback(artifact: DeployArtifact): Promise<string>;
}

/** Cliente HTTP mínimo inyectable para poder testear el smoke sin red real. */
export type HttpProbe = (url: string) => Promise<{ readonly status: number }>;

/** Reloj inyectable para tests deterministas. */
export type Clock = () => number;

/** Sink de logs inyectable. Por defecto, `console`. */
export type Logger = (message: string) => void;

export interface PipelineConfig {
  readonly component: DeployArtifact['component'];
  readonly version: string;
  readonly target: DeployTarget;
  readonly healthCheck: HealthCheck;
  /** Si es true, ante fallo en deploy/smoke se intenta rollback automático. */
  readonly autoRollback: boolean;
}

export interface PipelineDependencies {
  readonly probe: HttpProbe;
  readonly now: Clock;
  readonly log: Logger;
  readonly sleep: (ms: number) => Promise<void>;
}

export interface DeployReport {
  readonly component: DeployArtifact['component'];
  readonly version: string;
  readonly status: DeployStatus;
  readonly artifact: DeployArtifact | null;
  readonly stages: readonly StageResult[];
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly durationMs: number;
}

export class DeployError extends Error {
  constructor(
    public readonly stage: DeployStage,
    message: string,
  ) {
    super(message);
    this.name = 'DeployError';
  }
}

const defaultDependencies: PipelineDependencies = {
  probe: async (url: string): Promise<{ readonly status: number }> => {
    const response = await fetch(url, { method: 'GET' });
    return { status: response.status };
  },
  now: (): number => Date.now(),
  log: (message: string): void => {
    // eslint-disable-next-line no-console
    console.log(message);
  },
  sleep: (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

/**
 * Pipeline de deploy del MVP. Ejecuta los stages en orden y corta ante el
 * primer fallo. Si `autoRollback` está activo, revierte al estado previo
 * cuando falla `deploy` o `smoke`.
 */
export class DeployPipeline {
  private readonly deps: PipelineDependencies;

  constructor(
    private readonly config: PipelineConfig,
    deps: Partial<PipelineDependencies> = {},
  ) {
    this.deps = { ...defaultDependencies, ...deps };
  }

  async run(): Promise<DeployReport> {
    const startedAt = this.deps.now();
    const stages: StageResult[] = [];
    let artifact: DeployArtifact | null = null;
    let status: DeployStatus = 'running';

    try {
      const build = await this.runStage('build', async () => {
        artifact = await this.config.target.build(this.config.component, this.config.version);
        return `built ${artifact.id} @ ${artifact.location}`;
      });
      stages.push(build);

      const nonNullArtifact = this.assertArtifact(artifact);

      stages.push(
        await this.runStage('test', async () => this.config.target.test(nonNullArtifact)),
      );

      stages.push(
        await this.runStage('deploy', async () => this.config.target.deploy(nonNullArtifact)),
      );

      stages.push(await this.runStage('smoke', async () => this.runSmoke()));

      status = 'succeeded';
    } catch (error) {
      const failed: StageResult | undefined = stages.find((s) => s.status === 'failed');
      status = 'failed';
      this.deps.log(`[deploy] pipeline failed: ${this.describeError(error)}`);

      const failedStage: DeployStage | null = failed?.stage ?? null;
      const shouldRollback =
        this.config.autoRollback &&
        artifact !== null &&
        (failedStage === 'deploy' || failedStage === 'smoke');

      if (shouldRollback && artifact !== null) {
        stages.push(
          await this.runStage('deploy', async () => {
            const out = await this.config.target.rollback(artifact as DeployArtifact);
            return `rolled back: ${out}`;
          }),
        );
        status = 'rolled_back';
      }
    }

    const finishedAt = this.deps.now();
    return {
      component: this.config.component,
      version: this.config.version,
      status,
      artifact,
      stages,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
    };
  }

  private async runStage(
    stage: DeployStage,
    action: () => Promise<string>,
  ): Promise<StageResult> {
    const startedAt = this.deps.now();
    this.deps.log(`[deploy] → ${stage} started`);
    try {
      const output = await action();
      const finishedAt = this.deps.now();
      this.deps.log(`[deploy] ✓ ${stage} succeeded (${finishedAt - startedAt}ms)`);
      return {
        stage,
        status: 'succeeded',
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        output,
      };
    } catch (error) {
      const finishedAt = this.deps.now();
      const message = this.describeError(error);
      this.deps.log(`[deploy] ✗ ${stage} failed: ${message}`);
      // Guardamos el resultado fallido en el reporte y re-lanzamos para cortar.
      const result: StageResult = {
        stage,
        status: 'failed',
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        output: '',
        error: message,
      };
      throw new StageFailure(result);
    }
  }

  private async runSmoke(): Promise<string> {
    const { url, expectStatus, retries, retryDelayMs } = this.config.healthCheck;
    let lastStatus = -1;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const { status } = await this.deps.probe(url);
        lastStatus = status;
        if (expectStatus.includes(status)) {
          return `smoke OK ${url} → ${status} (attempt ${attempt + 1})`;
        }
      } catch (error) {
        lastStatus = -1;
        this.deps.log(`[deploy] smoke attempt ${attempt + 1} error: ${this.describeError(error)}`);
      }
      if (attempt < retries) {
        await this.deps.sleep(retryDelayMs);
      }
    }
    throw new DeployError(
      'smoke',
      `health check failed for ${url}: last status ${lastStatus}, expected one of ${expectStatus.join(', ')}`,
    );
  }

  private assertArtifact(artifact: DeployArtifact | null): DeployArtifact {
    if (artifact === null) {
      throw new DeployError('build', 'build stage did not produce an artifact');
    }
    return artifact;
  }

  private describeError(error: unknown): string {
    if (error instanceof StageFailure) {
      return error.result.error ?? 'unknown stage failure';
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}

/** Envoltorio interno para transportar el `StageResult` fallido por el throw. */
class StageFailure extends Error {
  constructor(public readonly result: StageResult) {
    super(result.error ?? 'stage failed');
    this.name = 'StageFailure';
  }
}
