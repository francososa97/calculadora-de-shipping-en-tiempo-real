// Tipos para la vista de analytics de latencia y error-rate del dashboard admin.
// Estos tipos modelan las mediciones crudas de cada request al motor de cálculo de
// shipping y las series agregadas que consume la UI del comerciante.

/** Estado final de un request al motor de cálculo de shipping. */
export type RequestOutcome = 'success' | 'client_error' | 'server_error' | 'timeout';

/** Origen del cálculo, útil para segmentar la vista por plataforma del comerciante. */
export type ShippingSource = 'shopify' | 'tiendanube' | 'woocommerce' | 'api' | 'other';

/**
 * Medición cruda de un único request al motor de cálculo de tarifas.
 * `timestamp` en epoch milliseconds; `latencyMs` es la latencia extremo a extremo.
 */
export interface RequestSample {
  readonly timestamp: number;
  readonly latencyMs: number;
  readonly outcome: RequestOutcome;
  readonly source: ShippingSource;
}

/** Granularidad temporal de los buckets del gráfico. */
export type BucketGranularity = 'minute' | 'hour' | 'day';

/** Percentiles de latencia expresados en milisegundos. */
export interface LatencyPercentiles {
  readonly p50: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

/** Un punto de la serie temporal: métricas agregadas dentro de un bucket. */
export interface AnalyticsBucket {
  /** Inicio del bucket en epoch milliseconds (alineado a la granularidad). */
  readonly bucketStart: number;
  readonly totalRequests: number;
  readonly errorCount: number;
  /** Fracción de requests con error en [0, 1]. */
  readonly errorRate: number;
  readonly latency: LatencyPercentiles;
}

/** Resumen global del rango completo consultado, para las tarjetas KPI del header. */
export interface AnalyticsSummary {
  readonly totalRequests: number;
  readonly errorCount: number;
  readonly errorRate: number;
  readonly latency: LatencyPercentiles;
  /** Requests por minuto promedio sobre el rango. */
  readonly throughputPerMinute: number;
}

/** Ventana temporal inclusiva-exclusiva: [from, to). */
export interface TimeRange {
  readonly from: number;
  readonly to: number;
}

/** Parámetros de consulta para construir la vista de analytics. */
export interface AnalyticsQuery {
  readonly range: TimeRange;
  readonly granularity: BucketGranularity;
  /** Si se define, filtra las muestras por plataforma de origen. */
  readonly source?: ShippingSource;
}

/** Respuesta completa que consume la vista de analytics del comerciante. */
export interface LatencyAnalyticsView {
  readonly query: AnalyticsQuery;
  readonly summary: AnalyticsSummary;
  readonly series: readonly AnalyticsBucket[];
}
