import { Queue, Worker, QueueEvents, JobsOptions, Job } from 'bullmq';
import IORedis, { Redis, RedisOptions } from 'ioredis';

/**
 * E1-T3 — Cola BullMQ para reintentos y refresh async.
 *
 * Provee una cola dedicada al Motor de Cotización de Shipping que:
 *  - Reintenta cotizaciones fallidas contra carriers externos con backoff exponencial.
 *  - Refresca cotizaciones cacheadas de forma asíncrona antes de que expiren (TTL),
 *    de modo que el checkout siempre pueda leer una tarifa "fresca" sin bloquear.
 *
 * El worker es agnóstico del carrier: recibe un `QuoteJobHandler` inyectado que
 * ejecuta la lógica real de cotización. Esto mantiene la cola desacoplada de los
 * adaptadores de carrier y facilita el testing.
 */

export const SHIPPING_QUOTE_QUEUE = 'shipping-quote' as const;

/** Tipos de trabajo que la cola sabe procesar. */
export type QuoteJobKind = 'retry' | 'refresh';

/** Dirección normalizada usada para cotizar (origen o destino). */
export interface QuoteAddress {
  readonly country: string;
  readonly postalCode: string;
  readonly city?: string;
  readonly state?: string;
}

/** Paquete a cotizar. Pesos en gramos, dimensiones en centímetros. */
export interface QuoteParcel {
  readonly weightGrams: number;
  readonly lengthCm: number;
  readonly widthCm: number;
  readonly heightCm: number;
  readonly declaredValue?: number;
}

/** Payload de un job de cotización encolado. */
export interface QuoteJobData {
  readonly kind: QuoteJobKind;
  /** Identificador estable de la cotización (idempotencia + deduplicación). */
  readonly quoteId: string;
  readonly carrierId: string;
  readonly origin: QuoteAddress;
  readonly destination: QuoteAddress;
  readonly parcels: readonly QuoteParcel[];
  readonly currency: string;
  /** Epoch ms en el que la cotización cacheada expira; usado por refresh. */
  readonly expiresAt?: number;
  /** Metadatos libres (tenant, orderId, etc.) para trazabilidad. */
  readonly meta?: Readonly<Record<string, string>>;
}

/** Tarifa resultante de una cotización exitosa. */
export interface QuoteRate {
  readonly carrierId: string;
  readonly service: string;
  readonly amount: number;
  readonly currency: string;
  readonly estimatedDeliveryDays?: number;
}

/** Resultado que devuelve el worker por cada job. */
export interface QuoteJobResult {
  readonly quoteId: string;
  readonly carrierId: string;
  readonly rates: readonly QuoteRate[];
  /** Epoch ms en que se resolvió el job. */
  readonly resolvedAt: number;
}

/** Handler inyectable que ejecuta la cotización real contra el carrier. */
export type QuoteJobHandler = (data: QuoteJobData) => Promise<readonly QuoteRate[]>;

export interface ShippingQueueConfig {
  /** Conexión Redis existente o opciones para crear una nueva. */
  readonly connection: Redis | RedisOptions;
  /** Cantidad máxima de reintentos por job (default 5). */
  readonly maxAttempts?: number;
  /** Delay base del backoff exponencial en ms (default 2000). */
  readonly backoffBaseMs?: number;
  /** Concurrencia del worker (default 8). */
  readonly concurrency?: number;
  /** Prefijo de claves en Redis (para multi-entorno). */
  readonly prefix?: string;
}

function resolveConnection(connection: Redis | RedisOptions): Redis {
  if (connection instanceof IORedis) {
    return connection;
  }
  // BullMQ requiere maxRetriesPerRequest: null para conexiones de workers.
  return new IORedis({ maxRetriesPerRequest: null, ...(connection as RedisOptions) });
}

/**
 * Fachada sobre BullMQ que agrupa la Queue de productor, el Worker consumidor
 * y los QueueEvents. Encapsula las políticas de reintento y de refresh async.
 */
export class ShippingQuoteQueue {
  private readonly connection: Redis;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly concurrency: number;
  private readonly prefix?: string;

  private readonly queue: Queue<QuoteJobData, QuoteJobResult, QuoteJobKind>;
  private worker: Worker<QuoteJobData, QuoteJobResult, QuoteJobKind> | null = null;
  private events: QueueEvents | null = null;

