import { Writable } from 'node:stream';
import type { Config } from '../src/config';
import type { Database } from '../src/db/client';
import { buildLogger } from '../src/lib/logger';

export const testConfig: Config = {
  env: 'test',
  host: '127.0.0.1',
  port: 0,
  logLevel: 'info',
  databaseUrl: 'postgres://usuario:senha-ficticia@127.0.0.1:1/teste',
};

/** Logger real do projeto, gravando em memória para que os testes inspecionem a saída. */
export function captureLogger() {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    logger: buildLogger(testConfig, destination),
    output: () => chunks.join(''),
  };
}

export function fakeDb(ping: () => Promise<void>): Database {
  return { ping, close: () => Promise.resolve() };
}
