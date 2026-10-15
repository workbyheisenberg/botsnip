import { EventEmitter } from "node:events";

/** In-process pub/sub used to push live updates to SSE clients. */
export const bus = new EventEmitter();
bus.setMaxListeners(200);

export interface BusPayloads {
  activity: unknown;
  launch: unknown;
  status: unknown;
}

export function publish<K extends keyof BusPayloads>(event: K, payload: BusPayloads[K]): void {
  bus.emit(event, payload);
}
