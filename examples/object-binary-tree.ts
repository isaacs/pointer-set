// same as binary tree, but not using PointerSet
// instead, using node objects
//
// Note that this is *significantly* faster, since this data structure
// is intended to hold the items for a very long time and almost never
// discard them.  Binary trees are in general optimized for fast lookups
// of objects by value, and fast sorting on demand, neither of which
// involve frequent object deletion.
//
// See the caveats in the README.md of this project
import { PointerSetValueType } from '../'

interface NodeOpts<T extends PointerSetValueType> {
  left?: Node<T>
  right?: Node<T>
  parent?: Node<T>
}

export class Node<T extends PointerSetValueType> {
  value: T
  left?: Node<T>
  right?: Node<T>
  parent?: Node<T>
  constructor(
    value: T,
    { left, right, parent }: NodeOpts<T> = {}
  ) {
    this.value = value
    this.left = left
    this.right = right
    this.parent = parent
  }
}

let coin = 0
const flip = () => (coin = (coin + 1) % 2)

export class BinaryTreeObj<T extends PointerSetValueType> {
  comparator: (a: T, b: T) => number
  freeList: number[] = []

  constructor(comparator: BinaryTreeObj<T>['comparator'], _: number) {
    this.comparator = comparator
  }

  search(
    node: Node<T>,
    needle: T,
    fn: (found: T | undefined, depth: number) => any,
    depth = 0
  ): void {
    const v: T = node.value
    const cmp = this.comparator(v, needle)
    if (cmp === 0) {
      return fn(needle, depth)
    } else {
      const dir = cmp > 1 ? 'left' : 'right'
      const child = node[dir]
      if (!child) {
        return fn(undefined, depth)
      } else {
        this.search(child, needle, fn, depth + 1)
      }
    }
  }

  walk(
    node: Node<T>,
    fn: (v: T | undefined, p: Node<T> | undefined, depth: number) => any,
    depth = 0,
    includeNull:boolean = false
  ) {
    const left = node.left
    const right = node.right
    const value = node.value
    if (left) this.walk(left, fn, depth + 1)
    else if (includeNull) fn(undefined, undefined, depth + 1)
    fn(value, node, depth)
    if (right) this.walk(right, fn, depth + 1)
    else if (includeNull) fn(undefined, undefined, depth + 1)
  }

  add(value: T, parent?: Node<T>): Node<T> {
    if (!parent) {
      return new Node<T>(value)
    }
    const thisVal = parent.value
    const cmpThis = this.comparator(thisVal, value)
    const left = parent.left
    const right = parent.right

    if (cmpThis > 0) {
      // place on the left
      if (left) {
        return this.add(value, left)
      } else {
        return parent.left = new Node<T>(value, { parent })
      }
    } else if (cmpThis < 0) {
      if (right) {
        return this.add(value, right)
      } else {
        return parent.right = new Node<T>(value, { parent })
      }
    } else {
      // equal!
      if ((!left && !right) || (left && right)) {
        // either works, flip a "coin"
        const dir = flip() ? 'left' : 'right'
        if (left) {
          return this.add(value, dir === 'left' ? left : right)
        } else {
          return parent[dir] = new Node<T>(value, { parent })
        }
      } else {
        const dir = !right ? 'right' : 'left'
        return parent[dir] = new Node<T>(value, { parent })
      }
    }
  }
}
