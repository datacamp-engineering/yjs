import fs from 'fs'

import * as t from 'lib0/testing'
import { init, compare } from './testHelper.js' // eslint-disable-line
import * as Y from '../src/index.js'
import { readClientsStructRefs, readDeleteSet, UpdateDecoderV2, UpdateEncoderV2, writeDeleteSet } from '../src/internals.js'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { createYDocFromNotebookJSON, notebookYDocToJSON } from './createNotebook.js'

/**
 * @typedef {Object} Enc
 * @property {function(Array<Uint8Array>):Uint8Array} Enc.mergeUpdates
 * @property {function(Y.Doc):Uint8Array} Enc.encodeStateAsUpdate
 * @property {function(Y.Doc, Uint8Array):void} Enc.applyUpdate
 * @property {function(Uint8Array):void} Enc.logUpdate
 * @property {function(Uint8Array):{from:Map<number,number>,to:Map<number,number>}} Enc.parseUpdateMeta
 * @property {function(Y.Doc):Uint8Array} Enc.encodeStateVector
 * @property {function(Uint8Array):Uint8Array} Enc.encodeStateVectorFromUpdate
 * @property {string} Enc.updateEventName
 * @property {string} Enc.description
 * @property {function(Uint8Array, Uint8Array):Uint8Array} Enc.diffUpdate
 */

/**
 * @type {Enc}
 */
const encV1 = {
  mergeUpdates: Y.mergeUpdates,
  encodeStateAsUpdate: Y.encodeStateAsUpdate,
  applyUpdate: Y.applyUpdate,
  logUpdate: Y.logUpdate,
  parseUpdateMeta: Y.parseUpdateMeta,
  encodeStateVectorFromUpdate: Y.encodeStateVectorFromUpdate,
  encodeStateVector: Y.encodeStateVector,
  updateEventName: 'update',
  description: 'V1',
  diffUpdate: Y.diffUpdate
}

/**
 * @type {Enc}
 */
const encV2 = {
  mergeUpdates: Y.mergeUpdatesV2,
  encodeStateAsUpdate: Y.encodeStateAsUpdateV2,
  applyUpdate: Y.applyUpdateV2,
  logUpdate: Y.logUpdateV2,
  parseUpdateMeta: Y.parseUpdateMetaV2,
  encodeStateVectorFromUpdate: Y.encodeStateVectorFromUpdateV2,
  encodeStateVector: Y.encodeStateVector,
  updateEventName: 'updateV2',
  description: 'V2',
  diffUpdate: Y.diffUpdateV2
}

/**
 * @type {Enc}
 */
const encDoc = {
  mergeUpdates: (updates) => {
    const ydoc = new Y.Doc({ gc: false })
    updates.forEach(update => {
      Y.applyUpdateV2(ydoc, update)
    })
    return Y.encodeStateAsUpdateV2(ydoc)
  },
  encodeStateAsUpdate: Y.encodeStateAsUpdateV2,
  applyUpdate: Y.applyUpdateV2,
  logUpdate: Y.logUpdateV2,
  parseUpdateMeta: Y.parseUpdateMetaV2,
  encodeStateVectorFromUpdate: Y.encodeStateVectorFromUpdateV2,
  encodeStateVector: Y.encodeStateVector,
  updateEventName: 'updateV2',
  description: 'Merge via Y.Doc',
  /**
   * @param {Uint8Array} update
   * @param {Uint8Array} sv
   */
  diffUpdate: (update, sv) => {
    const ydoc = new Y.Doc({ gc: false })
    Y.applyUpdateV2(ydoc, update)
    return Y.encodeStateAsUpdateV2(ydoc, sv)
  }
}

const encoders = [encV1, encV2, encDoc]

/**
 * @param {Array<Y.Doc>} users
 * @param {Enc} enc
 */
const fromUpdates = (users, enc) => {
  const updates = users.map(user =>
    enc.encodeStateAsUpdate(user)
  )
  const ydoc = new Y.Doc()
  enc.applyUpdate(ydoc, enc.mergeUpdates(updates))
  return ydoc
}

/**
 * @param {t.TestCase} tc
 */
export const testMergeUpdates = tc => {
  const { users, array0, array1 } = init(tc, { users: 3 })

  array0.insert(0, [1])
  array1.insert(0, [2])

  compare(users)
  encoders.forEach(enc => {
    const merged = fromUpdates(users, enc)
    t.compareArrays(array0.toArray(), merged.getArray('array').toArray())
  })
}

/**
 * @param {t.TestCase} tc
 */
