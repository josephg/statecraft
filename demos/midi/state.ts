// Stolen from @types/webmidi
type MIDIPortDeviceState = "disconnected" | "connected";

type MIDIPortConnectionState = "open" | "closed" | "pending";

export interface MIDIPort {
  /**
   * A unique ID of the port. This can be used by developers to remember ports the
   * user has chosen for their application.
   */
  id: string;

  /**
   * The manufacturer of the port.
   */
  manufacturer?: string;

  /**
   * The system name of the port.
   */
  name?: string;

  /**
   * The version of the port.
   */
  version?: string;

  /**
   * The state of the device.
   */
  state: MIDIPortDeviceState;

  /**
   * The state of the connection to the device.
   */
  // connection: MIDIPortConnectionState;
}

export interface MIDIInput extends MIDIPort {
  keys: {
    held: boolean,
    pressure: number,
    timestamp: number
  }[],
  pots: number[],
  sliders: number[],
}
  
export default interface State {
  timeOrigin: number,
  inputs: MIDIInput[],
  outputs: MIDIPort[],
}