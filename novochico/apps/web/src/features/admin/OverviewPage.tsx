import { Download } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  ADMIN_PERIODS,
  type AdminPeriod,
  type ExportType,
  type InsightsResponse,
  type MetricsResponse,
} from '@chicochat/shared';
import { Button, ButtonLink } from '../../components/Button';
import { Field } from '../../components/Field';
import { Notice } from '../../components/Notice';
import { Select } from '../../components/Select';
import { exportUrl, fetchMetrics, runInsights } from '../../lib/admin-api';
import { formatDateTime } from '../../lib/time';
import { AdminLayout } from './AdminLayout';
import { errorText, HBar, LoadError, LoadingBlock, outcomeLabel, Section, Stat } from './ui';
import { useLoad } from './useLoad';

const PERIOD_LABEL: Record<AdminPeriod, string> = {
  today: 'Hoje',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
  all: 'Tudo',
};

const EXPORTS: Array<{ type: ExportType; label: string }> = [
  { type: 'conversations', label: 'Conversas' },
  { type: 'messages', label: 'Mensagens' },
  { type: 'tickets', label: 'Chamados' },
  { type: 'events', label: 'Eventos' },
  { type: 'feedbacks', label: 'Avaliações' },
];

const SEVERITY_LABEL = { baixa: 'Baixa', media: 'Média', alta: 'Alta' } as const;

const number = (value: number) => value.toLocaleString('pt-BR');
const decimal = (value: number | null, unit = '') =>
  value === null ? 'Sem dados' : `${value.toLocaleString('pt-BR')}${unit}`;