export const testKeyEncoding = tc => {
  const { users, text0, text1 } = init(tc, { users: 2 })

  text0.insert(0, 'a', { italic: true })
  text0.insert(0, 'b')
  text0.insert(0, 'c', { italic: true })

  const update = Y.encodeStateAsUpdateV2(users[0])
  Y.applyUpdateV2(users[1], update)

  t.compare(text1.toDelta(), [{ insert: 'c', attributes: { italic: true } }, { insert: 'b' }, { insert: 'a', attributes: { italic: true } }])

  compare(users)
}

/**
 * @param {Y.Doc} ydoc
 * @param {Array<Uint8Array>} updates - expecting at least 4 updates
 * @param {Enc} enc
 * @param {boolean} hasDeletes
 */
const checkUpdateCases = (ydoc, updates, enc, hasDeletes) => {
  const cases = []

  // Case 1: Simple case, simply merge everything
  cases.push(enc.mergeUpdates(updates))

  // Case 2: Overlapping updates
  cases.push(enc.mergeUpdates([
    enc.mergeUpdates(updates.slice(2)),
    enc.mergeUpdates(updates.slice(0, 2))
  ]))

  // Case 3: Overlapping updates
  cases.push(enc.mergeUpdates([
    enc.mergeUpdates(updates.slice(2)),
    enc.mergeUpdates(updates.slice(1, 3)),
    updates[0]
  ]))

  // Case 4: Separated updates (containing skips)
  cases.push(enc.mergeUpdates([
    enc.mergeUpdates([updates[0], updates[2]]),
    enc.mergeUpdates([updates[1], updates[3]]),
    enc.mergeUpdates(updates.slice(4))
  ]))

  // Case 5: overlapping with many duplicates
  cases.push(enc.mergeUpdates(cases))

  // const targetState = enc.encodeStateAsUpdate(ydoc)
  // t.info('Target State: ')
  // enc.logUpdate(targetState)

  cases.forEach((mergedUpdates, i) => {
    // t.info('State Case $' + i + ':')
    // enc.logUpdate(updates)
    const merged = new Y.Doc({ gc: false })
    enc.applyUpdate(merged, mergedUpdates)
    t.compareArrays(merged.getArray().toArray(), ydoc.getArray().toArray())
    t.compare(enc.encodeStateVector(merged), enc.encodeStateVectorFromUpdate(mergedUpdates))

    if (enc.updateEventName !== 'update') { // @todo should this also work on legacy updates?
      for (let j = 1; j < updates.length; j++) {
        const partMerged = enc.mergeUpdates(updates.slice(j))
        const partMeta = enc.parseUpdateMeta(partMerged)
        const targetSV = Y.encodeStateVectorFromUpdateV2(Y.mergeUpdatesV2(updates.slice(0, j)))
        const diffed = enc.diffUpdate(mergedUpdates, targetSV)
        const diffedMeta = enc.parseUpdateMeta(diffed)
        t.compare(partMeta, diffedMeta)
        {
          // We can'd do the following
          //  - t.compare(diffed, mergedDeletes)
          // because diffed contains the set of all deletes.
          // So we add all deletes from `diffed` to `partDeletes` and compare then
          const decoder = decoding.createDecoder(diffed)
          const updateDecoder = new UpdateDecoderV2(decoder)
          readClientsStructRefs(updateDecoder, new Y.Doc())
          const ds = readDeleteSet(updateDecoder)
          const updateEncoder = new UpdateEncoderV2()
          encoding.writeVarUint(updateEncoder.restEncoder, 0) // 0 structs
          writeDeleteSet(updateEncoder, ds)
          const deletesUpdate = updateEncoder.toUint8Array()
          const mergedDeletes = Y.mergeUpdatesV2([deletesUpdate, partMerged])
          if (!hasDeletes || enc !== encDoc) {
            // deletes will almost definitely lead to different encoders because of the mergeStruct feature that is present in encDoc
            t.compare(diffed, mergedDeletes)
          }
        }
      }
    }

    const meta = enc.parseUpdateMeta(mergedUpdates)
    meta.from.forEach((clock, client) => t.assert(clock === 0))
    meta.to.forEach((clock, client) => {
      const structs = /** @type {Array<Y.Item>} */ (merged.store.clients.get(client))
      const lastStruct = structs[structs.length - 1]
      t.assert(lastStruct.id.clock + lastStruct.length === clock)
    })
  })
}

/**
 * @param {t.TestCase} tc
 */
