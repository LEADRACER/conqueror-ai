import { EventEmitter } from "node:events";
import type { DashEvent } from "./state.js";
import { nowISO, StateStore } from "./state.js";

export interface EventRefs {
  runId?: string | undefined;
  missionId?: string | undefined;
  taskId?: string | undefined;
  data?: Record<string, unknown> | undefined;
}

export class EventBus {
  private emitter = new EventEmitter();
  constructor(private store: StateStore) {
    this.emitter.setMaxListeners(50);
  }

  emit(type: string, message: string, refs?: EventRefs): DashEvent {
    const evt: DashEvent = {
      id: this.store.nextEventId(),
      ts: nowISO(),
      type,
      message,
    };
    if (refs?.runId !== undefined) evt.runId = refs.runId;
    if (refs?.missionId !== undefined) evt.missionId = refs.missionId;
    if (refs?.taskId !== undefined) evt.taskId = refs.taskId;
    if (refs?.data !== undefined) evt.data = refs.data;
    this.store.addEvent(evt);
    this.emitter.emit("event", evt);
    return evt;
  }

  subscribe(listener: (evt: DashEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }

  since(id: number): DashEvent[] {
    return this.store.snapshot.events.filter((e) => e.id > id);
  }
}