/** Sessões por dia, em barras. A tabela embaixo dá os mesmos números a quem não enxerga o gráfico. */
function SeriesChart({ series }: { series: MetricsResponse['series'] }) {
  const width = 600;
  const height = 140;
  const max = Math.max(1, ...series.map((day) => day.sessions));
  const slot = width / Math.max(series.length, 1);
  const bar = Math.max(2, slot * 0.7);

  return (
    <figure className="flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${width} ${height + 4}`}
        role="img"
        aria-label={`Sessões por dia, de ${series[0]?.date ?? ''} a ${series.at(-1)?.date ?? ''}. Veja a tabela abaixo para os valores.`}
        className="h-auto w-full"
      >
        <line x1="0" x2={width} y1={height} y2={height} className="stroke-border-strong" />
        {series.map((day, index) => {
          const barHeight = (day.sessions / max) * (height - 8);
          return (
            <rect
              key={day.date}
              x={index * slot + (slot - bar) / 2}
              y={height - barHeight}
              width={bar}
              height={barHeight}
              rx="2"
              className="fill-accent stroke-fg"
              strokeWidth={barHeight > 0 ? 1 : 0}
            />
          );
        })}
      </svg>
      <figcaption className="type-small text-fg-muted">
        Sessões por dia (pico: {number(max)}).
      </figcaption>
      <details>
        <summary className="type-small cursor-pointer">Ver os números por dia</summary>
        <div
          role="region"
          tabIndex={0}
          aria-label="Números por dia"
          className="mt-3 max-h-72 overflow-auto"
        >
          <table className="type-small w-full text-left">
            <thead>
              <tr>
                <th className="py-2 pr-4">Dia</th>
                <th className="py-2 pr-4">Sessões</th>
                <th className="py-2 pr-4">Pessoas</th>
                <th className="py-2">Chamados</th>
              </tr>
            </thead>
            <tbody>
              {series.map((day) => (
                <tr key={day.date} className="border-t border-border">
                  <td className="py-2 pr-4">{day.date.split('-').reverse().join('/')}</td>
                  <td className="py-2 pr-4 tabular-nums">{day.sessions}</td>
                  <td className="py-2 pr-4 tabular-nums">{day.users}</td>
                  <td className="py-2 tabular-nums">{day.tickets}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function Insights({ period }: { period: AdminPeriod }) {
  const [result, setResult] = useState<InsightsResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      setResult(await runInsights(period));
    } catch (failure) {
      setResult(null);
      setError(errorText(failure, 'Não foi possível gerar a análise. Tente novamente.'));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Section title="Análise por IA">
      <p className="type-body max-w-reading text-fg-muted">
        Resume os assuntos mais frequentes do período. Só as primeiras falas dos servidores são
        enviadas à IA, sem nome nem e-mail. Cada análise fica registrada na auditoria.
      </p>
      <div>
        <Button variant="outline" loading={running} onClick={() => void run()}>
          {running ? 'Analisando…' : `Analisar: ${PERIOD_LABEL[period].toLowerCase()}`}
        </Button>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {result && (
        <div className="flex max-w-reading flex-col gap-5">
          {result.truncated && (
            <Notice tone="warning">
              A análise usou só uma parte das conversas do período (limite de volume). Escolha um
              período menor para cobrir tudo.
            </Notice>
          )}
          <p className="type-body">{result.summary}</p>
          <p className="type-small text-fg-muted">
            {number(result.analyzedConversations)} conversas analisadas.
          </p>
          <ul className="flex flex-col gap-4">
            {result.insights.map((item) => (
              <li key={item.theme} className="flex flex-col gap-2 rounded-lg bg-surface p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="type-label">{item.theme}</h3>
                  <span className="type-small text-fg-muted">
                    ≈ {number(item.estimatedConversations)} conversas · Gravidade{' '}
                    {SEVERITY_LABEL[item.severity].toLowerCase()}
                  </span>
                </div>
                <p className="type-body">{item.description}</p>
                {item.examples.length > 0 && (
                  <p className="type-small text-fg-muted">Exemplos: {item.examples.join('; ')}</p>
                )}
                {item.recommendation && (
                  <p className="type-small">
                    <strong>Recomendação:</strong> {item.recommendation}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

export function OverviewPage() {
  const [period, setPeriod] = useState<AdminPeriod>('30d');
  const { state, reload } = useLoad(() => fetchMetrics(period), period);

  return (
    <AdminLayout title="Visão geral">
      <Field label="Período" required={false} hideOptionalMark className="max-w-60">
        <Select
          value={period}
          onValueChange={(value) => setPeriod(value as AdminPeriod)}
          options={ADMIN_PERIODS.map((value) => ({ value, label: PERIOD_LABEL[value] }))}
        />
      </Field>

      {state.status === 'loading' && <LoadingBlock label="Carregando os indicadores…" />}
      {state.status === 'error' && (
        <LoadError title="Não foi possível carregar os indicadores" onRetry={reload} />
      )}
      {state.status === 'ready' && <Metrics data={state.data} />}

      <Insights period={period} />

      <Section title="Exportar dados (CSV)">
        <p className="type-body max-w-reading text-fg-muted">
          Os arquivos abrem direto no Excel. Contêm dados pessoais e conteúdo das conversas: use e
          guarde com cuidado. Cada exportação fica registrada na auditoria. Período:{' '}
          {PERIOD_LABEL[period].toLowerCase()}.
        </p>
        <ul className="flex flex-wrap gap-3">
          {EXPORTS.map((item) => (
            <li key={item.type}>
              <ButtonLink
                variant="outline"
                href={exportUrl(item.type, period)}
                download
                iconStart={<Download className="size-5" />}
              >
                {item.label}
              </ButtonLink>
            </li>
          ))}
        </ul>
      </Section>
    </AdminLayout>
  );
}

function Metrics({ data }: { data: MetricsResponse }) {
  const i = data.indicators;
  const o = data.outcomes;
  const funnel = [
    { label: 'Pessoas', value: data.funnel.users },
    { label: 'Sessões', value: data.funnel.sessions },
    { label: 'Com resposta do agente', value: data.funnel.answered },
    { label: 'Escalonadas', value: data.funnel.escalated },
    { label: 'Chamados abertos', value: data.funnel.tickets },
  ];
  const funnelMax = Math.max(...funnel.map((step) => step.value));
  const ratingMax = Math.max(...data.ratingDistribution.map((row) => row.count));

  return (
    <div className="flex flex-col gap-12">
      <Section title="Indicadores">
        <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Pessoas atendidas" value={number(i.users)} />
          <Stat label="Sessões" value={number(i.sessions)} />
          <Stat label="Mensagens" value={number(i.messages)} />
          <Stat label="Chamados abertos" value={number(i.tickets)} />
          <Stat label="Falhas ao abrir chamado" value={number(i.failures)} />
          <Stat
            label="Nota média"
            value={decimal(i.averageRating)}
            note={`${number(i.ratingCount)} avaliações`}
          />
          <Stat
            label="Duração média da conversa"
            value={decimal(i.averageConversationMinutes, ' min')}
          />
        </dl>
      </Section>

      <Section title="Como as conversas terminaram">
        <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Resolvido (confirmado)" value={number(o.resolved)} />
          <Stat label="Escalonado" value={number(o.escalated)} />
          <Stat
            label="Sem desfecho"
            value={number(o.noOutcome)}
            note="Encerrada sem resolver nem abrir chamado"
          />
          <Stat label="Em andamento" value={number(o.open)} />
        </dl>
      </Section>

      <Section title="Sessões por dia">
        <SeriesChart series={data.series} />
      </Section>

      <div className="grid gap-12 lg:grid-cols-2">
        <Section title="Funil de atendimento">
          <ul className="flex flex-col gap-3">
            {funnel.map((step) => (
              <HBar key={step.label} label={step.label} value={step.value} max={funnelMax} />
            ))}
          </ul>
        </Section>
        <Section title="Notas recebidas">
          <ul className="flex flex-col gap-3">
            {data.ratingDistribution.map((row) => (
              <HBar
                key={row.rating}
                label={`Nota ${row.rating}`}
                value={row.count}
                max={ratingMax}
              />
            ))}
          </ul>
        </Section>
        <Section title="Assuntos mais frequentes">
          {data.topCategories.length === 0 ? (
            <p className="type-body text-fg-muted">Sem dados no período.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {data.topCategories.map((row) => (
                <HBar
                  key={row.key}
                  label={row.key}
                  value={row.count}
                  max={data.topCategories[0]?.count ?? 1}
                />
              ))}
            </ul>
          )}
        </Section>
        <Section title="Setores que mais pediram ajuda">
          {data.topSectors.length === 0 ? (
            <p className="type-body text-fg-muted">Sem dados no período.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {data.topSectors.map((row) => (
                <HBar
                  key={row.sector}
                  label={row.sector}
                  value={row.count}
                  max={data.topSectors[0]?.count ?? 1}
                />
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="grid gap-12 lg:grid-cols-2">
        <Section title="Sessões recentes">
          {data.recentSessions.length === 0 ? (
            <p className="type-body text-fg-muted">Nenhuma conversa no período.</p>
          ) : (
            <ul className="flex flex-col border-t border-border">
              {data.recentSessions.map((session) => (
                <li key={session.conversationId} className="border-b border-border">
                  <Link
                    to={`/admin/conversas/${session.conversationId}`}
                    className="motion-color flex min-h-14 flex-col gap-1 rounded-tag px-2 py-3 no-underline hover:bg-surface-hover"
                  >
                    <span className="type-label">{session.title ?? 'Sem título'}</span>
                    <span className="type-small text-fg-muted">
                      {outcomeLabel(session.outcome)} · {formatDateTime(session.lastMessageAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Falhas ao abrir chamado">
          {data.recentFailures.length === 0 ? (
            <p className="type-body text-fg-muted">Nenhuma falha no período.</p>
          ) : (
            <ul className="flex flex-col border-t border-border">
              {data.recentFailures.map((failure) => (
                <li
                  key={failure.id}
                  className="flex flex-col gap-1 border-b border-border px-2 py-3"
                >
                  <span className="type-label">
                    {failure.status === 'unknown' ? 'Resultado incerto' : 'Falhou'} ·{' '}
                    {failure.errorCode ?? 'sem código'}
                  </span>
                  <span className="type-small text-fg-muted">
                    {formatDateTime(failure.createdAt)} ·{' '}
                    <Link to={`/admin/conversas/${failure.conversationId}`}>Ver a conversa</Link>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
