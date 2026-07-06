/**
 * Tipos del subsistema de cola (BullMQ) del Motor de Cotización de Shipping.
 *
 * Estos tipos describen los *jobs* que viajan por la cola para:
 *  - Reintentar cotizaciones que fallaron contra un carrier (timeout, 5xx, rate-limit).
 *  - Refrescar de forma asíncrona cotizaciones cacheadas que están por expirar.
 *
 * Nota: cuando `src/shared/types/index.ts` exista, `ShippingQuote`, `Carrier` y
 * `RateRequest` deberían re-exportarse desde ahí. Mientras tanto se definen aquí
 * las formas mínimas necesarias para que el módulo compile en TS strict.
 */

/** Identificador de un carrier soportado por el motor de cotización. */
export type CarrierId = string;

/** Dirección mínima usada para cotizar. */
export interface Address {
  readonly country: string;
  readonly postalCode: string;
  readonly city?: string;
  readonly state?: string;
}

/** Dimensiones y peso del paquete a cotizar. */
export interface Parcel {
  readonly weightGrams: number;
  readonly lengthCm: number;
  readonly widthCm: number;
  readonly heightCm: number;
}

/** Petición de tarifa que se resuelve contra uno o varios carriers. */
export interface RateRequest {
  readonly origin: Address;
  readonly destination: Address;
  readonly parcels: readonly Parcel[];
  /** Si se omite, se cotiza contra todos los carriers habilitados. */
  readonly carrierIds?: readonly CarrierId[];
}

/** Cotización devuelta por un carrier. */
export interface ShippingQuote {
  readonly carrierId: CarrierId;
  readonly serviceCode: string;
  readonly amount: number;
  readonly currency: string;
  /** Epoch ms en que la cotización deja de ser válida. */
  readonly expiresAt: number;
}

/**
 * Tipos de job soportados por la cola.
 *  - `retry-quote`: reintenta una cotización que falló.
 *  - `refresh-quote`: recotiza de forma proactiva antes de que expire el cache.
 */
export type QuoteJobName = 'retry-quote' | 'refresh-quote';

/** Payload común a todos los jobs de cotización. */
export interface QuoteJobData {
  /** Clave estable del cache que este job debe (re)poblar. */
  readonly cacheKey: string;
  /** Petición original a re-cotizar. */
  readonly request: RateRequest;
  /** Momento en que se encoló el job (epoch ms), inyectado por el productor. */
  readonly enqueuedAt: number;
  /** Motivo por el que se encoló, útil para métricas y debugging. */
  readonly reason: 'carrier-error' | 'cache-expiring' | 'manual';
}

/** Resultado que devuelve el processor y que BullMQ persiste en el job. */
export interface QuoteJobResult {
  readonly cacheKey: string;
  readonly quotes: readonly ShippingQuote[];
  readonly refreshedAt: number;
}

/**
 * Contrato mínimo que el motor debe proveer para que el worker haga su trabajo,
 * inyectado por dependencia para mantener la cola desacoplada del cotizador y
 * facilitar el testing.
 */
export interface QuoteEngine {
  /** Ejecuta la cotización real contra los carriers. */
  quote(request: RateRequest): Promise<readonly ShippingQuote[]>;
  /** Persiste el resultado en el cache bajo la clave dada. */
  writeCache(cacheKey: string, quotes: readonly ShippingQuote[]): Promise<void>;
}

/** Error que el processor marca como no reintentable (fallará el job de inmediato). */
export class NonRetryableQuoteError extends Error {
  public readonly nonRetryable = true as const;
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableQuoteError';
  }
}
