/**
 * Tipos del sub-dominio de seguridad del Widget de Checkout y API Pública.
 *
 * Nota: se intentó reusar `src/shared/types/index.ts` pero ese módulo no expone
 * (todavía) tipos de autenticación/firmado, por lo que se definen acá los
 * contratos propios de esta feature. Si en el futuro esos tipos se centralizan,
 * mover estas interfaces a shared y re-exportarlas desde este archivo.
 */

/** Entorno al que pertenece una API key. Permite separar tráfico de test/prod. */
export type ApiKeyEnvironment = 'live' | 'test';

/**
 * Representación pública de una API key. Es lo único que se persiste en la DB:
 * NUNCA se guarda el secreto en claro, solo su hash.
 */
export interface ApiKeyRecord {
  /** Identificador público, no secreto. Ej: `pk_live_a1b2c3d4`. */
  readonly id: string;
  /** Id del merchant / tienda dueño de la key. */
  readonly merchantId: string;
  /** Entorno de la key. */
  readonly environment: ApiKeyEnvironment;
  /** Hash SHA-256 (hex) del secreto. Se usa para verificar sin almacenar el secreto. */
  readonly secretHash: string;
  /** Epoch ms de creación. */
  readonly createdAt: number;
  /** Epoch ms de revocación, o null si sigue activa. */
  readonly revokedAt: number | null;
}

/**
 * Resultado de emitir una API key nueva. El `plaintextKey` se muestra UNA sola
 * vez al merchant y no se puede recuperar después.
 */
export interface IssuedApiKey {
  /** El token completo, firmado, para entregar al cliente. Ej: `pk_live_<id>.<sig>`. */
  readonly plaintextKey: string;
  /** El registro persistible (sin secreto en claro). */
  readonly record: ApiKeyRecord;
}

/** Resultado de verificar una API key entrante. */
export type ApiKeyVerification =
  | { readonly valid: true; readonly keyId: string; readonly environment: ApiKeyEnvironment }
  | { readonly valid: false; readonly reason: ApiKeyFailureReason };

export type ApiKeyFailureReason =
  | 'malformed'
  | 'unknown_key'
  | 'revoked'
  | 'bad_signature';

/** Cabeceras que acompañan a un webhook firmado con HMAC. */
export interface WebhookSignatureHeaders {
  /** Timestamp (epoch segundos) usado en la firma. Header: `X-Shipping-Timestamp`. */
  readonly 'x-shipping-timestamp': string;
  /** Firma en formato `v1=<hex>`. Header: `X-Shipping-Signature`. */
  readonly 'x-shipping-signature': string;
}

/** Resultado de verificar la firma HMAC de un webhook entrante. */
export type WebhookVerification =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: WebhookFailureReason };

export type WebhookFailureReason =
  | 'missing_headers'
  | 'malformed_signature'
  | 'timestamp_out_of_tolerance'
  | 'bad_signature';

/** Puerto de persistencia mínimo que necesita el servicio de API keys. */
export interface ApiKeyStore {
  findById(id: string): Promise<ApiKeyRecord | null>;
  save(record: ApiKeyRecord): Promise<void>;
}
