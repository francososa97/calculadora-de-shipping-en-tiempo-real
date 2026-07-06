// Tipos de dominio para autenticación multi-tenant del dashboard admin.
// Cada "tenant" es un comercio (merchant). Con Clerk, un tenant se mapea 1:1
// a una Clerk Organization, y cada usuario puede pertenecer a varios comercios.

/** Roles soportados dentro de un comercio. Se derivan del rol de la Organization en Clerk. */
export type MerchantRole = 'owner' | 'admin' | 'staff';

/** Identificador opaco de un comercio (== Clerk Organization id, prefijo `org_`). */
export type MerchantId = string;

/** Identificador opaco de un usuario (== Clerk User id, prefijo `user_`). */
export type UserId = string;

/** Comercio al que pertenece el usuario autenticado. */
export interface Merchant {
  id: MerchantId;
  /** Nombre visible del comercio. */
  name: string;
  /** Slug único usado en URLs (p. ej. `/t/mi-tienda`). */
  slug: string;
  /** Rol del usuario actual dentro de este comercio. */
  role: MerchantRole;
}

/** Usuario autenticado, sin contexto de comercio todavía. */
export interface AuthUser {
  id: UserId;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

/**
 * Contexto de autenticación resuelto para una request del dashboard.
 * `activeMerchant` es null cuando el usuario está logueado pero aún no
 * seleccionó (o no pertenece a) ningún comercio.
 */
export interface TenantContext {
  user: AuthUser;
  activeMerchant: Merchant | null;
  /** Todos los comercios a los que el usuario tiene acceso. */
  merchants: Merchant[];
}

/** Resultado de resolver el contexto: o hay sesión, o el motivo por el que no. */
export type AuthResult =
  | { readonly authenticated: true; readonly context: TenantContext }
  | { readonly authenticated: false; readonly reason: 'no-session' | 'no-merchant-access' };

/** Error lanzado cuando una operación requiere un comercio activo y no lo hay. */
export class TenantAccessError extends Error {
  public readonly code: 'no-session' | 'no-merchant-access';

  constructor(code: 'no-session' | 'no-merchant-access') {
    super(
      code === 'no-session'
        ? 'No hay una sesión de usuario activa.'
        : 'El usuario no tiene acceso a ningún comercio.',
    );
    this.name = 'TenantAccessError';
    this.code = code;
  }
}
