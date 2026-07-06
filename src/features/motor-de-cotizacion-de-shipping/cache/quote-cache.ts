import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';

/**
 * Cache de cotizaciones de shipping en Redis (E1-T2).
 *
 * Las cotizaciones a carriers externos son caras (latencia + rate limits +
 * costo por request). Este cache guarda el resultado de una cotizacion
 * indexado por un hash determinista del request, con TTL configurable, y
 * degrada de forma segura si Redis no esta disponible (nunca rompe el checkout).
 */

/** Parametros que definen de forma univoca una cotizacion de shipping. */
export interface ShippingQuoteRequest {
  /** Codigo postal / punto de origen del despacho. */
  readonly originPostalCode: string;
  /** Codigo postal / punto de destino del comprador. */
  readonly destinationPostalCode: string;
  /** Pais de destino en formato ISO 3166-1 alpha-2 (ej: "AR"). */
  readonly destinationCountry: string;
  /** Peso total del envio en gramos. */
  readonly weightGrams: number;
  /** Dimensiones del paquete en centimetros. */
  readonly dimensionsCm: {
    readonly length: number;
    readonly width: number;
    readonly height: number;
  };
  /** Valor declarado del contenido, para seguro / aduana. */
  readonly declaredValue: number;
  /** Carriers a cotizar (ej: ["correo-argentino", "andreani"]). */
  readonly carriers: readonly string[];
}

/** Tarifa individual de un carrier dentro de una cotizacion. */
export interface CarrierRate {
  readonly carrier: string;
  readonly serviceName: string;
  readonly amount: number;
  readonly currency: string;
  readonly estimatedDeliveryDays: number;
}

/** Resultado de una cotizacion de shipping. */
export interface ShippingQuote {
  readonly rates: readonly CarrierRate[];
  /** Epoch ms en que se genero la cotizacion original. */
  readonly quotedAt: number;
}

/** Cotizacion recuperada del cache junto con metadata de frescura. */
export interface CachedShippingQuote {
  readonly quote: ShippingQuote;
  /** Segundos restantes hasta que expire la entrada en Redis. */
  readonly ttlSeconds: number;
}

export interface QuoteCacheOptions {
  /** Cliente Redis ya conectado (ioredis). */
  readonly redis: Redis;
  /** TTL por defecto de cada cotizacion, en segundos. Default: 900 (15 min). */
  readonly ttlSeconds?: number;
  /** Prefijo de las keys para namespacing. Default: "shipping:quote". */
  readonly keyPrefix?: string;
  /** Logger opcional para observar hits/misses/errores. */
  readonly logger?: QuoteCacheLogger;
}

export interface QuoteCacheLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

const DEFAULT_TTL_SECONDS = 900;
const DEFAULT_KEY_PREFIX = 'shipping:quote';

export class QuoteCache {
  private readonly redis: Redis;
  private readonly ttlSeconds: number;
  private readonly keyPrefix: string;
  private readonly logger: QuoteCacheLogger | undefined;

  constructor(options: QuoteCacheOptions) {
    this.redis = options.redis;
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    this.keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.logger = options.logger;

    if (this.ttlSeconds <= 0) {
      throw new RangeError(`ttlSeconds debe ser mayor a 0, se recibio ${this.ttlSeconds}`);
    }
  }

  /**
   * Construye una key determinista a partir del request. Independiente del
   * orden de `carriers` y de espacios/mayusculas en los codigos postales, de
   * modo que requests equivalentes compartan la misma entrada de cache.
   */
  buildKey(request: ShippingQuoteRequest): string {
    const canonical = {
      o: request.originPostalCode.trim().toUpperCase(),
      d: request.destinationPostalCode.trim().toUpperCase(),
      c: request.destinationCountry.trim().toUpperCase(),
      w: request.weightGrams,
      dim: [request.dimensionsCm.length, request.dimensionsCm.width, request.dimensionsCm.height],
      v: request.declaredValue,
      carriers: [...request.carriers].map((c) => c.trim().toLowerCase()).sort(),
    };
    const hash = createHash('sha1').update(JSON.stringify(canonical)).digest('hex');
    return `${this.keyPrefix}:${hash}`;
  }

