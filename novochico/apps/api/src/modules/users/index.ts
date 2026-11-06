import type { OrmClient } from '../../db/client';
import { createUsersService } from './service';

export { hasAcceptedCurrentPrivacy } from './service';
export type { RoleChange, UserProfile, UsersService, VerifiedIdentity } from './service';

/** Ponto de entrada do módulo: outros módulos só recebem o service. */
export function createUsers(deps: { orm: OrmClient; now?: () => Date }) {
  return createUsersService(deps);
}
