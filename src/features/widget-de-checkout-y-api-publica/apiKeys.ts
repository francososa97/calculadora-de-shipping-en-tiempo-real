import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Prefijo que identifica una API key firmada de la calculadora de shipping. */
export const API_KEY_PREFIX = 'ship_live';

const ENCODING = 'base64url';
const SEPARATOR = '.';

/** Datos embebidos y firmados dentro de una API key (verificables sin DB). */
export interface ApiKeyPayload {
  /** Identificador opaco de la key (para lookup / revocacion). */
  readonly keyId: string;
  /** Tenant / tienda duena de la key. */
  readonly tenantId: string;
  /** Scopes concedidos (ej: 'rates:read', 'webhooks:manage'). */
  readonly scopes: readonly string[];
  /** Emision en epoch ms. */
  readonly issuedAt: number;
}

/** Resultado de emitir una nueva API key. */
export interface IssuedApiKey {
  /** Token completo, entregado al cliente UNA sola vez. */
  readonly token: string;
  /** Metadata persistible (nunca contiene el secreto de firma). */
  readonly payload: ApiKeyPayload;
}

/** Resultado tipado de verificar una API key. */
export type ApiKeyVerification =
  | { readonly ok: true; readonly payload: ApiKeyPayload }
  | { readonly ok: false; readonly reason: 'malformed' | 'bad_signature' | 'expired' };

function encodePayload(payload: ApiKeyPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString(ENCODING);
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data, 'utf8').digest(ENCODING);
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function isApiKeyPayload(value: unknown): value is ApiKeyPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.keyId === 'string' &&
    typeof v.tenantId === 'string' &&
    Array.isArray(v.scopes) &&
    v.scopes.every((s): s is string => typeof s === 'string') &&
    typeof v.issuedAt === 'number'
  );
}

/** Genera un identificador de key opaco y no adivinable. */
export function generateKeyId(): string {
  return `ak_${randomBytes(12).toString('hex')}`;
}

/**
 * Emite una API key firmada. El token tiene la forma:
 *   ship_live.<payload_b64url>.<hmac_b64url>
 * y puede verificarse de forma stateless con el mismo `secret`.
 */
export function issueApiKey(
  input: { readonly tenantId: string; readonly scopes: readonly string[]; readonly keyId?: string },
  secret: string,
  now: number = Date.now(),
): IssuedApiKey {
  if (secret.length < 32) {
    throw new Error('El secreto de firma de API keys debe tener al menos 32 caracteres.');
  }
  const payload: ApiKeyPayload = {
    keyId: input.keyId ?? generateKeyId(),
    tenantId: input.tenantId,
    scopes: [...input.scopes],
    issuedAt: now,
  };
  const body = `${API_KEY_PREFIX}${SEPARATOR}${encodePayload(payload)}`;
  const signature = sign(body, secret);
  return { token: `${body}${SEPARATOR}${signature}`, payload };
}

/**
 * Verifica una API key firmada de forma stateless y timing-safe.
 * @param options.maxAgeMs edad maxima permitida; 0 (default) = sin expiracion.
 */
export function verifyApiKey(
  token: string,
  secret: string,
  options: { readonly maxAgeMs?: number; readonly now?: number } = {},
): ApiKeyVerification {
  const parts = token.split(SEPARATOR);
  if (parts.length !== 3) {
    return { ok: false, reason: 'malformed' };
  }
  const [prefix, encoded, signature] = parts;
  if (prefix !== API_KEY_PREFIX || !encoded || !signature) {
    return { ok: false, reason: 'malformed' };
  }

  const body = `${prefix}${SEPARATOR}${encoded}`;
  const expected = sign(body, secret);
  if (!safeEqual(signature, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let payload: ApiKeyPayload;
  try {
    const raw: unknown = JSON.parse(Buffer.from(encoded, ENCODING).toString('utf8'));
    if (!isApiKeyPayload(raw)) {
      return { ok: false, reason: 'malformed' };
    }
    payload = raw;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const maxAgeMs = options.maxAgeMs ?? 0;
  if (maxAgeMs > 0) {
    const now = options.now ?? Date.now();
    if (now - payload.issuedAt > maxAgeMs) {
      return { ok: false, reason: 'expired' };
    }
  }
  return { ok: true, payload };
}

/** Chequea que la key posea un scope concreto. */
export function hasScope(payload: ApiKeyPayload, scope: string): boolean {
  return payload.scopes.includes(scope);
}
