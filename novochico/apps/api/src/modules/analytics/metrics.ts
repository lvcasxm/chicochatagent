import type { AdminPeriod, MetricsResponse } from '@chicochat/shared';
import type { AnalyticsReports, Range } from './repository';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** São Paulo fica em UTC-3 o ano todo desde 2019. */
const ZONE_OFFSET = 3 * HOUR;
/** A série diária de "tudo" mostra no máximo o último ano. */
const MAX_SERIES_DAYS = 366;

const PERIOD_DAYS: Record<Exclude<AdminPeriod, 'all'>, number> = {
  today: 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/** Meia-noite (horário de São Paulo) do dia de `at`, como instante UTC. */
function startOfDay(at: Date): number {
  const local = new Date(at.getTime() - ZONE_OFFSET);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + ZONE_OFFSET;
}

/** "Hoje" é desde a meia-noite; "7 dias" é hoje e os 6 anteriores, e assim por diante. */
export function periodRange(period: AdminPeriod, now: Date): Range {
  if (period === 'all') return { from: null, to: now };
  return { from: new Date(startOfDay(now) - (PERIOD_DAYS[period] - 1) * DAY), to: now };
}

const dayKey = (instant: number) => new Date(instant - ZONE_OFFSET).toISOString().slice(0, 10);

/** Todos os dias do período, inclusive os sem atividade, para o gráfico não pular datas. */
function listDays(range: Range, firstDataDay: string | undefined): string[] {
  const last = startOfDay(range.to);
  const earliest = last - (MAX_SERIES_DAYS - 1) * DAY;
  let first = range.from?.getTime() ?? earliest;
  if (range.from === null && firstDataDay) {
    first = Math.max(earliest, Date.parse(`${firstDataDay}T00:00:00.000-03:00`));
  }
  first = Math.max(first, earliest);
  const days: string[] = [];
  for (let instant = startOfDay(new Date(first)); instant <= last; instant += DAY) {
    days.push(dayKey(instant));
  }
  return days;
}

/**
 * Monta a resposta do painel (RF-071 a RF-076). Definições (ADR-018, ADR-040):
 * - sessão: período de atividade da pessoa na conversa, com 30 minutos de intervalo no máximo;
 * - resolvido, escalonado e sem desfecho são contados à parte, sobre as conversas criadas no
 *   período; "em andamento" são as que ainda não foram encerradas;
 * - conversas de teste não entram em nenhum número.
 */
export function createMetricsService(deps: { reports: AnalyticsReports; now: () => Date }) {
  const { reports } = deps;

  return {
    async overview(period: AdminPeriod): Promise<MetricsResponse> {
      const range = periodRange(period, deps.now());

      const [
        totals,
        sessionDays,
        ticketDays,
        failures,
        outcomeRows,
        answered,
        ratingRows,
        minutes,
        categories,
        sectors,
        recent,
        failed,
      ] = await Promise.all([
        reports.messageTotals(range),
        reports.dailySessions(range),
        reports.dailyTickets(range),
        reports.failureCount(range),
        reports.outcomeCounts(range),
        reports.answeredCount(range),
        reports.ratings(range),
        reports.averageConversationMinutes(range),
        reports.topCategories(range),
        reports.topSectors(range),
        reports.recentSessions(range),
        reports.recentFailures(range),
      ]);

      const outcome = (name: string) => outcomeRows.find((row) => row.outcome === name)?.total ?? 0;
      const sessions = sessionDays.reduce((sum, day) => sum + day.sessions, 0);
      const tickets = ticketDays.reduce((sum, day) => sum + day.tickets, 0);

      const ratingCount = ratingRows.reduce((sum, row) => sum + row.total, 0);
      const ratingSum = ratingRows.reduce((sum, row) => sum + row.rating * row.total, 0);

      const sessionsByDay = new Map(sessionDays.map((row) => [row.day, row]));
      const ticketsByDay = new Map(ticketDays.map((row) => [row.day, row.tickets]));
      const firstDataDay = [...sessionsByDay.keys(), ...ticketsByDay.keys()].sort()[0];

      return {
        period,
        from: range.from ? range.from.toISOString() : null,
        to: range.to.toISOString(),
        indicators: {
          users: totals.users,
          sessions,
          messages: totals.messages,
          tickets,
          failures,
          averageRating: ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
          ratingCount,
          averageConversationMinutes: minutes === null ? null : Math.round(minutes * 10) / 10,
        },
        outcomes: {
          resolved: outcome('resolved'),
          escalated: outcome('escalated'),
          noOutcome: outcome('no_outcome'),
          open: outcome('open'),
        },
        series: listDays(range, firstDataDay).map((date) => ({
          date,
          sessions: sessionsByDay.get(date)?.sessions ?? 0,
          users: sessionsByDay.get(date)?.users ?? 0,
          tickets: ticketsByDay.get(date) ?? 0,
        })),
        funnel: {
          users: totals.users,
          sessions,
          answered,
          escalated: outcome('escalated'),
          tickets,
        },
        topCategories: categories.map((row) => ({ key: row.key, count: row.total })),
        topSectors: sectors.map((row) => ({ sector: row.sector, count: row.total })),
        ratingDistribution: [1, 2, 3, 4, 5].map((rating) => ({
          rating,
          count: ratingRows.find((row) => row.rating === rating)?.total ?? 0,
        })),
        recentSessions: recent.map((row) => ({
          conversationId: row.id,
          title: row.title,
          categoryKey: row.category_key,
          outcome: row.outcome,
          lastMessageAt: new Date(row.last_message_at).toISOString(),
        })),
        recentFailures: failed.map((row) => ({
          id: row.id,
          createdAt: new Date(row.created_at).toISOString(),
          status: row.status,
          errorCode: row.error_code,
          conversationId: row.conversation_id,
        })),
      };
    },
  };
}

export type MetricsService = ReturnType<typeof createMetricsService>;
