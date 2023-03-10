import t from 'tap'
import {
  errPointerAsRaw,
  errRawAsPointer,
  errUnknownPointerField,
  errUnknownRawField,
  nullPointer,
  Pointer,
  PointerSet,
  pointerSetInfer,
  PointerSetInferFields,
} from '../'

t.equal(nullPointer, 0, 'null pointer is null')

t.test('basic behavior', async t => {
  const f = ['x', 'y'] as const
  const r = ['p', 'q'] as const
  const store = new PointerSet<string, typeof f, typeof r>(f, 10, r)
  t.same(store.names, {
    x: 0,
    y: 1,
    p: -1,
    q: -2,
  })
  t.equal(store.fields[0][0], 0, 'null ptr has null refs')
  t.equal(store.fields[1][0], 0, 'null ptr has null refs')
  t.equal(store.rawFields[0][0], 0, 'null ptr has null raws')
  t.equal(store.rawFields[1][0], 0, 'null ptr has null raws')

  //@ts-expect-error
  const p = store.alloc(true)
  t.equal(p, 1)
  t.equal(store.value(p), true)
  store.value(p, 'p')
  t.equal(store.value(p), 'p')

  //@ts-expect-error
  store.ref(p, 'x', 123)
  t.equal(store.ref(p, 'x'), 123)
  store.raw(p, 'p', 2 ** 32 - 1)
  t.equal(store.raw(p, 'p'), 2 ** 32 - 1)

  t.throws(() => {
    store.free(nullPointer)
  }, TypeError('cannot free null pointer'))
  t.throws(() => {
    store.erase(nullPointer)
  }, TypeError('cannot erase null pointer'))

  t.throws(() => {
    //@ts-expect-error
    store.ref(p, 'p', p)
  }, errRawAsPointer('p'))
  t.throws(() => {
    //@ts-expect-error
    store.raw(p, 'x', p)
  }, errPointerAsRaw('x'))
  t.throws(() => {
    //@ts-expect-error
    store.refAll(p, { p })
  }, errRawAsPointer('p'))
  t.throws(() => {
    //@ts-expect-error
    store.rawAll(p, { x: p })
  }, errPointerAsRaw('x'))

  t.throws(() => {
    //@ts-expect-error
    store.alloc('badptr', { p }, {})
  }, errRawAsPointer('p'))
  t.throws(() => {
    //@ts-expect-error
    store.alloc('badraw', {}, { x: p })
  }, errPointerAsRaw('x'))

  t.throws(() => {
    //@ts-expect-error
    store.alloc('badptr', { asdf: nullPointer })
  }, errUnknownPointerField('asdf'))
  t.throws(() => {
    //@ts-expect-error
    store.alloc('badptr', {}, { asdf: nullPointer })
  }, errUnknownRawField('asdf'))

  t.throws(() => {
    store.value(nullPointer)
  }, TypeError('cannot read from null pointer'))
  t.throws(() => {
    store.value(nullPointer, 'asdf')
  }, TypeError('cannot write to null pointer'))
  t.throws(() => {
    store.ref(nullPointer, 'x', nullPointer)
  }, TypeError('cannot write to null pointer'))
  t.throws(() => {
    store.refAll(nullPointer, { x: nullPointer })
  }, TypeError('cannot write to null pointer'))
  t.throws(() => {
    store.raw(nullPointer, 'p', nullPointer)
  }, TypeError('cannot write to null pointer'))

  const x = store.ref(p, 'x', store.alloc('x', { y: p }, { p: 155443 }))
  t.same(store.rawAll(x), { p: 155443, q: 0 })
  t.same(store.refAll(x), { x: 0, y: p })
  const newRaws = { p: 999, q: 888 }
  t.equal(store.rawAll(x, newRaws), newRaws)
  t.same(store.rawAll(x), newRaws)
  for (const [k, v] of Object.entries(newRaws)) {
    //@ts-ignore
    t.same(store.raw(x, k), v)
  }
  const newRefs = { x, y: p }
  t.equal(store.refAll(x, newRefs), newRefs)
  t.same(store.refAll(x), newRefs)
  for (const [k, v] of Object.entries(newRefs)) {
    //@ts-ignore
    t.equal(store.ref(x, k), v)
  }

  t.throws(() => {
    //@ts-expect-error
    store.raw(x, 'asdf', 123)
  }, errUnknownRawField('asdf'))
  t.throws(() => {
    //@ts-expect-error
    store.rawAll(x, { asdf: 123 })
  }, errUnknownRawField('asdf'))

  t.throws(() => {
    //@ts-expect-error
    store.refAll(x, { asdf: 123 })
  }, errUnknownPointerField('asdf'))
  t.throws(() => {
    //@ts-expect-error
    store.ref(x, 'asdf', 123)
  }, errUnknownPointerField('asdf'))

  t.throws(() => {
    //@ts-expect-error
    store.raw(nullPointer, 'asdf')
  }, TypeError('cannot read from null pointer'))
  t.throws(() => {
    //@ts-expect-error
    store.raw(nullPointer, 'asdf', p)
  }, TypeError('cannot write to null pointer'))
  t.throws(() => {
    //@ts-expect-error
    store.rawAll(nullPointer, { asdf: p })
  }, TypeError('cannot write to null pointer'))
  t.throws(() => {
    //@ts-expect-error
    store.ref(nullPointer, 'asdf')
  }, TypeError('cannot read from null pointer'))
  t.throws(() => {
    //@ts-expect-error
    store.ref(nullPointer, 'asdf', p)
  }, TypeError('cannot write to null pointer'))

  t.test('infer field defs', async t => {
    const Cls = PointerSetInferFields(f, r)
    const c = new Cls<string>(10)
    t.same(c.names, store.names)
    const cc = pointerSetInfer<string>()(f, 10, r)
    t.same(cc.names, store.names)
  })

  t.throws(() => {
    new PointerSet<string, typeof f, typeof f>(f, 4, f)
  }, Error(`invalid raw field x, specified in x,y`))

  t.throws(() => {
    new PointerSet([], 2 ** 16 + 1)
  }, TypeError('block size must be less than or equal to 65536'))
})

