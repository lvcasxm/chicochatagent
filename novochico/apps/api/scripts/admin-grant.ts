import { USER_ROLES, type UserRole } from '@chicochat/shared';
import { ConfigError, loadConfigFromProcess } from '../src/config';
import { createDatabase } from '../src/db/client';
import { AppError } from '../src/lib/errors';
import { buildLogger } from '../src/lib/logger';
import { createUsers } from '../src/modules/users';

/**
 * `npm run admin:grant -- <e-mail> [papel]`: define o papel de um usuário (padrão `admin`).
 *
 * É assim que nasce o primeiro administrador. O usuário precisa já ter entrado uma vez com a
 * conta institucional: o cadastro só acontece pelo login, nunca por este comando. A troca é
 * registrada na auditoria, e o último administrador nunca pode ser rebaixado.
 */
function isRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const [email, roleArg = 'admin', ...extra] = process.argv.slice(2);
if (!email || extra.length > 0 || !email.includes('@')) {
  fail(`Uso: npm run admin:grant -- <e-mail> [${USER_ROLES.join('|')}]`);
}
if (!isRole(roleArg)) {
  fail(`Papel inválido. Use um destes: ${USER_ROLES.join(', ')}.`);
}

try {
  const config = loadConfigFromProcess();
  const db = createDatabase(config, buildLogger(config));
  try {
    const users = createUsers({ orm: db.orm });
    const change = await users.changeRole({ email, role: roleArg, actorId: null, via: 'cli' });
    if (change.previousRole === change.role) {
      console.log(`O usuário já tinha o papel "${change.role}". Nada foi alterado.`);
    } else {
      console.log(`Papel alterado de "${change.previousRole}" para "${change.role}".`);
    }
  } finally {
    await db.close();
  }
} catch (error) {
  if (error instanceof ConfigError || error instanceof AppError) fail(error.message);
  console.error(error);
  process.exit(1);
}
