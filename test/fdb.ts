import 'mocha'
import * as I from '../lib/interfaces'
import fdbStore from '../lib/stores/fdb'
import augment from '../lib/augment'
import runTests from './common'
import assert from 'assert'

import * as fdb from 'foundationdb'

fdb.setAPIVersion(600)

const TEST_PREFIX = '__test'
let _dbid = 1
const storeDb = new Map<I.Store<any>, fdb.Database>()

const create = async () => {
  const prefix = TEST_PREFIX + _dbid++
  const db = fdb.openSync().at(prefix)
  await db.clearRange('', Buffer.from([0xff])) // Hope there's no bugs in this one!
  const store = augment(await fdbStore(db))
  // console.log('got store at prefix', prefix)
  storeDb.set(store, db)
  return store
}

const teardown = (store: I.Store<any>) => { // teardown. Nuke it.
  const db = storeDb.get(store)!
  storeDb.delete(store)
  store.close()
  db.clearRange('', Buffer.from([0xff]))
  // TODO: And close the database.
}

describe('fdb', () => {
  try {
    const db = fdb.openSync()
    // db.close()
  } catch (e) {
    console.warn('Warning: Foundationdb instance not found. Skipping foundationdb tests. Error:', e.message)
    return
  }

  // it('hi', async () => {
  //   const store = await create()
  //   setTimeout(() => teardown(store), 10)
  // })
  runTests(create, teardown)
})