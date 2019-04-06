// Simple helpers for bitsets (eg supported query type fields)

// TODO: Consider exporting these into a separate tiny package.
export const bitSet = (...bits: number[]) => {
  let field = 0
  for (let i = 0; i < bits.length; i++) field |= (1<<bits[i])
  return field
}

export const bitHas = (field: number, bitNum: number): boolean => (
  !!(field & (1 << bitNum))
)