export const testMergeUpdates1 = tc => {
  encoders.forEach((enc, i) => {
    t.info(`Using encoder: ${enc.description}`)
    const ydoc = new Y.Doc({ gc: false })
    const updates = /** @type {Array<Uint8Array>} */ ([])
    ydoc.on(enc.updateEventName, update => { updates.push(update) })

    const array = ydoc.getArray()
    array.insert(0, [1])
    array.insert(0, [2])
    array.insert(0, [3])
    array.insert(0, [4])

    checkUpdateCases(ydoc, updates, enc, false)
  })
}

/**
 * @param {t.TestCase} tc
 */
export const testMergeUpdates2 = tc => {
  encoders.forEach((enc, i) => {
    t.info(`Using encoder: ${enc.description}`)
    const ydoc = new Y.Doc({ gc: false })
    const updates = /** @type {Array<Uint8Array>} */ ([])
    ydoc.on(enc.updateEventName, update => { updates.push(update) })

    const array = ydoc.getArray()
    array.insert(0, [1, 2])
    array.delete(1, 1)
    array.insert(0, [3, 4])
    array.delete(1, 2)

    checkUpdateCases(ydoc, updates, enc, true)
  })
}

/**
 * @param {t.TestCase} tc
 */
export const testMergePendingUpdates = tc => {
  const yDoc = new Y.Doc()
  /**
   * @type {Array<Uint8Array>}
   */
  const serverUpdates = []
  yDoc.on('update', (update, origin, c) => {
    serverUpdates.splice(serverUpdates.length, 0, update)
  })
  const yText = yDoc.getText('textBlock')
  yText.applyDelta([{ insert: 'r' }])
  yText.applyDelta([{ insert: 'o' }])
  yText.applyDelta([{ insert: 'n' }])
  yText.applyDelta([{ insert: 'e' }])
  yText.applyDelta([{ insert: 'n' }])

  const yDoc1 = new Y.Doc()
  Y.applyUpdate(yDoc1, serverUpdates[0])
  const update1 = Y.encodeStateAsUpdate(yDoc1)

  const yDoc2 = new Y.Doc()
  Y.applyUpdate(yDoc2, update1)
  Y.applyUpdate(yDoc2, serverUpdates[1])
  const update2 = Y.encodeStateAsUpdate(yDoc2)

  const yDoc3 = new Y.Doc()
  Y.applyUpdate(yDoc3, update2)
  Y.applyUpdate(yDoc3, serverUpdates[3])
  const update3 = Y.encodeStateAsUpdate(yDoc3)

  const yDoc4 = new Y.Doc()
  Y.applyUpdate(yDoc4, update3)
  Y.applyUpdate(yDoc4, serverUpdates[2])
  const update4 = Y.encodeStateAsUpdate(yDoc4)

  const yDoc5 = new Y.Doc()
  Y.applyUpdate(yDoc5, update4)
  Y.applyUpdate(yDoc5, serverUpdates[4])
  // @ts-ignore
  const update5 = Y.encodeStateAsUpdate(yDoc5) // eslint-disable-line

  const yText5 = yDoc5.getText('textBlock')
  t.compareStrings(yText5.toString(), 'nenor')
}

const splitClocksBy = (/** @type number */ x) => {
  /**
    * @param {number} _client
    * @param {number} clock
    * @param {number} maxClock
    */
  return function * (_client, clock, maxClock) {
    while (clock < maxClock) {
      clock = Math.min(clock + x, maxClock)
      clock = yield clock
    }
  }
}

/**
 * @param {t.TestCase} tc
 */
export const testEncodeStateAsUpdates = tc => {
  const yDoc = new Y.Doc()
  /**
   * @type {Array<Uint8Array>}
   */
  const serverUpdates = []
  yDoc.on('update', (update, origin, c) => {
    serverUpdates.splice(serverUpdates.length, 0, update)
  })
  const yText = yDoc.getText('textBlock')
  yText.applyDelta([{ insert: 'r' }])
  yText.applyDelta([{ insert: 'o' }])
  yText.applyDelta([{ insert: 'n' }])
  yText.applyDelta([{ insert: 'e' }])

  const remoteDoc = new Y.Doc()
  Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(yDoc))
  remoteDoc.getText('textBlock').applyDelta([{ insert: 'n' }])

  Y.applyUpdate(yDoc, Y.encodeStateAsUpdate(remoteDoc))

  const update = Y.encodeStateAsUpdate(yDoc);
  const updates = Y.encodeStateAsUpdates(yDoc, splitClocksBy(1));
  const mergedUpdate = Y.mergeUpdates(updates);

  const yDocWithUpdate = new Y.Doc();
  Y.applyUpdate(yDocWithUpdate, update);
  t.compareStrings(yDocWithUpdate.getText('textBlock').toString(), 'nenor');

  const yDocWithUpdates = new Y.Doc();
  updates.forEach(() => {
    Y.applyUpdate(yDocWithUpdates , mergedUpdate);
  });
  t.compareStrings(yDocWithUpdates.getText('textBlock').toString(), 'nenor');

  const yDocWithMergedUpdate = new Y.Doc();
  Y.applyUpdate(yDocWithMergedUpdate, mergedUpdate);
  t.compareStrings(yDocWithMergedUpdate.getText('textBlock').toString(), 'nenor');

  // 2 clients did updates: 4 + 1
  // 1 (empty) delete set
  t.compare((4 + 1) + 1, updates.length)
}