  /**
   * Recupera una cotizacion cacheada. Devuelve `null` en miss, entrada corrupta
   * o error de Redis (degradacion segura: el caller debe re-cotizar).
   */
  async get(request: ShippingQuoteRequest): Promise<CachedShippingQuote | null> {
    const key = this.buildKey(request);
    try {
      const [rawResult, ttlResult] = await this.redis
        .multi()
        .get(key)
        .ttl(key)
        .exec();

      const raw = this.unwrap<string | null>(rawResult);
      const ttl = this.unwrap<number>(ttlResult);

      if (raw === null || raw === undefined) {
        this.logger?.debug('quote-cache miss', { key });
        return null;
      }

      const quote = this.parse(raw);
      if (quote === null) {
        this.logger?.warn('quote-cache entrada corrupta, se descarta', { key });
        await this.redis.del(key).catch(() => undefined);
        return null;
      }

      this.logger?.debug('quote-cache hit', { key, ttl });
      return { quote, ttlSeconds: typeof ttl === 'number' && ttl >= 0 ? ttl : this.ttlSeconds };
    } catch (error) {
      this.logger?.warn('quote-cache get fallo, degradando', { key, error: errorMessage(error) });
      return null;
    }
  }

  /**
   * Guarda una cotizacion con TTL. Si Redis falla se ignora el error (el flujo
   * de cotizacion no debe romperse por un problema de cache).
   *
   * @returns `true` si se persistio, `false` si fallo silenciosamente.
   */
  async set(
    request: ShippingQuoteRequest,
    quote: ShippingQuote,
    ttlSecondsOverride?: number,
  ): Promise<boolean> {
    const key = this.buildKey(request);
    const ttl = ttlSecondsOverride ?? this.ttlSeconds;
    if (ttl <= 0) {
      throw new RangeError(`ttlSecondsOverride debe ser mayor a 0, se recibio ${ttl}`);
    }
    try {
      await this.redis.set(key, JSON.stringify(quote), 'EX', ttl);
      this.logger?.debug('quote-cache set', { key, ttl });
      return true;
    } catch (error) {
      this.logger?.warn('quote-cache set fallo, degradando', { key, error: errorMessage(error) });
      return false;
    }
  }

  /**
   * Atajo cache-aside: devuelve la cotizacion cacheada o ejecuta `producer`,
   * cachea el resultado y lo devuelve.
   */
  async getOrSet(
    request: ShippingQuoteRequest,
    producer: () => Promise<ShippingQuote>,
    ttlSecondsOverride?: number,
  ): Promise<ShippingQuote> {
    const cached = await this.get(request);
    if (cached !== null) {
      return cached.quote;
    }
    const fresh = await producer();
    await this.set(request, fresh, ttlSecondsOverride);
    return fresh;
  }

  /** Invalida una cotizacion puntual. Devuelve true si existia. */
  async invalidate(request: ShippingQuoteRequest): Promise<boolean> {
    const key = this.buildKey(request);
    try {
      const removed = await this.redis.del(key);
      return removed > 0;
    } catch (error) {
      this.logger?.warn('quote-cache invalidate fallo', { key, error: errorMessage(error) });
      return false;
    }
  }

  private parse(raw: string): ShippingQuote | null {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isShippingQuote(parsed)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  /** Extrae el valor de una tupla [error, result] devuelta por multi().exec(). */
  private unwrap<T>(entry: [Error | null, unknown] | null | undefined): T | null {
    if (!entry) {
      return null;
    }
    const [err, value] = entry;
    if (err !== null) {
      throw err;
    }
    return value as T;
  }
}

function isShippingQuote(value: unknown): value is ShippingQuote {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.quotedAt !== 'number' || !Array.isArray(candidate.rates)) {
    return false;
  }
  return candidate.rates.every(isCarrierRate);
}

function isCarrierRate(value: unknown): value is CarrierRate {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const r = value as Record<string, unknown>;
  return (
    typeof r.carrier === 'string' &&
    typeof r.serviceName === 'string' &&
    typeof r.amount === 'number' &&
    typeof r.currency === 'string' &&
    typeof r.estimatedDeliveryDays === 'number'
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
