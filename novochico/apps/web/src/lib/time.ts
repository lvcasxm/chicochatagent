/** Idade em minutos como texto curto: "agora", "há 5 min", "há 3 h", "ontem", "há 4 dias". */
export function ageLabel(minutes: number): string | null {
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${Math.floor(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ontem';
  if (days < 7) return `há ${days} dias`;
  return null;
}

/** Tempo relativo curto para a lista de conversas: "agora", "há 5 min", "ontem", "12/03". */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  return (
    ageLabel(minutes) ?? then.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  );
}

/** Data e hora no fuso de Pedro Leopoldo, qualquer que seja o fuso do aparelho (RF-054). */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
