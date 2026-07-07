/**
 * Tipos de dominio del Motor de cotización de shipping (Épica E1).
 *
 * Nota: `src/shared/types/index.ts` todavía no existe en el repo (setup inicial
 * E1-T1). Cuando exista, mover aquí los tipos verdaderamente compartidos
 * (p. ej. Money, CountryCode) y reexportarlos desde este archivo.
 */

/** Código de país ISO 3166-1 alpha-2 (ej. "AR", "CL", "US"). */
export type CountryCode = string;

/** Importe monetario en unidades menores (centavos) para evitar errores de float. */
export interface Money {
  /** Monto en centavos. 1000 = $10.00 */
  readonly amountCents: number;
  /** Moneda ISO 4217 (ej. "ARS", "USD"). */
  readonly currency: string;
}

/** Dimensiones físicas de un paquete. */
export interface Dimensions {
  readonly lengthCm: number;
  readonly widthCm: number;
  readonly heightCm: number;
}

/** Paquete a cotizar. */
export interface Parcel {
  readonly weightGrams: number;
  readonly dimensions: Dimensions;
  /** Valor declarado del contenido, usado para seguro. Opcional. */
  readonly declaredValue?: Money;
}

/** Dirección mínima necesaria para cotizar (origen o destino). */
export interface Address {
  readonly country: CountryCode;
  readonly postalCode: string;
  readonly city?: string;
  readonly state?: string;
}

/** Request de cotización que entra al motor. */
export interface QuoteRequest {
  readonly origin: Address;
  readonly destination: Address;
  readonly parcels: readonly Parcel[];
}

/** Una tarifa devuelta por un courier concreto. */
export interface ShippingRate {
  readonly courier: string;
  /** Identificador del servicio dentro del courier (ej. "standard", "express"). */
  readonly service: string;
  readonly serviceName: string;
  readonly price: Money;
  /** Rango estimado de entrega en días hábiles. */
  readonly estimatedDeliveryDaysMin: number;
  readonly estimatedDeliveryDaysMax: number;
}

/** Respuesta agregada del motor: tarifas de todos los couriers consultados. */
export interface QuoteResponse {
  readonly requestedAt: string;
  readonly rates: readonly ShippingRate[];
}

/**
 * Contrato que todo adaptador de courier debe cumplir.
 * Cada courier concreto (Andreani, OCA, etc.) implementa esta interfaz.
 */
export interface CourierAdapter {
  /** Nombre único del courier, usado como identificador y en logs. */
  readonly name: string;
  /** Devuelve las tarifas disponibles de este courier para el request dado. */
  getRates(request: QuoteRequest): Promise<readonly ShippingRate[]>;
}

/** Token de inyección de NestJS para el array de adaptadores de courier. */
export const COURIER_ADAPTERS = Symbol('COURIER_ADAPTERS');

/** Error de dominio para fallas de cotización. */
export class QuoteError extends Error {
  constructor(
    message: string,
    readonly courier?: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'QuoteError';
  }
}
