require('./util')
const alpha = 'abcdefghijklmnopqrstuvwxyz'
const alphabet = alpha + alpha.toUpperCase() + '0123456789'

export default function genSource() {
  let out = ''
  for (let i = 0; i < 12; i++) out += alphabet[(Math.random() * alphabet.length)|0]
  return out
}