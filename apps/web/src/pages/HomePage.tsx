import { CheckCircle2, Circle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";

// Honest readiness list; replaced by the real dashboard in step 4.
const MODULES: { name: string; ready: boolean }[] = [
  { name: "Login, rollar va ruxsatlar", ready: true },
  { name: "Xodimlarni boshqarish", ready: true },
  { name: "Audit tarixi", ready: true },
  { name: "Haydovchilar CRM va agregatorlar", ready: false },
  { name: "Hisobot importi, komissiya va to'lovlar", ready: false },
  { name: "Moliyaviy dashboard va hisobotlar", ready: false },
];

export function HomePage() {
  const { user } = useAuth();
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Assalomu alaykum, {user?.fullName}</h2>
        <p className="text-sm text-muted">Siz {user?.role.name.toLowerCase()} sifatida kirgansiz.</p>
      </div>
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold">Tizim modullari</h3>
        <ul className="space-y-2">
          {MODULES.map((m) => (
            <li key={m.name} className="flex items-start gap-2 text-sm">
              {m.ready ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="Tayyor" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-label="Keyingi bosqichda" />
              )}
              <span className={m.ready ? "" : "text-muted"}>
                {m.name}
                {!m.ready && <span className="text-xs"> · keyingi bosqichda</span>}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
