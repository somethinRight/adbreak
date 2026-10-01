import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Options are [{ value, label }]. `items` lets Base UI show the label of the chosen value. */
export interface Option { value: string; label: string }
interface Props {
  value: string | null;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  label?: string;
  size?: "sm" | "default";
  className?: string;
}

export default function Pick({ value, onChange, options, placeholder, label, size, className = "w-full" }: Props) {
  return (
    <Select items={options} value={value ?? null} onValueChange={v => { if (v != null) onChange(String(v)); }}>
      <SelectTrigger size={size} aria-label={label} className={className}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>{options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}
