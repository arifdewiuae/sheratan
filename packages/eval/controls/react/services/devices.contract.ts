// The interface modules depend on. Nothing above this line knows whether the
// readings come from a socket, a poll, or the fixture next door.

/** One device on the board. */
export interface Device {
  readonly id: number;
  readonly name: string;
  readonly room: string;
  /** The last reading received, in degrees celsius. */
  readonly reading: number;
  /** Whether the device has been calibrated since it was installed. */
  readonly calibrated: boolean;
}

/** One reading arriving from the live feed. */
export interface Reading {
  readonly id: number;
  readonly reading: number;
}

/** The band a reading is expected to stay inside. */
export interface Limits {
  readonly low: number;
  readonly high: number;
}

/** Ends a subscription. Returned by {@link DeviceApi.subscribe}. */
export type Unsubscribe = () => void;

/**
 * A source of devices and their readings.
 *
 * Every promise-returning method takes an `AbortSignal` and must honour it.
 * That is what makes a filter change or an unmount cancel the request rather
 * than merely ignore its answer — TanStack Query hands `queryFn` a signal for
 * exactly this.
 */
export interface DeviceApi {
  /** The devices in one room, or every device when `room` is empty. */
  list(room: string, signal: AbortSignal): Promise<readonly Device[]>;
  /** The band readings are judged against. Configured per site, not per device. */
  limits(signal: AbortSignal): Promise<Limits>;
  /** Calibrates one device and answers with the device as it now stands. */
  calibrate(id: number, signal: AbortSignal): Promise<Device>;
  /**
   * Streams readings in batches until `signal` aborts. Batches, not single
   * values: a feed that delivers hundreds a second should not cost hundreds
   * of calls.
   */
  subscribe(onReadings: (readings: readonly Reading[]) => void, signal: AbortSignal): Unsubscribe;
}
