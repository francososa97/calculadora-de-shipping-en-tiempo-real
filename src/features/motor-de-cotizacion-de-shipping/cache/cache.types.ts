/**
 * Tipos del subsistema de cache de cotizaciones de shipping.
 *
 * Idealmente estos tipos viven en `src/shared/types/index.ts` y se reexportan
 * desde aqui. Mientras ese modulo no exista en el repo, se definen localmente
 * para mantener el feature autocontenido y compilando en modo strict.
 */

export interface Dimensions {
  readonly lengthCm: number;
  readonly widthCm: number;
  readonly heightCm: number;
}

/** Parametros de entrada que identifican univocamente una cotizacion. */
export interface ShippingQuoteRequest {
  readonly originPostalCode: string;
  readonly destinationPostalCode: string;
  readonly countryCode: string;
  readonly weightKg: number;
  readonly dimensions?: Dimensions;
  readonly carrierId?: string;
  readonly declaredValue?: number;
  readonly currency?: string;
}

/** Una opcion de envio concreta devuelta por un carrier. */
export interface ShippingQuoteOption {
  readonly carrierId: string;
  readonly serviceLevel: string;
  readonly amount: number;
  readonly currency: string;
  readonly estimatedDeliveryDays: number;
}

/** Resultado cacheable de una cotizacion (una o mas opciones). */
export interface ShippingQuote {
  readonly requestHash: string;
  readonly options: readonly ShippingQuoteOption[];
  /** Momento en que se genero la cotizacion, en ISO-8601. */
  readonly quotedAt: string;
}

/**
 * Superficie minima de un cliente Redis. Compatible con la firma de `ioredis`
 * (`set(key, value, 'PX', ttlMs)`). Se define asi para no acoplar el feature a
 * una libreria concreta y facilitar el testing con un fake en memoria.
 */
export interface RedisLikeClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'PX', ttlMs: number): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
}
