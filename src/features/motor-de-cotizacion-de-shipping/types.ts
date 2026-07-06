// Tipos del motor de cotización de shipping.
// Si existe src/shared/types/index.ts en el proyecto, estos tipos deberían
// re-exportarse desde ahí; se definen localmente para que la feature sea
// autocontenida y compile en TypeScript strict.

/** Dimensiones físicas de un paquete, en unidades métricas. */
export interface PackageDimensions {
  readonly weightKg: number;
  readonly lengthCm: number;
  readonly widthCm: number;
  readonly heightCm: number;
}

/** Parámetros de entrada para solicitar una cotización de envío. */
export interface ShippingQuoteRequest {
  readonly originPostalCode: string;
  readonly destinationPostalCode: string;
  readonly countryCode: string;
  readonly dimensions: PackageDimensions;
  /** Valor declarado del contenido, en la moneda de la tienda. */
  readonly declaredValue: number;
  readonly currency: string;
  /** Identificador del carrier específico, si se cotiza uno solo. */
  readonly carrierId?: string;
}

/** Una opción de envío devuelta por un carrier. */
export interface ShippingRateOption {
  readonly carrierId: string;
  readonly carrierName: string;
  readonly serviceLevel: string;
  readonly amount: number;
  readonly currency: string;
  readonly estimatedDeliveryDays: number;
}

/** Resultado completo de una cotización (una o varias opciones). */
export interface ShippingQuoteResult {
  readonly options: readonly ShippingRateOption[];
  /** Epoch ms en el que se generó la cotización desde el carrier. */
  readonly quotedAtMs: number;
}

/** Contrato mínimo del cliente Redis que consume el cache. */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    mode: 'EX',
    ttlSeconds: number,
  ): Promise<unknown>;
  del(...keys: readonly string[]): Promise<number>;
  scan(
    cursor: string,
    matchToken: 'MATCH',
    pattern: string,
    countToken: 'COUNT',
    count: number,
  ): Promise<[string, string[]]>;
}

/** Configuración del cache de cotizaciones. */
export interface QuoteCacheConfig {
  /** TTL en segundos de cada cotización cacheada. Default: 900 (15 min). */
  readonly ttlSeconds?: number;
  /** Prefijo de namespace para las claves. Default: 'shipping:quote'. */
  readonly keyPrefix?: string;
}
