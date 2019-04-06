import {randomBytes} from 'crypto'

export default function genSource() {
  const sourceBytes = randomBytes(12)
  return sourceBytes.toString('base64')
}
