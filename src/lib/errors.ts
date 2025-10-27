// src/lib/errors.ts
// Utility to safely extract error messages from unknown error objects

export function asMessage(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  const anyErr = err as any;
  if (typeof anyErr?.message === 'string') return anyErr.message;
  if (typeof anyErr?.error?.message === 'string') return anyErr.error.message;
  if (typeof anyErr?.error === 'string') return anyErr.error;
  try { return JSON.stringify(anyErr); } catch { return 'Unknown error'; }
}