/**
 * @param {t.TestCase} tc
 */
export const testEncodeStateAsUpdatesWithMaps = tc => {
  const yDoc = new Y.Doc()
  const yMap = yDoc.getMap('myMap')
  yMap.set('foo', 'foo1')
  yMap.set('bar', 'bar1')
  yMap.set('quux', 'quux1')

  yMap.set('bar', 'bar2')

  const expectedMap = {
      foo: 'foo1',
      bar: 'bar2',
      quux: 'quux1'
  }

  const update = Y.encodeStateAsUpdate(yDoc);
  const updates = Y.encodeStateAsUpdates(yDoc, splitClocksBy(2));
  const mergedUpdate = Y.mergeUpdates(updates);

  const yDocWithUpdate = new Y.Doc();
  Y.applyUpdate(yDocWithUpdate, update);
  t.compareObjects(yDocWithUpdate.getMap('myMap').toJSON(), expectedMap);

  const yDocWithUpdates = new Y.Doc();
  updates.forEach(() => {
    Y.applyUpdate(yDocWithUpdates , mergedUpdate);
  });
  t.compareObjects(yDocWithUpdates.getMap('myMap').toJSON(), expectedMap);

  const yDocWithMergedUpdate = new Y.Doc();
  Y.applyUpdate(yDocWithMergedUpdate, mergedUpdate);
  t.compareObjects(yDocWithMergedUpdate.getMap('myMap').toJSON(), expectedMap);

  t.compare(4, updates.length)

  const partial = new Y.Doc()
  Y.applyUpdate(partial, updates[0])
  t.compareObjects(partial.getMap('myMap').toJSON(), {}, 'after update 1');

  Y.applyUpdate(partial, updates[1])
  // bar is not here because the item is in the delete set
  t.compareObjects(partial.getMap('myMap').toJSON(), {foo: 'foo1'}, 'after update 2');

  Y.applyUpdate(partial, updates[2])
  t.compareObjects(partial.getMap('myMap').toJSON(), {foo: 'foo1', quux: 'quux1'}, 'after update 3');

  Y.applyUpdate(partial, updates[3])
  t.compareObjects(partial.getMap('myMap').toJSON(), {foo: 'foo1', bar: 'bar2', quux: 'quux1'}, 'after update 4');

}

/**
 * @param {t.TestCase} tc
 */
export const testEncodeStateAsUpdatesWithNotebook = tc => {
  const contents = fs.readFileSync('/Users/jens/Downloads/notebook(1).ipynb').toString()
  const parsed = JSON.parse(contents)
  const yNotebook = new Y.Doc()

  /** @type number[] */
  const clocks = []
  /** @type Array<Uint8Array> */
  const updates = [
    // start with encoding empty notebook because first splitted update is delete set
    Y.encodeStateAsUpdate(yNotebook)
  ]
  createYDocFromNotebookJSON(parsed, yNotebook, () => {
    clocks.push(Y.getState(yNotebook.store, yNotebook.clientID))
    updates.push(Y.encodeStateAsUpdate(yNotebook))
  })
  updates.push(Y.encodeStateAsUpdate(yNotebook))

  const splittedUpdates = Y.encodeStateAsUpdates(yNotebook, () => clocks)

  t.compare(splittedUpdates.length, updates.length)

  const splittedDoc = new Y.Doc();
  splittedUpdates.forEach((update, index) => {
    Y.applyUpdate(splittedDoc, update)

    const yDoc = new Y.Doc()
    Y.applyUpdate(yDoc, updates[index])
    t.compare(notebookYDocToJSON(splittedDoc), notebookYDocToJSON(yDoc), 'partial ' + index)
  })

  const yDoc = new Y.Doc()
  // @ts-ignore
  Y.applyUpdate(yDoc, updates.at(-1))
  t.compare(notebookYDocToJSON(splittedDoc), notebookYDocToJSON(yDoc), 'final')
  t.compare(notebookYDocToJSON(splittedDoc), parsed, 'final')
}

