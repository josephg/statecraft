import * as I from '../../lib/interfaces'
import {connect} from '../../lib/stores/wsclient'
import singleMem, {setSingle} from '../../lib/stores/singlemem'
import connectMux, { BothMsg } from '../../lib/net/clientservermux'
import subValues from '../../lib/subvalues'
import State, {MIDIPort, MIDIInput} from './state'

const wsurl = `ws${window.location.protocol.slice(4)}//${window.location.host}/ws`
console.log('wsurl', wsurl)

// let data = new Map<string, Pos>()

// The local store that holds our mouse location

;(async () => {
  const access = await navigator.requestMIDIAccess()
  // Get lists of available MIDI controllers

  const inputs = Array.from(access.inputs.values())
  const outputs = Array.from(access.outputs.values())
  
  const portData = (port: WebMidi.MIDIPort): MIDIPort => ({
    id: port.id, // These IDs are really silly.
    manufacturer: port.manufacturer,
    name: port.name,
    version: port.version,
    state: port.state,
  })
  const inputPortData = (port: WebMidi.MIDIPort): MIDIInput => ({
    ...portData(port),
    keys: [],
    pots: [],
    sliders: [],
  })

  const data: State = {
    timeOrigin: performance.timeOrigin,
    inputs: inputs.map(inputPortData),
    outputs: outputs.map(portData),
  }

  console.log('state', data)
  console.log(inputs[0].connection, inputs[0].state)
  const localStore = singleMem<State>(data)

  const [reader, writer] = await connect<BothMsg, BothMsg>(wsurl)
  const remoteStore = await connectMux<void>(reader, writer, localStore, true)

  const subscribeToInput = (input: WebMidi.MIDIInput, i: number) => {
    // console.log(i)
    input.onmidimessage = m => {
      // console.log(input.name, m.data, m.timeStamp)

      const [mtype, oper1, oper2] = m.data
      const inputData = data.inputs[i]
      const {keys, pots, sliders} = inputData
      switch (mtype) {
        case 144: // Note press
          keys[oper1] = {held: true, pressure: oper2, timestamp: m.timeStamp}
          break
        case 128:
          keys[oper1] = {held: false, pressure: 0, timestamp: m.timeStamp}
          break
        case 176: {
          if (oper1 >= 0x15 && oper1 <= 0x1c) pots[oper1 - 0x15] = oper2
          // else if (oper1 >= 0x29 && oper1 <= 0x) pots[oper1 - 0x15] = oper2
          else if (oper1 === 0x7) sliders[0] = oper2 // Slider 9 / master
          break
        }
        default:
          console.log('unknown message', mtype, oper1, oper2)
          break
      }
      setSingle(localStore, data)
    }
  }
  inputs.forEach(subscribeToInput)

  access.onstatechange = e => {
    // Print information about the (dis)connected MIDI controller
    const {port} = e
    const set = port.type === 'input' ? data.inputs : data.outputs
    const deviceIdx = set.findIndex(({id}) => id === port.id)
    if (deviceIdx >= 0) {
      set[deviceIdx].state = port.state
    } else {
      set.push(port.type === 'input' ? inputPortData(port) : portData(port))
      if (port.type === 'input') subscribeToInput(port as WebMidi.MIDIInput, set.length-1)
    }
    setSingle(localStore, data)

    // console.log('onstatechange', e.port.name, e.port.manufacturer, e.port.state);
    // console.log(e.port.type)
  }
})()

