// The operation store.
//
// This is implemented as pairs of files:
//
// - index file starts with 8 bytes of operation # offset, then it contains
// packed 6 byte file offsets. (Allowing the data file to be up to 281TB). This
// is a little inefficient - its super redundant because ops are really small.
// Probably a keyframing system then...  something? would work better. But
// packing it smaller would make a bunch of assumptions about how large the
// transactions are. *shrug*
//
// - Data file contains actual encoded data of the corresponding transaction.
//
//
// In practice the transactions will be msgpack-encoded, but I don't care about
// that here.

const fs = require('fs')
const assert = require('assert')

const readPos = (buf, offset = 0) => buf.readInt32LE(offset) + buf.readInt16LE(offset + 4) << 32
const writePos = (buf, pos) => {
  buf.writeUInt32LE(pos & 0xffffffff, 0)
  buf.writeUInt16LE((pos / 0x100000000) & 0xffff, 4)
}

const doNothing = () => {}

const open = (path, magic) => {
  if (typeof magic === 'string') magic = Buffer.from(magic)
  assert.equal(magic.length, 4)

  if (!fs.existsSync(path)) {
    fs.writeFileSync(path, magic, {mode:0o666})
    return fs.openSync(path, 'r+')
  } else {
    const fd = fs.openSync(path, 'r+')
    const buf = Buffer.allocUnsafe(4)
    fs.readSync(fd, buf, 0, 4, 0)
    assert(buf.equals(magic), `File magic does not match ${magic} !== ${buf}`)
    return fd
  }
}

const idxFilePos = i => i*6+4

class OpStore {
  constructor(basePath, baseV = 0) {
    this.baseV = baseV

    // YOLO. This will be opened once, so I'm not too bothered by using the sync versions.
    this.indexFile = open(`${basePath}.index`, 'STCi')
    this.dataFile = open(`${basePath}.data`, 'STCd')

    const idxSize = fs.fstatSync(this.indexFile).size
    const dataSize = fs.fstatSync(this.dataFile).size

    const buf = Buffer.allocUnsafe(6)

    this.numRecords = (((idxSize-4)/6)|0) - 1 // Literally order of operations hell.
    if (this.numRecords > 0) {
      // Get the last offset - the extra record on the end has the expected
      // next position.
      fs.readSync(this.indexFile, buf, 0, 6, idxFilePos(this.numRecords))
      this.nextWritePos = readPos(buf)
      if (dataSize !== this.nextWritePos) {
        console.log('truncating data')
        // I guess this isn't actually strictly necessary
        //fs.ftruncateSync(this.dataFile, expectSize)
      }
    } else {
      writePos(buf, 4)
      fs.writeSync(this.indexFile, buf, 0, 6, idxFilePos(0))
      this.numRecords = 0
      this.nextWritePos = 4
      //fs.ftruncateSync(this.dataFile, 0)
    }
  }

  expectedNextV() { return this.baseV + this.numRecords }

  fsync(callback) {
    // TODO: It would be better to do these together... *shrug*
    fs.fdatasync(this.indexFile, err => {
      if (err) return callback(err)
      fs.fdatasync(this.dataFile, callback)
    })
  }

  append(version, data, callback) {
    if (version !== this.expectedNextV()) return callback(Error('Unexpected version number'))
    if (typeof data === 'string') data = Buffer.from(data)

    fs.write(this.dataFile, data, 0, data.length, this.nextWritePos, (err, written) => {
      if (err) return callback(err)
      assert.equal(written, data.length, 'Not all data written')

      this.nextWritePos += data.length
      this.numRecords++

      const buf = Buffer.allocUnsafe(6)
      writePos(buf, this.nextWritePos)
      fs.write(this.indexFile, buf, 0, 6, idxFilePos(this.numRecords), (err, written) => {
        if (!err) assert.equal(written, 6, 'Not all data written')
        callback(err)
      })
    })
  }

  // Get operations in the range [v1, v2)
  getOps(v1, v2, eachFn, callback = doNothing) {
    if (v1 < this.baseV) throw Error('Requested range start not available')
    if (v2 > this.expectedNextV()) throw Error('Requested range end not available')

    if (v2 <= v1) return callback()

    const idxData = Buffer.allocUnsafe(6 * (v2 - v1 + 1))
    fs.read(this.indexFile, idxData, 0, idxData.length, idxFilePos(v1 - this.baseV), (err, bytesRead) => {
      if (err) return callback(err)
      assert.equal(bytesRead, idxData.length)

      //console.log(idxData)

      // Ok we have the indexes. Eh I'll just bulk read the data from the file
      // into ram. Its memory inefficient, but whatever. Fine for now.

      const startPos = readPos(idxData, 0)
      const endPos = readPos(idxData, idxData.length - 6)

      const opData = Buffer.allocUnsafe(endPos - startPos)
      fs.read(this.dataFile, opData, 0, opData.length, startPos, (err, bytesRead) => {
        if (err) return callback(err)
        assert.equal(bytesRead, opData.length)

        for (let i = 0; i < v2 - v1; i++) {
          eachFn(i + v1, opData.slice(readPos(idxData, i*6) - startPos, readPos(idxData, (i+1)*6) - startPos))
        }
        callback()
      })
    })
  }

  close() {
    fs.closeSync(this.indexFile)
    fs.closeSync(this.dataFile)
    this.indexFile = this.dataFile = null
  }
}

module.exports = (path, baseV = 0, callback) => {
  if (typeof baseV === 'function') [baseV, ready] = [0, baseV]
  const store = new OpStore(path, baseV)
  callback(null, store.expectedNextV())
}

if (require.main === module) {
  // This is a simple little test but it doesn't actually try to persist any data.
  s = new OpStore('_test')
  s.append(0, "hi there", err => {
    if (err) throw err
    s.append(1, "omg", err => {
      if (err) throw err

      s.getOps(0, 2, (v, data) => console.log(v, data.toString('utf8')), () => {
        s.close()
        fs.unlinkSync('_test.index')
        fs.unlinkSync('_test.data')
      })
    })
  })
}

