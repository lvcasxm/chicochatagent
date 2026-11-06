import { Monitor, Wifi, KeyRound, IdCard, ClipboardList } from "lucide-react";

const categories = [
  { icon: Monitor, label: "Hardware", prompt: "Estou com um problema no meu computador" },
  { icon: Wifi, label: "Internet", prompt: "Estou sem acesso à internet" },
  { icon: KeyRound, label: "Senha", prompt: "Esqueci minha senha" },
  { icon: IdCard, label: "Acesso", prompt: "Preciso de acesso a um sistema" },
  { icon: ClipboardList, label: "Outros", prompt: "Tenho uma dúvida de informática" },
];

export function CategoryChips({ onSelect }: { onSelect: (prompt: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {categories.map((cat) => (
        <button
          key={cat.label}
          onClick={() => onSelect(cat.prompt)}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-secondary text-secondary-foreground hover:bg-primary hover:text-primary-foreground transition-colors text-sm font-medium"
        >
          <cat.icon className="w-4 h-4" />
          {cat.label}
        </button>
      ))}
    </div>
  );
}
