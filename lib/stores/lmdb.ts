// This file implements an lmdb kv store on top of prozess.
//
// For now it bootstraps by replaying the event log.

import assert = require('assert')
import lmdb = require('node-lmdb')
import fs = require('fs')
import msgpack = require('msgpack-lite')

// Its very sad that this has a direct dependancy on prozess client.
// It'd be way better to abstract this out, but its too early for that.
import {PClient} from 'prozess-client'
import {encodeTxn, decodeTxn, decodeEvent, mutate} from '../prozess'

import * as I from '../types/interfaces'

const CONFIG_KEY = Buffer.from('\x01config')

const lmdbStore = (client: PClient, location: string, opStore: I.SimpleStore): I.SimpleStore => {
  const env = new lmdb.Env()

  // Check that the directory exists.
  try { fs.mkdirSync(location) }
  catch(e) { if (e.code !== 'EEXIST') throw e }

  env.open({path: location, maxDbs: 2, noTls: true})

  const dbi = env.openDbi({name: null, create: true})
  // const configdb = env.openDbi({name: 'config', create: true})

  // Ok, first do catchup.
  let version: I.Version = 0
  const txn = env.beginTxn()
  const configBytes = txn.getBinary(dbi, CONFIG_KEY)
  if (configBytes == null) {
    console.log('Database was created - no config!')
    version = 0
  } else {
    const config = msgpack.decode(configBytes)
    version = config.version
  }
  txn.commit()

  // TODO: Generate these based on the opstore.
  const capabilities = {
    queryTypes: new Set<I.QueryType>(['allkv', 'kv']),
    mutationTypes: new Set<I.ResultType>(['resultmap']),
  }

  const store: I.SimpleStore = {
    sources: opStore.sources,
    capabilities: capabilities,

    fetch(qtype, query, opts, callback) {
      return callback(Error('Unsupported query type'))
    },

    mutate: opStore.mutate.bind(opStore),
    getOps: opStore.getOps!.bind(opStore),

    close() {
      dbi.close()
      env.close()
      opStore.close()
      // And close the lmdb database.
    },
  }

  return store
}

export default lmdbStore
