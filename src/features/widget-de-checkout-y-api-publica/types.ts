// Tipos públicos del widget de shipping embebible.
// Sin dependencias externas para mantener el bundle < 30KB.

/** Unidades soportadas para dimensiones y peso. */
export type WeightUnit = 'kg' | 'g' | 'lb';
export type LengthUnit = 'cm' | 'in';

/** Un ítem del carrito usado para calcular el envío. */
export interface CartItem {
  readonly sku: string;
  readonly quantity: number;
  readonly weight: number;
  readonly weightUnit: WeightUnit;
  readonly length?: number;
  readonly width?: number;
  readonly height?: number;
  readonly lengthUnit?: LengthUnit;
}

/** Destino del envío. El código postal es obligatorio; el país por defecto es 'AR'. */
export interface ShippingDestination {
  readonly postalCode: string;
  readonly countryCode: string;
  readonly city?: string;
}

/** Payload que el widget envía a la API pública de cotización. */
export interface QuoteRequest {
  readonly destination: ShippingDestination;
  readonly items: readonly CartItem[];
  readonly currency: string;
}

/** Una tarifa individual devuelta por la API. */
export interface ShippingRate {
  readonly carrier: string;
  readonly service: string;
  readonly amount: number;
  readonly currency: string;
  readonly estimatedDaysMin: number;
  readonly estimatedDaysMax: number;
}

/** Respuesta de la API pública de cotización. */
export interface QuoteResponse {
  readonly rates: readonly ShippingRate[];
}

/** Estado interno de la máquina de estados del widget. */
export type WidgetStatus = 'idle' | 'loading' | 'success' | 'error';

/** Configuración de montaje del widget. */
export interface WidgetConfig {
  /** Endpoint HTTPS de la API pública de cotización. */
  readonly apiUrl: string;
  /** API key pública (scoped read-only) de la tienda. */
  readonly apiKey: string;
  /** Ítems del carrito a cotizar. */
  readonly items: readonly CartItem[];
  /** Moneda ISO-4217, por defecto 'ARS'. */
  readonly currency?: string;
  /** País ISO-3166-1 alpha-2 por defecto para el input, por defecto 'AR'. */
  readonly defaultCountry?: string;
  /** Timeout de la request en ms, por defecto 8000. */
  readonly timeoutMs?: number;
  /** Locale para formateo de moneda, por defecto 'es-AR'. */
  readonly locale?: string;
  /** Callback opcional cuando el usuario selecciona una tarifa. */
  readonly onRateSelected?: (rate: ShippingRate) => void;
}

/** Handle devuelto por mount() para controlar el widget desde el host. */
export interface WidgetHandle {
  /** Actualiza los ítems del carrito y limpia el resultado previo. */
  readonly setItems: (items: readonly CartItem[]) => void;
  /** Desmonta el widget y libera listeners. */
  readonly destroy: () => void;
}

/** Error tipado de la capa de red del widget. */
export class ShippingApiError extends Error {
  public readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ShippingApiError';
    this.status = status;
  }
}
