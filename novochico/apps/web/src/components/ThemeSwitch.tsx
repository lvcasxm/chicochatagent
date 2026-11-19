import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../app/theme/ThemeProvider';
import type { ResolvedTheme } from '../app/theme/theme';
import { IconButton } from './IconButton';

const OPTIONS: Array<{ value: ResolvedTheme; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Tema claro', icon: Sun },
  { value: 'dark', label: 'Tema escuro', icon: Moon },
];

/**
 * Claro e escuro, com o tema em uso marcado. A tela já abre no tema do aparelho; escolher o mesmo
 * tema do aparelho volta a acompanhá-lo, e escolher o outro fica salvo.
 */
export function ThemeSwitch() {
  const { resolved, setTheme } = useTheme();
  return (
    <div role="group" aria-label="Tema" className="flex items-center">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <IconButton
          key={value}
          label={label}
          pressed={resolved === value}
          onClick={() => setTheme(value)}
          icon={<Icon className="size-5" />}
        />
      ))}
    </div>
  );
}
