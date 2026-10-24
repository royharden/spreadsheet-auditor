import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/core/util/sha256.ts';
import { completeTask, finishRun, pendingTasks, startOrResume, type RunPins } from './heldoutLock.ts';

const hash = (value: string): string => sha256Hex(value);
const pins: RunPins = { corpusSha256: hash('corpus fixture'), manifestSha256: hash('manifest fixture'), gitCommit: 'a'.repeat(40), promptSha256: hash('prompt fixture'), thresholdsSha256: hash('threshold fixture'), modelIdsSha256: hash('models fixture'), systems: ['1'] };

describe('one-time experiment lock', () => {
  it('resumes only missing receipts, preserving completed tasks and an append-only receipt history', () => {
    const initial = startOrResume(null, pins, ['1:two.xlsx', '1:one.xlsx'], 'created');
    const partial = completeTask(initial, '1:one.xlsx', hash('measured receipt fixture'), 'done one');
    const resumed = startOrResume(partial, pins, ['1:one.xlsx', '1:two.xlsx'], 'resumed');
    expect(pendingTasks(resumed)).toEqual(['1:two.xlsx']);
    expect(resumed.receipts.map((receipt) => receipt.event)).toEqual(['created', 'task-completed', 'resumed']);
    expect(() => completeTask(resumed, '1:one.xlsx', hash('new'), 'repeat')).toThrow();
    expect(() => finishRun(resumed, 'too early')).toThrow();
    const finished = finishRun(completeTask(resumed, '1:two.xlsx', hash('second receipt fixture'), 'done two'), 'complete');
    expect(() => startOrResume(finished, pins, finished.tasks, 'repeat')).toThrow('complete');
  });

  it('refuses every digest change and any change to the target task set', () => {
    const initial = startOrResume(null, pins, ['1:one.xlsx'], 'created');
    for (const key of ['corpusSha256', 'manifestSha256', 'promptSha256', 'thresholdsSha256', 'modelIdsSha256'] as const) {
      expect(() => startOrResume(initial, { ...pins, [key]: hash(`changed ${key}`) }, initial.tasks, 'changed')).toThrow('pins changed');
    }
    expect(() => startOrResume(initial, { ...pins, gitCommit: 'b'.repeat(40) }, initial.tasks, 'changed')).toThrow();
    expect(() => startOrResume(initial, { ...pins, systems: ['1', '2'] }, initial.tasks, 'changed')).toThrow();
    expect(() => startOrResume(initial, pins, ['1:new.xlsx'], 'changed')).toThrow();
  });
});
