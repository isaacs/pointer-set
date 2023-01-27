import { nullPointer, Pointer, PointerSet, PointerSetValueType } from '../'

const keys = ['left', 'right', 'parent'] as const
type Keys = typeof keys
export class BinaryTree<T extends PointerSetValueType = number> {
  store: PointerSet<T, Keys, []>
  comparator: (a: T, b: T) => number

  constructor(
    comparator: BinaryTree<T>['comparator'],
    blockSize: number = 256,
    store?: BinaryTree<T>['store']
  ) {
    this.comparator = comparator
    this.store = store || new PointerSet<T, Keys, []>(keys, blockSize)
  }

  search(
    node: Pointer,
    needle: T,
    fn: (found: T | undefined, depth: number) => any,
    depth = 0
  ): void {
    const v = this.store.value(node) as T
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
    fn: (v: T | undefined, p: Pointer, depth: number) => any,
    depth = 0,
    includeNull = false
  ) {
    const left = this.store.ref(node, 'left')
    const right = this.store.ref(node, 'right')
    const value = this.store.value(node) as T
    if (left) this.walk(left, fn, depth + 1)
    else if (includeNull) fn(undefined, nullPointer, depth + 1)
    fn(value, node, depth)
    if (right) this.walk(right, fn, depth + 1)
    else if (includeNull) fn(undefined, nullPointer, depth + 1)
  }

  add(value: T, parent: Pointer = nullPointer): Pointer {
    if (!parent) {
      return this.store.alloc(value)
    }
    const thisVal = this.store.value(parent) as T
    const cmpThis = this.comparator(thisVal, value)
    const left = this.store.ref(parent, 'left')
    const right = this.store.ref(parent, 'right')

    if (cmpThis > 0) {
      // place on the left
      if (left) {
        return this.add(value, left)
      } else {
        return this.store.ref(
          parent,
          'left',
          this.store.alloc(value, { parent })
        )
      }
    } else if (cmpThis < 0) {
      if (right) {
        return this.add(value, right)
      } else {
        return this.store.ref(
          parent,
          'right',
          this.store.alloc(value, { parent })
        )
      }
    } else {
      // equal!
      if ((!left && !right) || (left && right)) {
        // either works, flip a "coin"
        const dir = parent % 2 ? 'left' : 'right'
        if (left) {
          return this.add(value, dir === 'left' ? left : right)
        } else {
          return this.store.ref(
            parent,
            dir,
            this.store.alloc(value, { parent })
          )
        }
      } else {
        const dir = !right ? 'right' : 'left'
        return this.store.ref(
          parent,
          dir,
          this.store.alloc(value, { parent })
        )
      }
    }
  }
}
