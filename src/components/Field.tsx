import { Label } from '@/components/ui/label';

import type { ReactNode } from 'react';

interface Props { label: string; htmlFor?: string; className?: string; children: ReactNode }

export default function Field({ label, htmlFor, className = "", children }: Props) {
  return <div className={`min-w-0 space-y-1 ${className}`}><Label htmlFor={htmlFor}>{label}</Label>{children}</div>;
}
