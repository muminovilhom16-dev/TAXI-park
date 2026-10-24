import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import { Button } from "./button";

export function Loading({ label = "Yuklanmoqda…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-12 text-center">
      <Inbox className="mb-1 h-6 w-6 text-muted" aria-hidden />
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="text-sm text-muted">{hint}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-12 text-center">
      <AlertTriangle className="h-6 w-6 text-danger" aria-hidden />
      <p className="text-sm">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Qayta urinish
        </Button>
      )}
    </div>
  );
}
