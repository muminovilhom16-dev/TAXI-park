import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ApiRequestError, errorMessage } from "./api";

/** A mutation that splits API errors into field errors and a form-level message. */
export function useFormMutation<V, R>(fn: (v: V) => Promise<R>, onSuccess: (r: R) => void | Promise<void>) {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: fn,
    onMutate: () => {
      setFieldErrors({});
      setFormError(null);
    },
    onSuccess,
    onError: (err) => {
      if (err instanceof ApiRequestError && Array.isArray(err.details)) setFieldErrors(err.fieldErrors());
      setFormError(errorMessage(err));
    },
  });
  return { ...m, fieldErrors, formError };
}
