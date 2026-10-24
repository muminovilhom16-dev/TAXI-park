import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm text-muted">
      <span className="tabular">
        {from}–{to} / {total}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Oldingi sahifa">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="tabular px-2">
          {page} / {pages}
        </span>
        <Button variant="ghost" size="icon" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Keyingi sahifa">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