  constructor(config: ShippingQueueConfig) {
    this.connection = resolveConnection(config.connection);
    this.maxAttempts = config.maxAttempts ?? 5;
    this.backoffBaseMs = config.backoffBaseMs ?? 2000;
    this.concurrency = config.concurrency ?? 8;
    this.prefix = config.prefix;

    this.queue = new Queue<QuoteJobData, QuoteJobResult, QuoteJobKind>(SHIPPING_QUOTE_QUEUE, {
      connection: this.connection,
      prefix: this.prefix,
      defaultJobOptions: this.defaultJobOptions(),
    });
  }

  private defaultJobOptions(): JobsOptions {
    return {
      attempts: this.maxAttempts,
      backoff: { type: 'exponential', delay: this.backoffBaseMs },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600 },
    };
  }

  /**
   * Encola (o re-encola) una cotización para reintento asíncrono.
   * Usa `quoteId` como jobId para deduplicar reintentos del mismo pedido.
   */
  async enqueueRetry(
    data: Omit<QuoteJobData, 'kind'>,
    opts?: JobsOptions,
  ): Promise<Job<QuoteJobData, QuoteJobResult, QuoteJobKind>> {
    const payload: QuoteJobData = { ...data, kind: 'retry' };
    return this.queue.add('retry', payload, {
      jobId: `retry:${data.quoteId}`,
      ...opts,
    });
  }

  /**
   * Programa un refresh asíncrono de una cotización cacheada.
   * Si `expiresAt` viene definido, el job se demora para dispararse
   * `leadTimeMs` antes de la expiración (nunca en el pasado).
   */
  async enqueueRefresh(
    data: Omit<QuoteJobData, 'kind'>,
    leadTimeMs = 60_000,
    opts?: JobsOptions,
  ): Promise<Job<QuoteJobData, QuoteJobResult, QuoteJobKind>> {
    const payload: QuoteJobData = { ...data, kind: 'refresh' };
    const delay = this.computeRefreshDelay(data.expiresAt, leadTimeMs);
    return this.queue.add('refresh', payload, {
      jobId: `refresh:${data.quoteId}`,
      delay,
      ...opts,
    });
  }

  private computeRefreshDelay(expiresAt: number | undefined, leadTimeMs: number): number {
    if (typeof expiresAt !== 'number') {
      return 0;
    }
    const fireAt = expiresAt - leadTimeMs;
    const delay = fireAt - Date.now();
    return delay > 0 ? delay : 0;
  }

  /**
   * Arranca el worker consumidor con el handler de cotización provisto.
   * Idempotente: llamadas subsecuentes devuelven el worker existente.
   */
  startWorker(handler: QuoteJobHandler): Worker<QuoteJobData, QuoteJobResult, QuoteJobKind> {
    if (this.worker) {
      return this.worker;
    }

    this.worker = new Worker<QuoteJobData, QuoteJobResult, QuoteJobKind>(
      SHIPPING_QUOTE_QUEUE,
      async (job): Promise<QuoteJobResult> => {
        const rates = await handler(job.data);
        if (rates.length === 0) {
          // Sin tarifas => forzamos el retry de BullMQ.
          throw new Error(`No rates returned for quote ${job.data.quoteId} (carrier ${job.data.carrierId})`);
        }
        return {
          quoteId: job.data.quoteId,
          carrierId: job.data.carrierId,
          rates,
          resolvedAt: Date.now(),
        };
      },
      {
        connection: this.connection,
        prefix: this.prefix,
        concurrency: this.concurrency,
      },
    );

    return this.worker;
  }

  /** Expone la Queue subyacente para casos avanzados (métricas, drain, etc.). */
  get raw(): Queue<QuoteJobData, QuoteJobResult, QuoteJobKind> {
    return this.queue;
  }

  /** QueueEvents lazy para suscribirse a completed/failed globalmente. */
  getEvents(): QueueEvents {
    if (!this.events) {
      this.events = new QueueEvents(SHIPPING_QUOTE_QUEUE, {
        connection: this.connection,
        prefix: this.prefix,
      });
    }
    return this.events;
  }

  /** Cierra worker, events y queue de forma ordenada. */
  async close(): Promise<void> {
    await this.worker?.close();
    await this.events?.close();
    await this.queue.close();
    this.worker = null;
    this.events = null;
  }
}

/** Factory helper para instanciar la cola con defaults sensatos. */
export function createShippingQuoteQueue(config: ShippingQueueConfig): ShippingQuoteQueue {
  return new ShippingQuoteQueue(config);
}
