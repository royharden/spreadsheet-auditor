// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorsWorkbook } from '../core/testFixtures.ts';
import { MAX_COMPRESSED_BYTES } from '../core/sheetmodel/limits.ts';
import { handleAuditRequest, type AuditRequest, type AuditResponse } from '../worker/protocol.ts';
import { App } from './App.tsx';

class FakeWorker {
  onmessage: ((event: MessageEvent<AuditResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  sent: AuditRequest | null = null;
  transfer: Transferable[] = [];
  terminate = vi.fn();
  postMessage(request: AuditRequest, transfer: Transferable[]): void {
    this.sent = request;
    this.transfer = transfer;
  }
  reply(): void {
    if (this.sent) this.onmessage?.({ data: handleAuditRequest(this.sent) } as MessageEvent<AuditResponse>);
  }
}

function fileOf(bytes: Uint8Array, name = 'budget.xlsx'): File {
  const file = new File([], name);
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(copy.buffer) });
  Object.defineProperty(file, 'size', { value: bytes.length, configurable: true });
  return file;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('minimal upload journey', () => {
  it('transfers workbook bytes to the worker and shows the returned summary and findings offline', async () => {
    vi.stubGlobal('fetch', () => { throw new Error('network forbidden'); });
    const worker = new FakeWorker();
    render(<App workerFactory={() => worker as unknown as Worker} />);
    expect(screen.getByText('Rulings are stored in this browser only; nothing is uploaded.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Choose a macro-free .xlsx workbook'), { target: { files: [fileOf(errorsWorkbook())] } });
    await waitFor(() => expect(worker.sent?.fileName).toBe('budget.xlsx'));
    expect(worker.transfer).toEqual([worker.sent?.bytes]);
    expect(screen.getByText('Auditing workbook in this browser…')).toBeTruthy();
    act(() => worker.reply());
    expect(screen.getByRole('heading', { name: 'Summary: budget.xlsx' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Findings' })).toBeTruthy();
    expect(screen.getByText('None.')).toBeTruthy();
    expect(screen.getAllByText(/Citations verified/).length).toBeGreaterThan(0);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('shows a typed gate refusal and permits the same workbook to be selected again', async () => {
    const worker = new FakeWorker();
    render(<App workerFactory={() => worker as unknown as Worker} />);
    const input = screen.getByLabelText('Choose a macro-free .xlsx workbook') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fileOf(new Uint8Array(4), 'old.xls')] } });
    await waitFor(() => expect(worker.sent).not.toBeNull());
    act(() => worker.reply());
    expect(screen.getByRole('alert').textContent).toContain('unsupported-extension');
    expect(input.disabled).toBe(false);
    expect(input.value).toBe('');
  });

  it('sends each generated sample version through the same local worker journey', async () => {
    const workers: FakeWorker[] = [];
    const sampleBuilder = vi.fn((_version: 1 | 2) => errorsWorkbook());
    render(<App sampleBuilder={sampleBuilder} workerFactory={() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load sample' }));
    await waitFor(() => expect(workers[0]?.sent?.fileName).toBe('budget-q3.xlsx'));
    act(() => workers[0].reply());
    fireEvent.click(screen.getByRole('button', { name: 'Load sample v2' }));
    await waitFor(() => expect(workers[1]?.sent?.fileName).toBe('budget-q3-v2.xlsx'));
    act(() => workers[1].reply());
    expect(sampleBuilder.mock.calls.map(([version]) => version)).toEqual([1, 2]);
    expect(screen.getByRole('heading', { name: 'Summary: budget-q3-v2.xlsx' })).toBeTruthy();
  });

  it('refuses oversized files before allocating their byte buffer or creating a worker', () => {
    const file = fileOf(new Uint8Array(1));
    Object.defineProperty(file, 'size', { value: MAX_COMPRESSED_BYTES + 1 });
    const factory = vi.fn();
    render(<App workerFactory={factory} />);
    fireEvent.change(screen.getByLabelText('Choose a macro-free .xlsx workbook'), { target: { files: [file] } });
    expect(screen.getByRole('alert').textContent).toContain('compressed-too-large');
    expect(factory).not.toHaveBeenCalled();
  });

  it('surfaces worker failure and terminates the worker', async () => {
    const worker = new FakeWorker();
    render(<App workerFactory={() => worker as unknown as Worker} />);
    fireEvent.change(screen.getByLabelText('Choose a macro-free .xlsx workbook'), { target: { files: [fileOf(new Uint8Array(1))] } });
    await waitFor(() => expect(worker.sent).not.toBeNull());
    act(() => worker.onerror?.());
    expect(screen.getByRole('alert').textContent).toContain('Audit failed');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
