import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withRunLease } from './heldoutLock.ts';

const io = vi.hoisted(() => ({
  open: vi.fn(), readFile: vi.fn(), rename: vi.fn(), unlink: vi.fn(), writeFile: vi.fn(),
}));
vi.mock('node:fs/promises', () => io);

function barrier(): { waiting: Promise<void>; release: () => void } {
  let release: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  return {
    waiting,
    release: () => {
      if (release === undefined) throw new Error('Barrier was not initialised');
      release();
    },
  };
}

describe('exclusive experiment process lease', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('blocks both interleaved resumes at an existing abandoned lease without reclaiming it', async () => {
    const path = 'fixture/HELDOUT-RUN.json';
    const leasePath = `${path}.lease`;
    const bothAttempted = barrier();
    const returnExisting = barrier();
    let attempts = 0;
    io.readFile.mockResolvedValue('{"pid":2147483647,"acquiredAt":"abandoned fixture"}');
    io.open.mockImplementation(async () => {
      attempts++;
      if (attempts === 2) bothAttempted.release();
      await returnExisting.waiting;
      throw Object.assign(new Error('existing lease fixture'), { code: 'EEXIST' });
    });
    const ownerProbe = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('exited owner fixture'), { code: 'ESRCH' });
    });
    const workA = vi.fn(async () => 'A');
    const workB = vi.fn(async () => 'B');
    try {
      const contenders = Promise.allSettled([withRunLease(path, workA), withRunLease(path, workB)]);
      // Both resumes encounter the same old lease before either receives EEXIST. Previously
      // both could probe the dead owner, then B could rename the new live lease acquired by A.
      await bothAttempted.waiting;
      returnExisting.release();
      const outcomes = await contenders;
      for (const outcome of outcomes) {
        expect(outcome.status).toBe('rejected');
        if (outcome.status !== 'rejected') throw new Error('An existing lease must block every contender');
        expect(outcome.reason).toBeInstanceOf(Error);
        expect(outcome.reason.message).toContain('Run lease already exists');
      }
      expect(io.open.mock.calls).toEqual([[leasePath, 'wx'], [leasePath, 'wx']]);
      expect(ownerProbe).not.toHaveBeenCalled();
      expect(io.readFile).not.toHaveBeenCalled();
      expect(io.rename).not.toHaveBeenCalled();
      expect(io.unlink).not.toHaveBeenCalled();
      expect(io.writeFile).not.toHaveBeenCalled();
      expect(workA).not.toHaveBeenCalled();
      expect(workB).not.toHaveBeenCalled();
    } finally {
      returnExisting.release();
      ownerProbe.mockRestore();
    }
  });

  it('does not let a blocked contender release the active owner lease', async () => {
    const path = 'fixture/HELDOUT-RUN.json';
    const ownerStarted = barrier();
    const finishOwner = barrier();
    const handle = { writeFile: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
    io.open.mockResolvedValueOnce(handle).mockRejectedValueOnce(Object.assign(new Error('active lease fixture'), { code: 'EEXIST' }));
    const contenderWork = vi.fn(async () => 'contender');
    const owner = withRunLease(path, async () => {
      ownerStarted.release();
      await finishOwner.waiting;
      return 'owner';
    });
    let ownerResult: string | undefined;
    try {
      await ownerStarted.waiting;
      await expect(withRunLease(path, contenderWork)).rejects.toThrow('Run lease already exists');
      expect(contenderWork).not.toHaveBeenCalled();
      expect(handle.close).not.toHaveBeenCalled();
      expect(io.unlink).not.toHaveBeenCalled();
      expect(io.rename).not.toHaveBeenCalled();
    } finally {
      finishOwner.release();
      ownerResult = await owner;
    }
    expect(ownerResult).toBe('owner');
    expect(handle.writeFile).toHaveBeenCalledTimes(1);
    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(io.unlink).toHaveBeenCalledTimes(1);
    expect(io.unlink).toHaveBeenCalledWith(`${path}.lease`);
  });
});
