// Coordination for the agents working in one chat turn: who is running right now, and one
// run per agent at a time (a second message to a busy agent waits for the first reply).

export class AgentBus {
  private live = new Map<string, string>();
  private locks = new Map<string, Promise<unknown>>();

  register(agentId: string, name: string) {
    this.live.set(agentId, name);
  }

  unregister(agentId: string) {
    this.live.delete(agentId);
  }

  running(): string[] {
    return [...this.live.values()];
  }

  busy(agentId: string) {
    return this.locks.has(agentId);
  }

  /** Runs `fn` after any earlier run of the same agent in this turn has finished. */
  run<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(agentId) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    this.locks.set(agentId, next);
    void next.finally(() => {
      if (this.locks.get(agentId) === next) this.locks.delete(agentId);
    }).catch(() => {});
    return next;
  }
}
