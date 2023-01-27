import { nullPointer, Pointer, PointerSet, PointerSetValueType } from '../'

const fields = ['next', 'prev'] as const
export class LinkedList<T extends PointerSetValueType> {
  head: Pointer = nullPointer
  tail: Pointer = nullPointer
  store: PointerSet<T, typeof fields>

  // let two linked lists share a store
  constructor(store?: PointerSet<T, typeof fields>) {
    this.store = store || new PointerSet<T, typeof fields>(fields, 256)
  }

  unshift(value: T) {
    if (this.head === nullPointer) {
      this.head = this.tail = this.store.alloc(value)
    } else {
      const p = this.store.alloc(value, { next: this.head })
      this.store.ref(this.head, 'prev', p)
      this.head = p
    }
  }

  shift(): T | undefined {
    if (this.head === nullPointer) {
      return
    }
    const next = this.store.ref(this.head, 'next')
    const v = this.store.value(this.head)
    this.store.free(this.head)
    this.head = next
    if (!this.head) {
      this.tail = this.head
    }
    return v
  }

  push(value: T) {
    if (this.tail === nullPointer) {
      this.head = this.tail = this.store.alloc(value)
    } else {
      const p = this.store.alloc(value, { prev: this.tail })
      this.store.ref(this.tail, 'next', p)
      this.tail = p
    }
  }

  pop(): T | undefined {
    if (this.tail === nullPointer) {
      return
    }
    const prev = this.store.ref(this.tail, 'prev')
    const v = this.store.value(this.tail)
    this.store.free(this.tail)
    this.tail = prev
    if (!this.tail) {
      this.head = this.tail
    }
    return v
  }

  forEach(fn: (v: T) => any) {
    for (let p = this.head; p; p = this.store.ref(p, 'next')) {
      fn(this.store.value(p) as T)
    }
  }

  rforEach(fn: (v: T) => any) {
    for (let p = this.tail; p; p = this.store.ref(p, 'prev')) {
      fn(this.store.value(p) as T)
    }
  }
}
