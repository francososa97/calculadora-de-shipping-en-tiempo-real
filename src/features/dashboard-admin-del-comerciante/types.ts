// Domain types for merchant courier & shipping-rule configuration (E2-T2).
// Self-contained: mirror these into src/shared/types/index.ts if a shared layer is introduced.

/** Supported delivery speed tiers offered by a courier. */
export type ServiceLevel = 'standard' | 'express' | 'same_day';

/** How a shipping rate is computed for a given rule. */
export type RateStrategy = 'flat' | 'per_kg' | 'per_item' | 'free';

/** ISO-4217 currency code (validated as a 3-letter uppercase string). */
export type CurrencyCode = string;

/** A configured courier integration owned by a merchant. */
export interface Courier {
  readonly id: string;
  merchantId: string;
  /** Human-readable name shown in the dashboard, e.g. "Andreani". */
  name: string;
  /** Stable machine code, e.g. "andreani", "oca", "correo_argentino". */
  code: string;
  /** Whether this courier is currently offered at checkout. */
  enabled: boolean;
  /** Base URL of the courier rating API (optional for manual couriers). */
  apiBaseUrl?: string;
  /** Opaque API credential reference (never the raw secret). */
  apiKeyRef?: string;
  readonly createdAt: string;
  updatedAt: string;
}

/** A shipping rule that maps order conditions to a computed rate. */
export interface ShippingRule {
  readonly id: string;
  merchantId: string;
  courierId: string;
  name: string;
  serviceLevel: ServiceLevel;
  strategy: RateStrategy;
  /** Base amount (minor units, e.g. cents). Meaning depends on strategy. */
  baseAmount: number;
  currency: CurrencyCode;
  /** Optional lower bound (inclusive) on order weight in grams. */
  minWeightGrams?: number;
  /** Optional upper bound (inclusive) on order weight in grams. */
  maxWeightGrams?: number;
  /** Optional destination filter: list of postal-code prefixes. */
  destinationPrefixes?: readonly string[];
  /** Free-shipping threshold in minor units; orders at/above ship free. */
  freeOverAmount?: number;
  /** Lower number = evaluated first when multiple rules match. */
  priority: number;
  enabled: boolean;
  readonly createdAt: string;
  updatedAt: string;
}

// ---- Input DTOs (what the dashboard sends; ids/timestamps assigned by service) ----

export type CreateCourierInput = Omit<Courier, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateCourierInput = Partial<Omit<Courier, 'id' | 'merchantId' | 'createdAt' | 'updatedAt'>>;

export type CreateShippingRuleInput = Omit<ShippingRule, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateShippingRuleInput = Partial<
  Omit<ShippingRule, 'id' | 'merchantId' | 'createdAt' | 'updatedAt'>
>;

// ---- Persistence & error contracts ----

/** Minimal storage contract; swap the in-memory impl for a DB-backed one. */
export interface CourierStore {
  couriers: Map<string, Courier>;
  rules: Map<string, ShippingRule>;
}

export type NotFoundReason = 'courier' | 'rule';

export class ConfigNotFoundError extends Error {
  constructor(public readonly reason: NotFoundReason, public readonly id: string) {
    super(`${reason} with id "${id}" not found`);
    this.name = 'ConfigNotFoundError';
  }
}

export class ConfigValidationError extends Error {
  constructor(public readonly field: string, message: string) {
    super(`Invalid "${field}": ${message}`);
    this.name = 'ConfigValidationError';
  }
}
