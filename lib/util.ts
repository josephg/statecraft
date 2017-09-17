import {randomBytes} from 'crypto'

export function genSource() {
  const sourceBytes = randomBytes(12)
  return sourceBytes.toString('base64')
}
