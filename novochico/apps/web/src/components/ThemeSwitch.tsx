import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '../app/theme/ThemeProvider';
import type { ThemePreference } from '../app/theme/theme';
import { IconButton } from './IconButton';

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'system', label: 'Tema do sistema', icon: Monitor },
  { value: 'light', label: 'Tema claro', icon: Sun },
  { value: 'dark', label: 'Tema escuro', icon: Moon },
];

/** Três escolhas visíveis de uma vez (reconhecer em vez de lembrar). A escolha fica salva. */
export function ThemeSwitch() {
  const { preference, setPreference } = useTheme();
  return (
    <div role="group" aria-label="Tema" className="flex items-center">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <IconButton
          key={value}
          label={label}
          pressed={preference === value}
          onClick={() => setPreference(value)}
          icon={<Icon className="size-5" />}
        />
      ))}
    </div>
  );
}