t.test('expand', async t => {
  const f = ['x'] as const
  const r = ['r'] as const

  const store = new PointerSet<string, typeof f, typeof r>(f, 5, r)
  t.equal(store.blocksCount(), 1)
  t.equal(store.blocks[0], store)
  t.equal(store.blocks[1], undefined)
  t.equal(store.size(), 1)
  t.equal(store.entryCount(0), 1)
  t.equal(store.available(0), 4)
  t.equal(store.totalAvailable(), 4)
  const x = store.alloc('0')
  store.alloc('1')
  store.alloc('2')
  store.alloc('3')
  t.equal(store.available(0), 0)
  t.equal(store.totalAvailable(), 0)
  t.equal(store.size(), 5)
  const fur = store.alloc('4')
  t.equal(store.blocksCount(), 2)
  t.equal(store.available(0), 0)
  t.equal(store.available(1), 4)
  t.equal(store.entryCount(0), 5)
  t.equal(store.entryCount(1), 1)
  t.equal(store.totalAvailable(), 4)
  t.equal(store.size(), 6)
  t.equal(store.blocks[0].blocks, store.blocks, 'blocks refs shared')
  t.equal(store.blocks[1].blocks, store.blocks, 'blocks refs shared')
  t.equal(store.blocks[0].names, store.names, 'field names shared')
  t.equal(store.blocks[1].names, store.names, 'field names shared')
  store.raw(fur, 'r', 12345)
  // got into correct block's rawFields
  t.equal(store.blocks[1].rawFields[0][0], 12345)
  store.rawAll(fur, { r: 54321 })
  t.equal(store.blocks[1].rawFields[0][0], 54321)

  store.refAll(fur, { x })
  t.equal(store.blocks[1].fields[0][0], x)

  const eraseme = store.alloc('eraseme', { x }, { r: 404 })
  const freeme = store.alloc('freeme', { x }, { r: 404 })
  const another = store.alloc('another', { x }, { r: 40404 })
  t.equal(store.size(), 9)
  t.same(store.refAll(eraseme), { x })
  t.same(store.rawAll(eraseme), { r: 404 })
  store.erase(eraseme)
  t.same(store.refAll(eraseme, { x }), { x })
  t.same(store.rawAll(eraseme, { r: 12345 }), { r: 12345 })
  t.same(store.refAll(eraseme), { x: 0 })
  t.same(store.rawAll(eraseme), { r: 0 })
  t.equal(store.size(), 8)
  // doing it again is a no-op
  store.erase(eraseme)
  t.same(store.refAll(eraseme), { x: 0 })
  t.same(store.rawAll(eraseme), { r: 0 })
  t.equal(store.size(), 8)

  t.same(store.refAll(freeme), { x })
  t.same(store.rawAll(freeme), { r: 404 })
  store.free(freeme)
  t.same(store.refAll(freeme, { x }), { x })
  t.same(store.rawAll(freeme, { r: 12345 }), { r: 12345 })
  t.same(store.refAll(freeme), { x: 0 })
  t.same(store.rawAll(freeme), { r: 0 })
  t.equal(store.size(), 7)
  store.free(freeme)
  t.same(store.refAll(freeme), { x: 0 })
  t.same(store.rawAll(freeme), { r: 0 })
  t.equal(store.size(), 7)

  // free the last item, to cover the "free last item" case
  t.same(store.refAll(another), { x })
  t.same(store.rawAll(another), { r: 40404 })
  store.free(another)
  // these are now no-ops, just return the argument
  t.same(store.refAll(another, { x }), { x })
  t.same(store.rawAll(another, { r: 12345 }), { r: 12345 })
  t.same(store.refAll(another), { x: 0 })
  t.same(store.rawAll(another), { r: 0 })
  t.equal(store.size(), 6)
  store.free(another)
  t.same(store.refAll(another), { x: 0 })
  t.same(store.rawAll(another), { r: 0 })
  t.equal(store.size(), 6)

  // simulate an overflow
  for (let i = 0; i < 2 ** 24; i++) {
    //@ts-ignore-error
    store.blocks.push(i)
  }
  t.throws(() => {
    for (let i = 0; i < 5; i++) {
      store.alloc('oops', undefined, { r: 123 })
    }
  }, RangeError('out of memory'))

  // un-do the overflow, test dropping
  store.blocks.splice(2)
  t.equal(store.size(), 10)
  store.blocks[1].wipeBlock()
  t.equal(store.size(), 5)
  t.equal(store.blocks.length, 2)
  t.throws(() => {
    store.drop()
  }, Error('only the final block may be dropped'))
  store.dropEmpty()
  t.equal(store.blocks.length, 1)
  store.drop()
  t.equal(store.blocks.length, 1)
  t.equal(store.size(), 1)

  // add a bunch of items, and then free them all
  const pointers: Pointer[] = []
  for (let i = 0; i < 100; i++) {
    pointers.push(store.alloc(`${i}`))
  }
  t.equal(store.size(), pointers.length + 1)
  for (let i = 0; i < 100; i++) {
    store.free(pointers[i])
  }
  t.equal(store.size(), 1)

  pointers.length = 0
  for (let i = 0; i < 100; i++) {
    pointers.push(store.alloc(`${i}`))
  }
  t.equal(store.size(), pointers.length + 1)
  // separate out evens and odds to free out of insertion order
  pointers.sort((a, b) =>
    a % 2 && !(b % 2) ? -1 : b % 2 && !(a % 2) ? 1 : a - b
  )
  for (let i = 0; i < 100; i++) {
    store.free(pointers[i])
  }
  t.equal(store.size(), 1)

  pointers.length = 0
  for (let i = 0; i < 100; i++) {
    pointers.push(store.alloc(`${i}`))
  }
  t.equal(store.size(), pointers.length + 1)
  // free in reverse insertion order
  pointers.sort((a, b) => b - a)
  for (let i = 0; i < 100; i++) {
    store.free(pointers[i])
  }
  t.equal(store.size(), 1)

  // mostly just for coverage, to use a uint16 array
  const bigStore = new PointerSet<string, [], []>([], 1000, [])
  for (let i = 0; i < 2 ** 16; i++) {
    bigStore.alloc('x')
  }
  // these should not be accessed directly, private types ensure this
  //@ts-expect-error
  const ptr1 = store.getPointer(2 ** 24 - 1, 123)
  t.equal(store.getBlockId(ptr1), 2 ** 24 - 1)
  t.equal(store.getIndex(ptr1), 123)

  //@ts-expect-error
  const ptr2 = bigStore.getPointer(2 ** 16 - 1, 123)
  t.equal(bigStore.getBlockId(ptr2), 2 ** 16 - 1)
  t.equal(bigStore.getIndex(ptr2), 123)
})

