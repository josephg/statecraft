import {I, stores, subValues, setSingle, registerType} from '@statecraft/core'
import {connectToWS, connectMux, BothMsg} from '@statecraft/net'
import State, {MIDIPort, MIDIInput} from './state'

import {type as jsonType, insertOp, replaceOp, JSONOp, removeOp} from 'ot-json1'
registerType(jsonType)

const {singlemem} = stores

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
    keys: {},//new Array(128).fill(null),
    pots: new Array(8).fill(NaN), //[],
    sliders: [NaN],
    pitch: 64,
    modulation: 0,
  })

  let data: State = {
    timeOrigin: performance.timeOrigin,
    inputs: inputs.map(inputPortData),
    outputs: outputs.map(portData),
  }

  console.log('state', data)
  console.log(inputs[0].connection, inputs[0].state)
  const localStore = singlemem<State>(data)

  const [reader, writer] = await connectToWS<BothMsg, BothMsg>(wsurl)
  const remoteStore = await connectMux<void>(reader, writer, localStore, true)

  const apply = (op: JSONOp) => {
    console.log('before', data, 'op', op)
    data = jsonType.apply(data, op)
    console.log('after', data)
    return localStore.mutate(I.ResultType.Single, {type: 'json1', data: op})
  }

  const subscribeToInput = (input: WebMidi.MIDIInput, i: number) => {
    // console.log(i)
    input.onmidimessage = m => {
      // console.log(input.name, m.data, m.timeStamp)

      const [mtype, oper1, oper2] = m.data
      const inputData = data.inputs[i]
      const {keys, pots, sliders} = inputData
      switch (mtype) {
        case 0x90: // Note ON
          apply(replaceOp(['inputs', i, 'keys', ''+oper1], keys[oper1], {held: true, pressure: oper2, timestamp: m.timeStamp}))
          break
        case 0x80: // Note OFF
          apply(replaceOp(['inputs', i, 'keys', ''+oper1], keys[oper1], {held: false, pressure: 0, timestamp: m.timeStamp}))
          break
        case 176: { // Pots and sliders
          const field = oper1 === 1 ? ['modulation']
            : (oper1 >= 0x15 && oper1 <= 0x1c) ? ['pots', oper1 - 0x15]
            : (oper1 === 0x7) ? ['sliders', 0]
            : null
          if (field == null) console.log('unknown CC /', oper1, oper2)
          else apply(replaceOp(['inputs', i, ...field], true, oper2))
          break
        }
        case 224: // Pitch slider
          apply(replaceOp(['inputs', i, 'pitch'], inputData.pitch, oper2))
          break
        default:
          console.log('unknown message', mtype, oper1, oper2)
          break
      }
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

