// this is the same as ./tree.ts, but only for storing uint32 values
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
// Also, for a data structure as generic as "tree", it's really just absurdly
// limiting to only be able to store uint32s, rather than letting the user
// specify any arbitrary type.

import { nullPointer, Pointer, PointerSet } from '../'

const keys = ['next', 'prev', 'chead', 'ctail', 'parent'] as const
const rawKeys = ['value'] as const

// no value type, just uses raw uint32 values on the slab
type T = null
type K = typeof keys
type R = typeof rawKeys
export class Tree {
  store: PointerSet<T, K, R>
  acyclic: boolean

  constructor(acyclic: boolean = false, store?: PointerSet<T, K, R>) {
    this.acyclic = acyclic
    this.store = store || new PointerSet<T, K, R>(keys, 256, rawKeys)
  }

  add(value: number, parent: Pointer = nullPointer): Pointer {
    const ctail = parent && this.store.ref(parent, 'chead')
    // set ref to parent, and attach to children list
    const node = this.store.alloc(null, {
      parent,
      prev: ctail,
      next: nullPointer,
    })
    this.store.raw(node, 'value', value)
    if (parent) {
      if (!ctail) {
        this.store.refAll(parent, { chead: node, ctail: node })
      } else {
        this.store.ref(ctail, 'next', node)
        this.store.ref(parent, 'ctail', node)
      }
    }
    return node
  }

  delete(node: Pointer): void {
    // first delete all children nodes
    this.deleteChildren(node)

    // remove from sibling list by reparenting onto null
    this.reparent(node)

    // reclaim the memory
    this.store.free(node)
  }

  reparent(child: Pointer, newParent: Pointer = nullPointer): void {
    if (!child) {
      throw new Error('cannot move null child')
    }
    const oldParent = this.store.ref(child, 'parent')
    if (oldParent) {
      const next = this.store.ref(child, 'next')
      const prev = this.store.ref(child, 'prev')

      // if there was a next node, its new previous is previous
      // otherwise, the previous is the new tail
      // if there was a previous node, its new next is next
      // otherwise, the next is the new head
      // if neither, then all end up null.
      if (next) this.store.ref(next, 'prev', prev)
      else this.store.ref(oldParent, 'ctail', prev)
      if (prev) this.store.ref(prev, 'next', next)
      else this.store.ref(oldParent, 'chead', next)
    }
    if (newParent) {
      if (this.acyclic) {
        for (let p = newParent; p; p = this.store.ref(p, 'parent')) {
          if (p === child) {
            throw new Error('cycle detected')
          }
        }
      }
      this.store.ref(child, 'parent', newParent)
      const ctail = this.store.ref(newParent, 'ctail')
      if (!ctail) {
        this.store.refAll(newParent, { chead: child, ctail: child })
        this.store.refAll(child, { prev: ctail, next: nullPointer })
      } else {
        this.store.ref(ctail, 'next', child)
        this.store.ref(newParent, 'ctail', child)
        this.store.ref(child, 'prev', ctail)
      }
    }
  }

  deleteChildren(node: Pointer): void {
    const chead = this.store.ref(node, 'chead')
    for (let p = chead; p; p = this.store.ref(p, 'next')) {
      this.delete(p)
    }
  }

  depth(
    node: Pointer,
    fn: (value: number, node: Pointer) => any,
    nodes: Set<Pointer> = new Set()
  ) {
    if (nodes.has(node)) {
      return
    }
    nodes.add(node)
    const chead = this.store.ref(node, 'chead')
    for (let p = chead; p; p = this.store.ref(p, 'next')) {
      this.depth(p, fn)
    }
    fn(this.store.raw(node, 'value'), node)
  }

  breadth(node: Pointer, fn: (value: number, node: Pointer) => any) {
    const nodes: Set<Pointer> = new Set([node])
    for (const p of nodes) {
      const chead = this.store.ref(p, 'chead')
      for (let c = chead; c; c = this.store.ref(c, 'next')) {
        nodes.add(c)
      }
      fn(this.store.raw(p, 'value'), p)
    }
  }
}
