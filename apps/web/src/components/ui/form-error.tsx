export function FormError({ message }: { message: string | null | undefined }) {
  return message ? (
    <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
      {message}
    </p>
  ) : null;
}

export function FormActions({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-end gap-2 pt-2">{children}</div>;
}
