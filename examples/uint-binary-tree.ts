// this is the same as ./binary-tree.ts, but only for storing uint32s
//
// Note that if you're *actually* only storing a single number, especially if
// you know that the numbers will be mostly within a uint16 range, then it's
// actually slightly faster to just go ahead and use arrays of JavaScript
// numbers.  If the numbers are mostly between the uint16 and uint32 range,
// then this performs slightly better, since in that case, you won't benefit
// from V8's SMI optimization paths.
//
// So, pretty niche.
//
// But this gets more relevant if you had, for example, 3 different numbers to
// store, and rather than set the T type to a JS object
// {x:number,y:number,z:number}, or even [number, number, number], you could
// get much better performance by defining them as raw values on pre-allocated
// uint32 slabs.
//
// Also, for a data structure as generic as "binary tree", it's really just
// absurdly limiting to only be able to store uint32s, rather than letting the
// user specify any arbitrary type.

import { nullPointer, Pointer, PointerSet } from '../'

const keys = ['left', 'right', 'parent'] as const
type K = typeof keys
const rawKeys = ['value'] as const
type R = typeof rawKeys
type T = null
export class BinaryTreeUint32 {
  store: PointerSet<T, K, R>
  comparator: (a: number, b: number) => number

  constructor(
    comparator: BinaryTreeUint32['comparator'] = (a, b) => a - b,
    blockSize: number = 256,
    store?: BinaryTreeUint32['store']
  ) {
    this.comparator = comparator
    this.store = store || new PointerSet<T, K, R>(keys, blockSize, rawKeys)
  }

  value(p: Pointer, v?: number) {
    if (v === undefined) {
      return this.store.raw(p, 'value')
    } else {
      return this.store.raw(p, 'value', v)
    }
  }

  search(
    node: Pointer,
    needle: number,
    fn: (found: number | undefined, depth: number) => any,
    depth = 0
  ): void {
    const v = this.store.raw(node, 'value')
    const cmp = this.comparator(v, needle)
    if (cmp === 0) {
      return fn(needle, depth)
    } else {
      const dir = cmp > 1 ? 'left' : 'right'
      const child = this.store.ref(node, dir)
      if (!child) {
        return fn(undefined, depth)
      } else {
        this.search(child, needle, fn, depth + 1)
      }
    }
  }

  walk(
    node: Pointer,
    fn: (v: number, p: Pointer, depth: number) => any,
    depth = 0,
    includeNull = false
  ) {
    const left = this.store.ref(node, 'left')
    const right = this.store.ref(node, 'right')
    const value = this.store.raw(node, 'value')
    if (left) this.walk(left, fn, depth + 1)
    else if (includeNull) fn(0, nullPointer, depth + 1)
    fn(value, node, depth)
    if (right) this.walk(right, fn, depth + 1)
    else if (includeNull) fn(0, nullPointer, depth + 1)
  }

  left(node: Pointer): Pointer {
    return this.store.ref(node, 'left')
  }

  right(node: Pointer): Pointer {
    return this.store.ref(node, 'right')
  }

  add(value: number, parent: Pointer = nullPointer): Pointer {
    if (!parent) {
      const node = this.store.alloc(null)
      this.store.raw(node, 'value', value)
      return node
    }
    const thisVal = this.store.raw(parent, 'value')
    const cmpThis = this.comparator(thisVal, value)
    const left = this.store.ref(parent, 'left')
    const right = this.store.ref(parent, 'right')

    if (cmpThis > 0) {
      // place on the left
      if (left) {
        return this.add(value, left)
      } else {
        const node = this.store.ref(
          parent,
          'left',
          this.store.alloc(null, { parent })
        )
        this.store.raw(node, 'value', value)
        return node
      }
    } else if (cmpThis < 0) {
      if (right) {
        return this.add(value, right)
      } else {
        const node = this.store.ref(
          parent,
          'right',
          this.store.alloc(null, { parent })
        )
        this.store.raw(node, 'value', value)
        return node
      }
    } else {
      // equal!
      if ((!left && !right) || (left && right)) {
        // either works, flip a "coin"
        const dir = parent % 2 ? 'left' : 'right'
        if (left) {
          return this.add(value, dir === 'left' ? left : right)
        } else {
          const node = this.store.ref(
            parent,
            dir,
            this.store.alloc(null, { parent })
          )
          this.store.raw(node, 'value', value)
          return node
        }
      } else {
        const v = this.store.alloc(null, { parent })
        this.store.raw(v, 'value', value)
        const dir = !right ? 'right' : 'left'
        return this.store.ref(parent, dir, v)
      }
    }
  }
}