/**
 * @param {t.TestCase} tc
 */
export const testEncodeStateAsUpdatesWithNotebookSplittedByChunks = tc => {
  const contents = fs.readFileSync('/Users/jens/Downloads/notebook(1).ipynb').toString()
  const parsed = JSON.parse(contents)
  const yNotebook = new Y.Doc()

  createYDocFromNotebookJSON(parsed, yNotebook)
  const splitBy100 = Y.encodeStateAsUpdates(yNotebook, splitClocksBy(100))
  const ydoc = new Y.Doc();
  splitBy100.forEach(update => {
    Y.applyUpdate(ydoc, update)
  })
  t.compare(notebookYDocToJSON(ydoc), parsed, 'splitted-updates')
}

/**
 * @param {t.TestCase} tc
 */
export const testEncodeStateAsUpdatesWithDifferentSorting = tc => {
  const yDoc = new Y.Doc()
  yDoc.clientID = 1

  const cell1 = new Y.Map()
  cell1.set('id', 'one')
  yDoc.getArray('cells').push([cell1])

  const remoteYDoc = new Y.Doc()
  yDoc.clientID = 2
  Y.applyUpdate(remoteYDoc, Y.encodeStateAsUpdate(yDoc))
  const cell2 = new Y.Map()
  cell2.set('id', 'two')
  remoteYDoc.getArray('cells').push([cell2])

  Y.applyUpdate(yDoc, Y.encodeStateAsUpdate(remoteYDoc))

  /**
    * @param {Array<[number, number]>} clientClocks
    * @return {Array<[number, number]>}
    *
    * @function
    */
  const sortSmallToLarge = (clientClocks) => {
    return clientClocks.sort((a, z) => a[0] - z[0])
  }
  t.compare(Y.encodeStateAsUpdates(yDoc, () => []), Y.encodeStateAsUpdates(yDoc, () => []), 'default sort')
  t.compare(Y.encodeStateAsUpdates(yDoc, () => [], sortSmallToLarge), Y.encodeStateAsUpdates(yDoc, () => [], sortSmallToLarge), 'manual sort')
  // we cannot compare that default sort is not equal to manual sort in lib0/testing framework...
}

/**
 * @param {t.TestCase} tc
 */
export const testEncodeStateAsUpdatesWithDifferentSortingAndEditsByClients = tc => {
  const contents = fs.readFileSync('/Users/jens/Downloads/notebook(1).ipynb').toString()
  const parsed = JSON.parse(contents)
  const yNotebook = new Y.Doc()

  /** @type number[] */
  const clocks = []
  createYDocFromNotebookJSON(parsed, yNotebook, () => {
    clocks.push(Y.getState(yNotebook.store, yNotebook.clientID))
  })

  const clientDoc = new Y.Doc()
  Y.applyUpdate(clientDoc, Y.encodeStateAsUpdate(yNotebook))
  const source = clientDoc.getArray('cells').get(0).get('source')
  source.insert(source.length, "\nimport random")
  t.compare(source.toString(), "import yellowbrick\nimport random", "clientDoc should have right code")

  Y.applyUpdate(yNotebook, Y.encodeStateAsUpdate(clientDoc))

  const updates = Y.encodeStateAsUpdates(yNotebook, (client) => {
    if (client === yNotebook.clientID) {
      return clocks
    }
    return []
  }, clientClocks => {
    const currentlyLoadedYDocClientClock = clientClocks.find(
      (clientClock) =>
        clientClock[0] === yNotebook.clientID,
    );
    const sorted = clientClocks
      .filter(
        (clientClock) =>
          clientClock[0] !== yNotebook.clientID,
      )
      .sort((a, z) => {
        return z[0] - a[0];
      });
    if (currentlyLoadedYDocClientClock == null) {
      return sorted;
    }
    return [...sorted, currentlyLoadedYDocClientClock];
  })

  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, updates[0]) // delete set
  Y.applyUpdate(ydoc, updates[1]) // clientDoc updates
  Y.applyUpdate(ydoc, updates[2]) // cell 0 initialized
  t.compare(ydoc.getArray('cells').get(0).get('source').toString(), "import yellowbrick\nimport random", 'after cell is added by yNotebook')

  updates.forEach(update => {
    Y.applyUpdate(ydoc, update)
  })
  t.compare(ydoc.getArray('cells').get(0).get('source').toString(), "import yellowbrick\nimport random")
}
