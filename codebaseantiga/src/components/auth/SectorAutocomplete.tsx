import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Building, ChevronDown, Check } from "lucide-react";
import { SECTORES } from "@/lib/auth-constants";

interface Props {
  value: string;
  onSelect: (value: string) => void;
  error?: string;
  className?: string;
  /** Permite informar um setor que não está na lista pré-definida */
  allowCustom?: boolean;
}

export default function SectorAutocomplete({ value, onSelect, error, className, allowCustom = false }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (query === "") {
      setSuggestions(SECTORES);
    } else {
      const filtered = SECTORES.filter((s) =>
        s.toLowerCase().includes(query.toLowerCase())
      );
      setSuggestions(filtered);
    }
    setHighlightedIndex(-1);
  }, [query]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const tryAutoComplete = (): boolean => {
    const q = query.trim();
    if (!q) return false;
    // Exact match (case-insensitive)
    const exact = SECTORES.find((s) => s.toLowerCase() === q.toLowerCase());
    if (exact) {
      onSelect(exact);
      setQuery(exact);
      return true;
    }
    // Unique partial match
    if (suggestions.length === 1) {
      onSelect(suggestions[0]);
      setQuery(suggestions[0]);
      return true;
    }
    // Allow custom sector when explicitly enabled
    if (allowCustom) {
      onSelect(q);
      setQuery(q);
      return true;
    }
    return false;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIsOpen(true);
      setHighlightedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : prev));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : prev));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (isOpen && highlightedIndex >= 0) {
        const selected = suggestions[highlightedIndex];
        onSelect(selected);
        setQuery(selected);
        setIsOpen(false);
      } else if (tryAutoComplete()) {
        setIsOpen(false);
      }
    } else if (e.key === "Tab") {
      if (tryAutoComplete()) {
        setIsOpen(false);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  const handleBlur = () => {
    // Delay to allow click on suggestion to register first
    setTimeout(() => {
      tryAutoComplete();
    }, 150);
  };

  return (
    <div className="relative w-full" ref={containerRef}>
      <div className="relative">
        <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-50 z-10" />
        <Input
          type="text"
          placeholder="Digite ou selecione seu setor"
          value={query}
          onChange={(e) => {
            const v = e.target.value;
            setQuery(v);
            setIsOpen(true);
            if (v === "") {
              onSelect("");
            } else if (allowCustom) {
              // Propaga o valor digitado para que o pai possa validar como setor customizado
              onSelect(v);
            }
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className={`rounded-xl h-12 pl-10 pr-10 ${error ? "border-red-500" : ""} ${className}`}
        />
        <ChevronDown 
          className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-50 transition-transform ${isOpen ? "rotate-180" : ""}`} 
          onClick={() => setIsOpen(!isOpen)}
        />
      </div>

      {isOpen && suggestions.length > 0 && (
        <div className="absolute top-full left-0 w-full mt-2 bg-card border rounded-2xl shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 max-h-60 overflow-y-auto">
          {suggestions.map((s, index) => (
            <button
              key={s}
              type="button"
              className={`w-full text-left px-4 py-3 text-sm flex items-center justify-between transition-colors border-b last:border-0 border-black/5 dark:border-white/5 ${
                highlightedIndex === index ? "bg-black/5 dark:bg-white/10" : "hover:bg-black/5 dark:hover:bg-white/10"
              }`}
              onClick={() => {
                onSelect(s);
                setQuery(s);
                setIsOpen(false);
              }}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              <span className={s === value ? "font-semibold text-primary" : ""}>{s}</span>
              {s === value && <Check className="w-4 h-4 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
