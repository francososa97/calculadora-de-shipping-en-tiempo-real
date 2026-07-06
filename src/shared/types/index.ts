// Shared domain types for the Real-Time Shipping Calculator.
// Reused across features (dashboard admin, rate engine, checkout widget).

export type ISODateString = string;

/** Supported courier integrations. `custom` is a manually-configured courier. */
export type CourierProvider =
  | 'andreani'
  | 'oca'
  | 'correo-argentino'
  | 'ups'
  | 'fedex'
  | 'dhl'
  | 'custom';

export interface CourierCredentials {
  readonly apiKey?: string;
  readonly apiSecret?: string;
  readonly accountNumber?: string;
}

export interface Courier {
  readonly id: string;
  readonly merchantId: string;
  readonly name: string;
  readonly provider: CourierProvider;
  readonly enabled: boolean;
  readonly credentials: CourierCredentials;
  readonly trackingUrlTemplate: string | null;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
}

export type WeightUnit = 'g' | 'kg';
export type Currency = 'ARS' | 'USD' | 'BRL' | 'MXN' | 'EUR';

/** Predicate a rule must satisfy to apply. Null bounds mean unbounded. */
export interface RuleConditions {
  readonly minWeight: number | null;
  readonly maxWeight: number | null;
  readonly weightUnit: WeightUnit;
  readonly minOrderValue: number | null;
  readonly maxOrderValue: number | null;
  /** Destination zone codes (postal prefixes / province codes). Empty = any zone. */
  readonly destinationZones: readonly string[];
}

export type RuleActionType = 'flat_rate' | 'percentage_surcharge' | 'free_shipping';

/**
 * What the rule does to the base rate when it matches.
 * - flat_rate: replace the rate with `amount` in `currency`.
 * - percentage_surcharge: add `amount`% to the base rate.
 * - free_shipping: force the rate to 0 (`amount` ignored).
 */
export interface RuleAction {
  readonly type: RuleActionType;
  readonly amount: number;
  readonly currency: Currency;
}

export interface ShippingRule {
  readonly id: string;
  readonly merchantId: string;
  readonly courierId: string;
  readonly name: string;
  readonly enabled: boolean;
  /** Lower number = evaluated first. */
  readonly priority: number;
  readonly conditions: RuleConditions;
  readonly action: RuleAction;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
}

// ---------------------------------------------------------------------------
// Input DTOs
// ---------------------------------------------------------------------------

export interface CreateCourierInput {
  readonly merchantId: string;
  readonly name: string;
  readonly provider: CourierProvider;
  readonly enabled?: boolean;
  readonly credentials?: CourierCredentials;
  readonly trackingUrlTemplate?: string | null;
}

export type UpdateCourierInput = Partial<Omit<CreateCourierInput, 'merchantId'>>;

export interface CreateRuleInput {
  readonly merchantId: string;
  readonly courierId: string;
  readonly name: string;
  readonly enabled?: boolean;
  readonly priority?: number;
  readonly conditions: RuleConditions;
  readonly action: RuleAction;
}

export type UpdateRuleInput = Partial<Omit<CreateRuleInput, 'merchantId' | 'courierId'>>;

// ---------------------------------------------------------------------------
// Result / error handling
// ---------------------------------------------------------------------------

export interface ValidationError {
  readonly field: string;
  readonly message: string;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ValidationError[] };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T>(errors: readonly ValidationError[]): Result<T> {
  return { ok: false, errors };
}
