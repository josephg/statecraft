// Simple helpers for bitsets (eg supported query type fields)

export const bitSet = (...bits: number[]) => {
  let field = 0
  for (let i = 0; i < bits.length; i++) field |= (1<<bits[i])
  return field
}

export const hasBit = (field: number, bitNum: number): boolean => (
  !!(field & (1 << bitNum))
)
