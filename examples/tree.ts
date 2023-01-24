// An implementation of a tree with an unlimited
// number of child nodes under each node in the tree.
//
// This is technically a graph unless the acyclic option
// is set to true.  It could be made acyclic in a number
// of ways. The naive approach shown here walks up the
// parent refs on reparenting and ensure that the child
// is not present in the new parent's ancestry.
//
// Cycles are detected during depth/breadth walks, and
// each node is only traversed once.

import { nullPointer, Pointer, PointerSet } from '../'

const keys = ['next', 'prev', 'chead', 'ctail', 'parent'] as const
type K = typeof keys
export class Tree<T> {
  store: PointerSet<T, K, []>
  acyclic: boolean

  constructor(acyclic: boolean = false, store?: PointerSet<T, K>) {
    this.acyclic = acyclic
    this.store = store || new PointerSet<T, K, []>(keys, 256)
  }

  add(value: T, parent: Pointer = nullPointer): Pointer {
    const ctail = parent && this.store.ref(parent, 'chead')
    // set ref to parent, and attach to children list
    const node = this.store.alloc(value, {
      parent,
      prev: ctail,
      next: nullPointer,
    })
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
    fn: (value: T, node: Pointer) => any,
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
    fn(this.store.value(node) as T, node)
  }

  breadth(node: Pointer, fn: (value: T, node: Pointer) => any) {
    const nodes: Set<Pointer> = new Set([node])
    for (const p of nodes) {
      const chead = this.store.ref(p, 'chead')
      for (let c = chead; c; c = this.store.ref(c, 'next')) {
        nodes.add(c)
      }
      fn(this.store.value(p) as T, p)
    }
  }
}
