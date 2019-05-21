
declare module 'cpu-stats' {
  type CPUInfo = {
    cpu: number,
    user: number,
    nice: number,
    sys: number,
    idle: number,
    irq: number
  }
  function stats(samplems: number, cb: (err: Error, result: CPUInfo[]) => void): void;
  export = stats
}