t.test('extra raw data views', async t => {
  const f = [] as const
  const r = ['x']
  const store = new PointerSet<null, typeof f, typeof r>(f, 10, r)

  // set all the bits so it'll fail if we get the wrong values
  store.rawFields[0].fill(-1)

  const p = store.alloc(null)
  const u8 = store.raw8(p, 'x')
  const u16 = store.raw16(p, 'x')
  const u32 = store.raw32(p, 'x')

  t.test('type error checking 8', t => {
    //@ts-expect-error
    u8[4] = 123
    //@ts-expect-error
    let num:number = u8[4]
    t.equal(num, undefined)
    t.end()
  })

  t.test('type error checking 16', t => {
    //@ts-expect-error
    u16[2] = 123
    //@ts-expect-error
    let num:number = u16[2]
    t.equal(num, undefined)
    t.end()
  })

  t.test('type error checking 32', t => {
    //@ts-expect-error
    u32[1] = 123
    //@ts-expect-error
    let num:number = u32[1]
    t.equal(num, undefined)
    t.end()
  })

  t.equal(store.raw(p, 'x'), 0)
  t.same(u8, [0, 0, 0, 0])
  t.same(u16, [0, 0])
  t.same(u32, [0])
  u32[0] = 1
  t.equal(store.raw(p, 'x'), 1)
  t.same(u8, [1, 0, 0, 0])
  t.same(u16, [1, 0])
  t.same(u32, [1])
  t.test('set with raw()', t => {
    const newVal = 1 + (2 << 8) + (3 << 16) + (4 << 24)
    store.raw(p, 'x', newVal)
    t.same(u8, [1, 2, 3, 4])
    t.same(u16, [1 + (2 << 8), 3 + (4 << 8)])
    t.same(u32, [newVal])
    t.end()
  })

  t.test('set with raw8', t => {
    store.raw8(p, 'x', new Uint8Array([4, 3, 2, 1]))
    const newVal = 4 + (3 << 8) + (2 << 16) + (1 << 24)
    store.raw(p, 'x', newVal)
    t.same(u8, [4, 3, 2, 1])
    t.same(u16, [4 + (3 << 8), 2 + (1 << 8)])
    t.same(u32, [newVal])
    t.end()
  })

  t.test('set with raw16', t => {
    store.raw16(p, 'x', new Uint16Array([5 + (6 << 8), 7 + (8 << 8)]))
    const newVal = 5 + (6 << 8) + (7 << 16) + (8 << 24)
    store.raw(p, 'x', newVal)
    t.same(u8, [5, 6, 7, 8])
    t.same(u16, [5 + (6 << 8), 7 + (8 << 8)])
    t.same(u32, [newVal])
    t.end()
  })

  t.test('set with raw32', t => {
    const newVal = 7 + (1 << 8) + (7 << 16) + (9 << 24)
    store.raw32(p, 'x', new Uint32Array([newVal]))
    store.raw(p, 'x', newVal)
    t.same(u8, [7, 1, 7, 9])
    t.same(u16, [7 + (1 << 8), 7 + (9 << 8)])
    t.same(u32, [newVal])
    t.end()
  })
})
