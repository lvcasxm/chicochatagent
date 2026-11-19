import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  readStoredPreference,
  storePreference,
  type ResolvedTheme,
  type ThemePreference,
} from './theme';

interface ThemeContextValue {
  /** O tema em uso: a escolha salva ou, sem ela, o do aparelho. */
  resolved: ResolvedTheme;
  /** Escolher o mesmo tema do aparelho apaga a escolha salva, e a tela volta a acompanhá-lo. */
  setTheme: (theme: ResolvedTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const DARK_QUERY = '(prefers-color-scheme: dark)';

function subscribeToSystemTheme(onChange: () => void) {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

const systemPrefersDark = () => window.matchMedia(DARK_QUERY).matches;

/** Aplica o tema ao documento e o mantém em dia com a escolha e com o tema do aparelho. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const systemDark = useSyncExternalStore(subscribeToSystemTheme, systemPrefersDark, () => false);
  const resolved: ResolvedTheme =
    preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
  }, [resolved]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      resolved,
      setTheme: (theme) => {
        const next: ThemePreference = theme === (systemDark ? 'dark' : 'light') ? 'system' : theme;
        storePreference(next);
        setPreferenceState(next);
      },
    }),
    [resolved, systemDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme precisa estar dentro de ThemeProvider');
  return value;
}
