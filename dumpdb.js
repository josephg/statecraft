const msgpack = require('msgpack-lite')
const lmdb = require('node-lmdb')
const {inspect} = require('util')

const env = new lmdb.Env()
env.open({ path: 'db', maxDbs: 2, noTls: true, })
const snapDb = env.openDbi({name:'snapshots', create:true})

const txn = env.beginTxn({readOnly:true})

const cursor = new lmdb.Cursor(txn, snapDb)

for (let found = cursor.goToFirst(); found; found = cursor.goToNext()) {
  cursor.getCurrentBinary((k, v) => {
    if (k[0] === 1) {
      console.log('reserved', k.slice(1).toString('utf8'), inspect(msgpack.decode(v), {colors:true}))
    } else {
      const [lastMod, data] = msgpack.decode(v)
      console.log(`${k.toString('utf8')}: ${inspect(data, {colors:true})} (v ${lastMod})`)
    }
  })
}

cursor.close()
txn.commit()

