import { sql } from 'drizzle-orm';
import { ATTENDANCE_SESSION_TIMEOUT_MINUTES } from '@chicochat/shared';
import type { OrmClient } from '../../db/client';

/** Fuso em que os dias são contados nos relatórios: a Prefeitura (UTC-3, sem horário de verão). */
const REPORT_ZONE = 'America/Sao_Paulo';

export interface Range {
  /** Nulo em "tudo". */
  from: Date | null;
  to: Date;
}

/** Condição de período sobre uma coluna `timestamptz`. */
const inRange = (column: ReturnType<typeof sql.raw>, range: Range) =>
  sql`(${range.from}::timestamptz is null or ${column} >= ${range.from}::timestamptz) and ${column} <= ${range.to}::timestamptz`;

const col = (name: string) => sql.raw(name);

/** Resultado de `execute`: as linhas, já com os nomes de coluna da consulta. */
async function rows<T>(orm: OrmClient, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await orm.execute(query);
  return result.rows as T[];
}

/**
 * Consultas dos indicadores do painel (RF-071 a RF-076). Todas ignoram conversas de teste
 * (RF-065) e contam em cima das tabelas de negócio, não dos eventos: assim um evento perdido não
 * distorce o número. O SQL fica aqui; quem monta a resposta é `metrics.ts`.
 */
export function createAnalyticsReports(orm: OrmClient) {
  const notTest = sql`not c.ticket_form_test_mode`;

  return {
    /** Mensagens trocadas e pessoas diferentes que escreveram no período. */
    async messageTotals(range: Range) {
      const [row] = await rows<{ messages: number; users: number }>(
        orm,
        sql`select count(*)::int as messages,
                   count(distinct c.user_id) filter (where m.role = 'user')::int as users
            from messages m join conversations c on c.id = m.conversation_id
            where ${notTest} and m.role in ('user', 'assistant') and ${inRange(col('m.created_at'), range)}`,
      );
      return row ?? { messages: 0, users: 0 };
    },

    /**
     * Sessões de atendimento por dia: uma nova sessão começa na primeira mensagem da pessoa ou
     * depois de 30 minutos sem mensagem dela na mesma conversa (RN-32). Contar assim independe do
     * identificador de sessão guardado, que muda quando a conversa é retomada.
     */
    async dailySessions(range: Range) {
      return rows<{ day: string; sessions: number; users: number }>(
        orm,
        sql`with ordered as (
              select m.created_at, c.user_id,
                     lag(m.created_at) over (partition by m.conversation_id order by m.created_at) as prev
              from messages m join conversations c on c.id = m.conversation_id
              where ${notTest} and m.role = 'user'
            )
            select to_char((created_at at time zone ${REPORT_ZONE})::date, 'YYYY-MM-DD') as day,
                   count(*) filter (
                     where prev is null or created_at - prev > make_interval(mins => ${ATTENDANCE_SESSION_TIMEOUT_MINUTES})
                   )::int as sessions,
                   count(distinct user_id)::int as users
            from ordered
            where ${inRange(col('created_at'), range)}
            group by 1 order by 1`,
      );
    },

    async dailyTickets(range: Range) {
      return rows<{ day: string; tickets: number }>(
        orm,
        sql`select to_char((t.created_at at time zone ${REPORT_ZONE})::date, 'YYYY-MM-DD') as day,
                   count(*)::int as tickets
            from ticket_attempts t
            where t.status = 'success' and not t.is_test and ${inRange(col('t.created_at'), range)}
            group by 1 order by 1`,
      );
    },

    async failureCount(range: Range) {
      const [row] = await rows<{ failures: number }>(
        orm,
        sql`select count(*)::int as failures from ticket_attempts t
            where t.status in ('failed', 'unknown') and not t.is_test and ${inRange(col('t.created_at'), range)}`,
      );
      return row?.failures ?? 0;
    },

    /** Conversas criadas no período por desfecho; `open` é a que ainda não foi encerrada. */
    async outcomeCounts(range: Range) {
      return rows<{ outcome: string; total: number }>(
        orm,
        sql`select coalesce(c.outcome::text, 'open') as outcome, count(*)::int as total
            from conversations c
            where ${notTest} and ${inRange(col('c.created_at'), range)}
            group by 1`,
      );
    },

    /** Conversas do período em que o agente chegou a responder. */
    async answeredCount(range: Range) {
      const [row] = await rows<{ total: number }>(
        orm,
        sql`select count(*)::int as total from conversations c
            where ${notTest} and ${inRange(col('c.created_at'), range)}
              and exists (select 1 from messages m where m.conversation_id = c.id and m.role = 'assistant')`,
      );
      return row?.total ?? 0;
    },

    async ratings(range: Range) {
      return rows<{ rating: number; total: number }>(
        orm,
        sql`select f.rating, count(*)::int as total
            from feedbacks f join conversations c on c.id = f.conversation_id
            where ${notTest} and ${inRange(col('f.created_at'), range)}
            group by f.rating`,
      );
    },

    /** Duração média, da primeira à última mensagem, das conversas que tiveram troca. */
    async averageConversationMinutes(range: Range) {
      const [row] = await rows<{ minutes: number | null }>(
        orm,
        sql`select (avg(extract(epoch from (c.last_message_at - c.created_at))) / 60)::float8 as minutes
            from conversations c
            where ${notTest} and c.last_message_at > c.created_at and ${inRange(col('c.created_at'), range)}`,
      );
      return row?.minutes ?? null;
    },

    async topCategories(range: Range) {
      return rows<{ key: string; total: number }>(
        orm,
        sql`select c.category_key as key, count(*)::int as total
            from conversations c
            where ${notTest} and c.category_key is not null and ${inRange(col('c.created_at'), range)}
            group by 1 order by total desc, key limit 10`,
      );
    },

    async topSectors(range: Range) {
      return rows<{ sector: string; total: number }>(
        orm,
        sql`select c.sector as sector, count(*)::int as total
            from conversations c
            where ${notTest} and c.sector is not null and ${inRange(col('c.created_at'), range)}
            group by 1 order by total desc, sector limit 10`,
      );
    },

    async recentSessions(range: Range) {
      return rows<{
        id: string;
        title: string | null;
        category_key: string | null;
        outcome: 'resolved' | 'escalated' | 'no_outcome' | null;
        last_message_at: Date;
      }>(
        orm,
        sql`select c.id, c.title, c.category_key, c.outcome, c.last_message_at
            from conversations c
            where ${notTest} and ${inRange(col('c.last_message_at'), range)}
            order by c.last_message_at desc limit 30`,
      );
    },

    async recentFailures(range: Range) {
      return rows<{
        id: string;
        created_at: Date;
        status: 'failed' | 'unknown';
        error_code: string | null;
        conversation_id: string;
      }>(
        orm,
        sql`select t.id, t.created_at, t.status, t.error_code, t.conversation_id
            from ticket_attempts t
            where t.status in ('failed', 'unknown') and not t.is_test and ${inRange(col('t.created_at'), range)}
            order by t.created_at desc limit 20`,
      );
    },
  };
}

export type AnalyticsReports = ReturnType<typeof createAnalyticsReports>;
