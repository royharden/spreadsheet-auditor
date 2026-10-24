// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBudgetQ3 } from '../../generator/samples.ts';
import { runAudit } from '../core/audit.ts';
import { createLocalRulingsStore, memoryBackend } from '../storage/localAdapter.ts';
import { App } from './App.tsx';
import { FakeAuth, sessionA, sessionB, testWorker } from './testSupport.ts';

afterEach(() => cleanup());
function localStore() { return createLocalRulingsStore(memoryBackend()); }
async function loadSample(version: 1 | 2 = 1): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: version === 1 ? 'Load sample' : 'Load sample v2' }));
  await screen.findByRole('heading', { name: version === 1 ? 'Summary: budget-q3.xlsx' : 'Summary: budget-q3-v2.xlsx' });
  await waitFor(() => expect((screen.getByRole('button', { name: 'Confirm' }).closest('fieldset') as HTMLFieldSetElement).disabled).toBe(false));
}
describe('review, persistence and export journey', () => {
  it('appends confirm/dismiss/by_design notes exactly once and exports every finding', async () => {
    const store = localStore(); const append = vi.spyOn(store, 'append'); const download = vi.fn();
    render(<App authGateway={null} functionUrl={null} workerFactory={testWorker} storeFactory={async () => store} download={download} />);
    await loadSample();
    expect(await store.listVersions()).toEqual([]); // mere upload did not register
    const actions = [
      { cell: null, decision: 'Confirm', note: 'Confirmed locally' },
      { cell: 'Open Budget!D6 — FORMULA_DRIFT', decision: 'Dismiss', note: 'Different formula intended' },
      { cell: 'Open Budget!G6 — CONSTANT_PLUG', decision: 'By design', note: 'Fixed input by design' },
    ];
    for (const [index, action] of actions.entries()) {
      if (action.cell) fireEvent.click(screen.getByRole('button', { name: action.cell }));
      fireEvent.change(screen.getByLabelText('Note (local only; included in exports)'), { target: { value: action.note } });
      fireEvent.click(screen.getByRole('button', { name: action.decision }));
      await waitFor(() => expect(append).toHaveBeenCalledTimes(index + 1));
      await waitFor(() => expect((screen.getByRole('button', { name: 'Confirm' }).closest('fieldset') as HTMLFieldSetElement).disabled).toBe(false));
    }
    const version = (await store.listVersions())[0];
    expect((await store.listByWorkbook(version.sha256)).map((ruling) => [ruling.decision, ruling.note, ruling.noteLocalOnly])).toEqual([
      ['confirm', 'Confirmed locally', true], ['dismiss', 'Different formula intended', true], ['by_design', 'Fixed input by design', true],
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Download JSON' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download Markdown' }));
    const json = JSON.parse(download.mock.calls.find(([name]) => String(name).endsWith('.json'))![1] as string) as { reportVersion: number; findings: { ruling?: { decision: string } }[]; setAside: { ruling?: { decision: string } }[]; notTriaged: number };
    expect(json.reportVersion).toBe(1);
    expect(json.findings.some((finding) => finding.ruling?.decision === 'dismiss')).toBe(true);
    expect(json.setAside.some((finding) => finding.ruling?.decision === 'by_design')).toBe(true);
    expect(json.findings.length + json.setAside.length).toBe(runAudit(buildBudgetQ3(1)).findings.length);
    expect(json.notTriaged).toBeGreaterThan(0);
    expect(download.mock.calls.find(([name]) => String(name).endsWith('.md'))![1]).toContain('Fixed input by design');
    await loadSample();
    expect(screen.queryByRole('region', { name: 'Choose workbook lineage' })).toBeNull();
    expect(screen.getByText('Local note: Confirmed locally')).toBeTruthy();
  });
  it('requires a lineage choice before any ruling, carries unchanged history and marks changed formulas stale', async () => {
    const store = localStore(); const old = runAudit(buildBudgetQ3(1));
    const version = await store.registerVersion({ sha256: old.workbook.sha256, displayName: 'budget-q3.xlsx' });
    const drift = old.findings.find((finding) => finding.ruleId === 'FORMULA_DRIFT' && finding.cell === 'D6')!;
    await store.append({ eventId: crypto.randomUUID(), lineageId: version.lineageId, workbookSha256: version.sha256, ruleId: drift.ruleId,
      sheet: drift.sheet, cell: drift.cell, formulaHash: drift.formulaHash, decision: 'dismiss', noteLocalOnly: true, note: 'Prior version note', createdAt: new Date().toISOString() });
    const unchanged = old.findings.find((finding) => finding.cell === 'N2')!;
    await store.append({ eventId: crypto.randomUUID(), lineageId: version.lineageId, workbookSha256: version.sha256, ruleId: unchanged.ruleId,
      sheet: unchanged.sheet, cell: unchanged.cell, formulaHash: unchanged.formulaHash, decision: 'confirm', noteLocalOnly: true, note: 'Unchanged source', createdAt: new Date().toISOString() });
    const append = vi.spyOn(store, 'append');
    render(<App authGateway={null} functionUrl={null} workerFactory={testWorker} storeFactory={async () => store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load sample v2' }));
    await screen.findByRole('region', { name: 'Choose workbook lineage' });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(append).not.toHaveBeenCalled(); expect(await store.listVersions()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Link to budget-q3.xlsx' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Choose workbook lineage' })).toBeNull());
    expect(screen.getByText('Your ruling: confirm')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Budget!D6 — FORMULA_DRIFT' }));
    expect(screen.getByText('Stale: formula changed. Prior ruling is not applied.')).toBeTruthy();
    expect(screen.getByText('Local note: Prior version note')).toBeTruthy();
    expect((await store.listVersions())[1].linkedFromSha256).toBe(version.sha256);
  });
  it('requires exact outbound preview before a Live POST and leaves unavailable Live disabled', async () => {
    const auth = new FakeAuth(sessionA); const store = localStore();
    const transport = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'GET') return new Response(JSON.stringify({ configured: true, reasons: [], model: 'test-only-model' }));
      const request = JSON.parse(String(init.body)) as { bundles: { findingId: string; sha256: string; cells: Record<string, unknown> }[] };
      expect(Object.keys(request).sort()).toEqual(['arm', 'bundles', 'requestId']);
      return new Response(JSON.stringify({ results: request.bundles.map((bundle) => ({ findingId: bundle.findingId, bundleSha256: bundle.sha256,
        triage: 'unclear', explanation: `${Object.keys(bundle.cells)[0]} needs review.`, cited_cells: [Object.keys(bundle.cells)[0]] })) }));
    });
    render(<App authGateway={auth} workerFactory={testWorker} storeFactory={async () => store} functionUrl="https://example.test/explain-findings" transport={transport}
      priceLookup={() => ({ model: 'test-only-model', verifiedAt: '2026-10-24', inputUsdPerMillion: 1, outputUsdPerMillion: 1 })} />);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Live' }) as HTMLButtonElement).disabled).toBe(false));
    await loadSample();
    fireEvent.click(screen.getByRole('button', { name: 'Live' }));
    expect(screen.getByRole('region', { name: 'Outbound bundle preview' })).toBeTruthy();
    expect(transport.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Send these bundles' }));
    await waitFor(() => expect(transport.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1));
  });
  it('shows missing configuration, sign-in and price reasons for disabled Live', () => {
    render(<App authGateway={null} functionUrl={null} storeFactory={async () => localStore()} />);
    expect((screen.getByRole('button', { name: 'Live' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Live unavailable: Backend configuration is missing/).textContent).toContain('Sign in to use Live');
    expect(screen.getByText(/Live unavailable:/).textContent).toContain('Verified dated pricing');
  });
  it('clears the previous account workbook/rulings immediately when identity changes', async () => {
    const auth = new FakeAuth(sessionA); const stores = { 'user-a': localStore(), 'user-b': localStore() };
    const storeFactory = async (owner: string | null) => owner === 'user-a' ? stores['user-a'] : stores['user-b'];
    render(<App authGateway={auth} functionUrl={null} workerFactory={testWorker} storeFactory={storeFactory} />);
    await screen.findByText('Signed in as a@example.test');
    await loadSample();
    fireEvent.click(screen.getByRole('button', { name: 'Mock' }));
    act(() => auth.emit('SIGNED_IN', sessionB));
    expect(screen.queryByRole('heading', { name: 'Summary: budget-q3.xlsx' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Finding detail' })).toBeNull();
    await screen.findByText('Signed in as b@example.test');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Load sample' }) as HTMLButtonElement).disabled).toBe(false));
    await loadSample();
    expect(await stores['user-b'].listVersions()).toEqual([]);
  });
});
