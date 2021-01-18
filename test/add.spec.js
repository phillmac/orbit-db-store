'use strict'

var assert = require('assert')
const Store = require('../src/Store')

const Cache = require('orbit-db-cache')
const Keystore = require('orbit-db-keystore')
const IdentityProvider = require('orbit-db-identity-provider')
const DefaultOptions = Store.DefaultOptions

// Test utils
const {
  config,
  testAPIs,
  startIpfs,
  stopIpfs,
  implementations
} = require('orbit-db-test-utils')

const properLevelModule = implementations.filter(i => i.key.indexOf('memdown') > -1).map(i => i.module)[0]
const storage = require('orbit-db-storage-adapter')(properLevelModule)

Object.keys(testAPIs).forEach((IPFS) => {
  describe(`addOperation ${IPFS}`, function () {
    let ipfsd, ipfs, testIdentity, identityStore, store, cacheStore

    this.timeout(config.timeout)

    const ipfsConfig = Object.assign({}, config.defaultIpfsConfig, {
      repo: config.defaultIpfsConfig.repo + '-entry' + new Date().getTime()
    })

    before(async () => {
      identityStore = await storage.createStore('identity')
      const keystore = new Keystore(identityStore)

      cacheStore = await storage.createStore('cache')
      const cache = new Cache(cacheStore)

      testIdentity = await IdentityProvider.createIdentity({ id: 'userA', keystore })
      ipfsd = await startIpfs(IPFS, ipfsConfig.daemon1)
      ipfs = ipfsd.api

      const address = 'test-address'
      const options = Object.assign({}, DefaultOptions, { cache })
      store = new Store(ipfs, testIdentity, address, options)
    })

    after(async () => {
      await store.close()
      await stopIpfs(ipfsd)
      await identityStore.close()
      await cacheStore.close()
    })

    afterEach(async () => {
      await store.drop()
      await cacheStore.open()
      await identityStore.open()
    })

    it('adds an operation and triggers the write event', (done) => {
      const data = { data: 12345 }

      store.events.on('write', (address, entry, heads) => {
        assert.strictEqual(heads.length, 1)
        assert.strictEqual(address, 'test-address')
        assert.strictEqual(entry.payload, data)
        assert.strictEqual(store.replicationStatus.progress, 1)
        assert.strictEqual(store.replicationStatus.max, 1)
        assert.strictEqual(store.address.root, store._index.id)
        assert.deepStrictEqual(store._index._index, heads)
        store._cache.get(store.localHeadsPath).then((localHeads) => {
          assert.deepStrictEqual(localHeads[0].payload, data)
          // TODO: Cache not returning LamportClock type for clock
          // assert.deepStrictEqual(localHeads, heads)
          store.events.removeAllListeners('write')
          done()
        })
      })
      store._addOperation(data)
    })

    it('adds multiple operations and triggers multiple write events', async () => {
      const writes = 3
      let eventsFired = 0

      store.events.on('write', (address, entry, heads) => {
        eventsFired++
        if (eventsFired === writes) {
          assert.strictEqual(heads.length, 1)
          assert.strictEqual(store.replicationStatus.progress, writes)
          assert.strictEqual(store.replicationStatus.max, writes)
          assert.strictEqual(store._index._index.length, writes)
          store._cache.get(store.localHeadsPath).then((localHeads) => {
            assert.deepStrictEqual(localHeads[0].payload, store._index._index[2].payload)
            store.events.removeAllListeners('write')
            return Promise.resolve()
          })
        }
      })

      for (let i = 0; i < writes; i++) {
        await store._addOperation({ step: i })
      }
    })

    it('Shows that batch writing is not yet implemented', async () => {
      try {
        await store._addOperationBatch({})
      } catch (e) {
        assert.strictEqual(e.message, 'Not implemented!')
      }
    })
  })
})
