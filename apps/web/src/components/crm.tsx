import { CRM_STATUS_LABELS, LICENSE_STATUS_LABELS, type CrmStatus, type LicenseStatus } from "@taxi/shared";
import { Badge } from "@/components/ui/badge";

const STATUS_TONE: Record<CrmStatus, "neutral" | "success" | "warning" | "danger"> = {
  new: "neutral",
  documents_review: "warning",
  active: "success",
  suspended: "warning",
  terminated: "danger",
};

export function CrmStatusBadge({ status }: { status: CrmStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{CRM_STATUS_LABELS[status]}</Badge>;
}

const LICENSE_TONE: Record<LicenseStatus, "neutral" | "success" | "warning" | "danger"> = {
  unknown: "neutral",
  valid: "success",
  expired: "danger",
  missing: "danger",
};

export function LicenseBadge({ status }: { status: LicenseStatus }) {
  return <Badge tone={LICENSE_TONE[status]}>{LICENSE_STATUS_LABELS[status]}</Badge>;
}

/** "+998901234567" → "+998 90 123 45 67" */
export function formatPhone(phone: string) {
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone;
}

/** "01A123BC" → "01 A 123 BC", "01123ABC" → "01 123 ABC" */
export function formatPlate(plate: string) {
  const a = /^(\d{2})([A-Z])(\d{3})([A-Z]{2})$/.exec(plate);
  if (a) return `${a[1]} ${a[2]} ${a[3]} ${a[4]}`;
  const b = /^(\d{2})(\d{3})([A-Z]{3})$/.exec(plate);
  if (b) return `${b[1]} ${b[2]} ${b[3]}`;
  return plate;
}
