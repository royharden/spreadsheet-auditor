// Module worker (vite `worker.format: 'es'`): parses and audits one workbook off the UI thread.
// No network: it only receives bytes by postMessage and posts the plain-JSON outcome back.

import { handleAuditRequest, isAuditRequest, type AuditResponse } from './protocol.ts';

/** The slice of DedicatedWorkerGlobalScope this file uses (the app tsconfig has DOM, not WebWorker, libs). */
interface WorkerScope {
  postMessage(message: AuditResponse): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}

const scope = self as unknown as WorkerScope;

scope.addEventListener('message', (event) => {
  if (!isAuditRequest(event.data)) return;
  scope.postMessage(handleAuditRequest(event.data));
});
