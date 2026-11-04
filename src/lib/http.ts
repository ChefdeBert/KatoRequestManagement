import { jsonError } from './auth';
import { LifecycleError } from './lifecycle';

/** Map domain errors to HTTP responses. */
export function handleError(err: unknown) {
  if (err instanceof LifecycleError) {
    return jsonError(err.status, err.message, err.details ? { details: err.details } : undefined);
  }
  console.error(err);
  return jsonError(500, 'Unexpected error');
}
