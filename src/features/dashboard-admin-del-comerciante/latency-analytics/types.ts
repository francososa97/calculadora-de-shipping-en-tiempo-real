// Tipos para la vista de analytics de latencia y error-rate del dashboard admin.
// La calculadora de shipping expone un endpoint de cotización en tiempo real; el
// comerciante necesita monitorear cuán rápido y confiable responde ese servicio.

/** Resultado observado de una cotización de shipping individual. */
export type RateRequestOutcome = 'success' | 'error' | 'timeout';

/**
 * Muestra cruda de una request de cotización. Cada llamada al motor de
 * shipping produce exactamente una muestra que alimenta las analytics.
 */
export interface RateRequestSample {
  /** Epoch en milisegundos en que la request fue recibida. */
  readonly timestamp: number;
  /** Latencia extremo a extremo de la cotización, en milisegundos. */
  readonly latencyMs: number;
  /** Resultado de la request. */
  readonly outcome: RateRequestOutcome;
  /** Carrier/proveedor consultado (p.ej. 'oca', 'andreani', 'correo-ar'). */
  readonly carrier: string;
  /** Código HTTP de respuesta del proveedor, si aplica. */
  readonly statusCode?: number;
}

/** Ventana temporal de consulta, en epoch milisegundos [from, to). */
export interface TimeWindow {
  readonly from: number;
  readonly to: number;
}

/** Parámetros para consultar analytics. */
export interface AnalyticsQuery {
  readonly window: TimeWindow;
  /** Tamaño de cada bucket de la serie temporal, en milisegundos. */
  readonly bucketSizeMs: number;
  /** Filtro opcional por carrier; si se omite, agrega todos. */
  readonly carrier?: string;
}

/** Estadísticas de latencia agregadas de un conjunto de muestras. */
export interface LatencyStats {
  readonly count: number;
  readonly avgMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
}

/** Estadísticas de confiabilidad (error-rate) de un conjunto de muestras. */
export interface ReliabilityStats {
  readonly total: number;
  readonly successCount: number;
  readonly errorCount: number;
  readonly timeoutCount: number;
  /** Proporción de fallos (error + timeout) sobre el total, en rango [0, 1]. */
  readonly errorRate: number;
  /** Proporción de éxitos sobre el total, en rango [0, 1]. */
  readonly successRate: number;
}

/** Un punto de la serie temporal (un bucket). */
export interface AnalyticsBucket {
  /** Inicio del bucket en epoch milisegundos. */
  readonly bucketStart: number;
  readonly latency: LatencyStats;
  readonly reliability: ReliabilityStats;
}

/** Respuesta completa de la vista de analytics. */
export interface AnalyticsView {
  readonly window: TimeWindow;
  readonly carrier: string | null;
  /** Métricas agregadas de toda la ventana. */
  readonly overall: {
    readonly latency: LatencyStats;
    readonly reliability: ReliabilityStats;
  };
  /** Serie temporal ordenada cronológicamente. */
  readonly series: readonly AnalyticsBucket[];
}
