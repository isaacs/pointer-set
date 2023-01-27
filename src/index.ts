const max8 = 256
const max16 = 65536
const max24 = 16777216
const max32 = 4294967296
const mask8 = 255
const mask16 = 65535
const mask24 = 16777215

/**
 * error raised when trying to access a pointer value as raw uint32
 */
export const errPointerAsRaw = (f: string) =>
  new TypeError('cannot access pointer field as raw uint32: ' + f)
/**
 * error raised when trying to access a raw uint32 value as a pointer
 */
export const errRawAsPointer = (f: string) =>
  new TypeError('cannot access raw uint32 field as pointer: ' + f)
/**
 * error raised when attempting to access an unknown raw field
 */
export const errUnknownRawField = (f: string) =>
  new TypeError('unknown raw uint32 field: ' + f)
/**
 * error raised when attempting to access an unknown pointer field
 */
export const errUnknownPointerField = (f: string) =>
  new TypeError('unknown pointer field: ' + f)

const getWordSize = (max: BlockSize): WordSize =>
  (max <= max8 ? 1 : max <= max16 ? 2 : 4) as WordSize

// create a new uint array using un-initialized memory
// this is generally unsafe!  but we initialize memory
// on each entry allocation, so it's significantly faster
// to not *also* do so when we alloc the memory in the
// first place.
// When running in an environment without a Buffer type,
// this is just returning a "normal" initialized uint array.
const unsafeUint32Array = (len: number): Uint32Array => {
  /* c8 ignore start */
  if (typeof Buffer === 'undefined') {
    return new Uint32Array(len)
  }
  /* c8 ignore stop */
  const buf = Buffer.allocUnsafe(len * 4)
  // note that buf *might* be allocated on a slab, though that's
  // unlikey unless the len is very small, so we have to supply
  // the byteOffset as well.
  return new Uint32Array(buf.buffer, buf.byteOffset, len)
}
const unsafeUint16Array = (len: number): Uint16Array => {
  /* c8 ignore start */
  if (typeof Buffer === 'undefined') {
    return new Uint16Array(len)
  }
  /* c8 ignore stop */
  const buf = Buffer.allocUnsafe(len * 2)
  return new Uint16Array(buf.buffer, buf.byteOffset, len)
}
const unsafeUint8Array = (len: number): Uint8Array => {
  /* c8 ignore start */
  if (typeof Buffer === 'undefined') {
    return new Uint8Array(len)
  }
  /* c8 ignore stop */
  const buf = Buffer.allocUnsafe(len)
  return new Uint8Array(buf.buffer, buf.byteOffset, len)
}

type ArrayValues<K extends readonly string[]> = K[number]
type RefSet<K extends readonly string[]> = {
  [k in ArrayValues<K>]?: Pointer
}
type RawSet<R extends readonly string[]> = {
  [k in ArrayValues<R>]?: number
}
type FieldName<K> = K extends readonly string[] ? keyof RefSet<K> : never

// These private restricted types are here to discourage
// trying to get fancy doing math on pointers or blockIds,
// or passing arbitrary or mismatched numbers to methods.
// Do not touch! The guardrails are here to help you!
const T = Symbol('type')
type BlockId = number & { [T]: 'blockId' }
type Index = number & { [T]: 'index' }
/**
 * Type representing a Pointer.
 *
 * An unsigned 32-bit integer, where the low 8 or 16 bytes represent
 * the index within the stack (8 if the block size is 256 or lower,
 * 16 otherwise), and the remaining bytes (3 or 2, respectively)
 * storing the blockId of the block where the pointer is allocated.
 */
export type Pointer = number & { [T]: 'pointer' }
/**
 * The set of valid types for T when instantiating a PointerSet.
 *
 * Any value other than `undefined`
 */
export type PointerSetValueType = {} | null
type FieldId = number & { [T]: 'fieldId' }
type BlockSize = number & { [T]: 'blockSize' }
type WordSize = (1 | 2) & { [T]: 'wordSize' }
type Shift = (8 | 16) & { [T]: 'shift' }
type Mask = (typeof mask8 | typeof mask16) & { [T]: 'mask' }
type BlockIdMask = (typeof mask24 | typeof mask16) & { [T]: 'blockIdMask' }
type ShiftDownFix = (typeof max24 | typeof max16) & { [T]: 'shiftDownFix' }
type ShiftUpFix = typeof max32 & { [T]: 'shiftUpFix' }
type FirstNextFree = (0 | 1) & { [T]: 'index'; fnf: true }

// default value to definitively indicate no argument was provided
const NOVALUE = Symbol('no value')
const noNullPointer = (p: Pointer, v: any = NOVALUE) => {
  if (p === 0) {
    if (v === NOVALUE) {
      throw new TypeError('cannot read from null pointer')
    } else {
      throw new TypeError('cannot write to null pointer')
    }
  }
}

/**
 * a Pointer of value 0, exported for convenience
 */
export const nullPointer = 0 as Pointer

// the internal stack of free items
class Stack {
  data: Uint8Array | Uint16Array
  length: number
  constructor(max: BlockSize) {
    this.data = (max <= max8 ? unsafeUint8Array : unsafeUint16Array)(max)
    this.length = 0
  }
  push(n: Index) {
    this.data[this.length++] = n
  }
  pop() {
    return this.data[--this.length] as Index
  }
}

/**
 * Abstract base class of PointerSet and PointerSetBlock
 */
abstract class PointerSetBase<
  T extends PointerSetValueType,
  K extends readonly string[],
  R extends readonly string[] = []
> {
  /**
   * Stack of blocks in the set
   */
  abstract blocks: PointerSetBlock<T, K, R>[]
  /**
   * Set of blocks that have some space available
   */
  abstract blocksAvail: Set<PointerSetBlock<T, K, R>>
  /**
   * Array of values, or undefined if the pointer is freed
   */
  abstract values: (T | undefined)[]
  /**
   * The next index that is free for use.  Note that if there
   * are any indexes in freeList, those are used first.
   */
  abstract nextFree: Index
  /**
   * The numeric idenfier for this block in the set
   */
  abstract blockId: BlockId

  /**
   * array of slabs to store pointer references, one for each field in K
   */
  abstract fields: Uint32Array[]
  /**
   * array of slabs to store raw uint32 data, one for each field in R
   */
  abstract rawFields: Uint32Array[]
  /**
   * Mapping of field and rawField names to FieldId values.
   * Raw fields have a negative value, which is the bitwise-not
   * of the index within rawFields
   */
  abstract names: { [k in FieldName<K> | FieldName<R>]: FieldId }
  /**
   * 1 for blockSize <= 256, 2 otherwise
   */
  abstract wordSize: WordSize
  /**
   * number of bits to shift when converting a pointer to a blockId
   */
  abstract shift: Shift
  /**
   * fix for when shifting to get the blockId results in overflow.
   * Equal to 2**(32 - 8 * wordSize), so
   * 2**24 for shift 8, 2**16 for shift 16
   */
  abstract shiftDownFix: ShiftDownFix
  /**
   * shifting UP to get a block id from a pointer always overflows
   * in the same way, because we are converting from an int32 into
   * a uint32
   */
  shiftUpFix: ShiftUpFix = max32 as ShiftUpFix
  /**
   * mask to get the index from a pointer.
   * Equal to 2**(8 * wordSize) - 1
   */
  abstract mask: Mask
  /**
   * Mask for detecting when a blockId goes out of range.
   */
  abstract blockIdMask: BlockIdMask
  /**
   * number of entries stored in each block.
   * Must be less than 65536
   */
  abstract blockSize: BlockSize
  /**
   * The first 'nextFree' value.
   * 0 for extension blocks, 1 for the root block, because the root
   * block's 0-index entry is the null pointer.
   */
  abstract firstNextFree: FirstNextFree

  /**
   * Indexes that have been freed and can be re-used.
   */
  abstract freeList: Stack

  /**
   * For internal use: get a BlockId from a Pointer
   */
  getBlockId(p: Pointer): BlockId {
    const b = p >> this.shift
    return (b >= 0 ? b : this.shiftDownFix + b) as BlockId
  }
  /**
   * For internal use: get an Index from a Pointer
   */
  getIndex(p: Pointer): Index {
    return (p & this.mask) as Index
  }
  /**
   * For internal use: get a Pointer from a BlockId and Index
   */
  getPointer(blockId: BlockId, index: Index): Pointer {
    const b = blockId << this.shift
    const p = (b >= 0 ? b : this.shiftUpFix + b) | index
    return p as Pointer
  }

  /**
   * Allocate a new pointer in the set, associated with the supplied
   * value parameter.
   *
   * Any pointers passed in the `refs` argument are assigned as pointers
   * stored in the associated `fields` slab.
   *
   * Any raw numeric values in the `raws` argument are stored in the
   * associated `rawFields` slab.
   */
  alloc(value: T, refs?: RefSet<K>, raw?: RawSet<R>): Pointer {
    // put it in the most recently freed spot, or the next unwritten spot
    // else, try to put it in the first available block
    if (this.nextFree < this.blockSize || this.freeList.length) {
      const index: Index = this.freeList.length
        ? this.freeList.pop()
        : (this.nextFree++ as Index)
      if (!this.freeList.length && this.nextFree >= this.blockSize) {
        this.blocksAvail.delete(this)
      }
      this.values[index] = value
      const pointer = this.getPointer(this.blockId, index)

      // new allocation, set all refs and raws to zero unless specified
      const writes: Pointer[] = this.fields.map(() => nullPointer)
      if (refs) {
        for (const [k, p] of Object.entries(refs)) {
          const fieldName = k as FieldName<K>
          const fieldId = this.names[fieldName]
          if (fieldId === undefined) {
            throw errUnknownPointerField(fieldName)
          }
          if (fieldId < 0) {
            throw errRawAsPointer(k)
          }
          writes[fieldId] = p as Pointer
        }
      }
      for (let i = 0; i < writes.length; i++) {
        this.fields[i][index] = writes[i]
      }

      const rawWrites = this.rawFields.map(() => 0)
      if (raw) {
        for (const [k, p] of Object.entries(raw)) {
          const fieldName = k as FieldName<R>
          const fieldId = this.names[fieldName]
          if (fieldId === undefined) {
            throw errUnknownRawField(k)
          }
          if (fieldId >= 0) {
            throw errPointerAsRaw(k)
          }
          rawWrites[~fieldId] = p as number
        }
      }
      // set all to zero, or whatever they were defined in the args
      for (let i = 0; i < rawWrites.length; i++) {
        this.rawFields[i][index] = rawWrites[i]
      }
      return pointer
    }

    // pick first block with empty space, if any
    for (const b of this.blocksAvail) {
      return b.alloc(value, refs, raw)
    }

    // have to make a new block
    return new PointerSetBlock<T, K, R>(
      this.blocks,
      this.blocksAvail,
      this.names,
      this.wordSize,
      this.shift,
      this.mask,
      this.blockIdMask,
      this.blockSize
    ).alloc(value, refs, raw)
  }

  /**
   * Mark a Pointer location as free for re-use, and delete its value
   * from the `values` array.
   *
   * Note that this does *not* delete raw values and references from the
   * relevant data slabs, so it is still possible to dereference previously
   * freed pointers, and get their former values.
   *
   * See `erase()` if you need this.
   */
  free(pointer: Pointer): void {
    if (pointer === nullPointer) {
      throw new TypeError('cannot free null pointer')
    }
    const blockId = this.getBlockId(pointer)
    if (blockId !== this.blockId) {
      return this.blocks[blockId].free(pointer)
    }
    const index = this.getIndex(pointer)

    // if we aren't storing anything for this index, nothing to do
    if (this.values[index] === undefined) {
      return
    }

    // if pushing to freelist will bump into nextFree,
    // then just free all at once.
    if (this.freeList.length + this.firstNextFree === this.nextFree - 1) {
      this.freeList.length = 0
      this.nextFree = this.firstNextFree as Index
      this.values.length = 0
      if (this.blockId === 0) {
        this.values.push(undefined)
      }
    } else if (index === this.nextFree - 1) {
      // freeing the last item in the list, just pop off like a stack
      this.nextFree--
      this.values.pop()
    } else {
      // mark it as free, write undefined to value
      this.freeList.push(index)
      this.values[index] = undefined
    }
    this.blocksAvail.add(this)
  }

  /**
   * Mark a pointer location as free for re-use, delete its value from
   * the `values` array, and set any refs and raw values to 0.
   *
   * See also `free()` for a faster version of this that does not set
   * the data in the fields/rawFields slabs to 0.
   */
  erase(pointer: Pointer): void {
    if (pointer === nullPointer) {
      throw new TypeError('cannot erase null pointer')
    }
    const blockId = this.getBlockId(pointer)
    if (blockId !== this.blockId) {
      return this.blocks[blockId].erase(pointer)
    }
    const index = this.getIndex(pointer)
    // if we aren't storing anything for this index, nothing to do
    if (this.values[index] === undefined) {
      return
    }
    this.free(pointer)
    for (const field of this.fields) {
      field[index] = 0
    }
    for (const rawField of this.rawFields) {
      rawField[index] = 0
    }
  }

  /**
   * Erase *all* data in the slab.
   */
  wipeBlock(): void {
    for (const slab of this.fields) {
      slab.fill(0)
    }
    for (const slab of this.rawFields) {
      slab.fill(0)
    }
    if (this.blockId === 0) {
      this.values = [undefined]
    } else {
      this.values.length = 0
    }
    this.freeList.length = 0
    this.nextFree = this.firstNextFree
    this.blocksAvail.add(this)
  }

  /**
   * get all reference values, or set zero or more in an object
   */
  refAll(pointer: Pointer, refs?: RefSet<K>): RefSet<K> {
    noNullPointer(pointer, refs)
    const blockId = this.getBlockId(pointer)
    if (blockId !== this.blockId) {
      return this.blocks[blockId].refAll(pointer, refs)
    }

    const index = this.getIndex(pointer)
    if (this.values[index] === undefined) {
      // not a thing in this store
      if (refs) {
        return refs
      } else {
        const refs: RefSet<K> = Object.create(null)
        for (const [f, id] of Object.entries(this.names) as [
          FieldName<K>,
          FieldId
        ][]) {
          if (id < 0) {
            continue
          }
          refs[f] = nullPointer
        }
        return refs
      }
    }
    if (refs) {
      for (const [f, pointer] of Object.entries(refs) as [
        FieldName<K>,
        Pointer
      ][]) {
        const fieldId = this.names[f]
        if (fieldId === undefined) {
          throw errUnknownPointerField(f)
        }
        if (fieldId < 0) {
          throw errRawAsPointer(f)
        }
        const slab = this.fields[this.names[f]]
        slab[index] = pointer
      }
      return refs
    } else {
      const refs: RefSet<K> = Object.create(null)
      for (const [f, id] of Object.entries(this.names) as [
        FieldName<K>,
        FieldId
      ][]) {
        if (id < 0) {
          continue
        }
        refs[f] = this.fields[id][index] as Pointer
      }
      return refs
    }
  }

  /**
   * get all raw values, or set zero or more in an object
   */
  rawAll(pointer: Pointer, raws?: RawSet<R>): RawSet<R> {
    noNullPointer(pointer, raws)
    const blockId = this.getBlockId(pointer)
    if (blockId !== this.blockId) {
      return this.blocks[blockId].rawAll(pointer, raws)
    }

    const index = this.getIndex(pointer)
    if (this.values[index] === undefined) {
      // not a thing in this store
      if (raws) {
        return raws
      } else {
        const raws: RawSet<R> = Object.create(null)
        for (const [f, id] of Object.entries(this.names) as [
          FieldName<K>,
          FieldId
        ][]) {
          if (id >= 0) {
            continue
          }
          raws[f] = 0
        }
        return raws
      }
    }

    if (raws) {
      for (const [f, num] of Object.entries(raws) as [
        FieldName<R>,
        number
      ][]) {
        const fieldId = this.names[f]
        if (fieldId === undefined) {
          throw errUnknownRawField(f)
        }
        if (fieldId >= 0) {
          throw errPointerAsRaw(f)
        }
        const slab = this.rawFields[~fieldId]
        slab[index] = num
      }
      return raws
    } else {
      const raws: RawSet<R> = Object.create(null)
      for (const [f, id] of Object.entries(this.names) as [
        FieldName<R>,
        FieldId
      ][]) {
        if (id >= 0) {
          continue
        }
        raws[f] = this.rawFields[~id][index]
      }
      return raws
    }
  }

  /**
   * Get the reference from the supplied pointer, in the specified field
   */
  ref(pointer: Pointer, field: FieldName<K>): Pointer
  /**
   * Set the reference from the supplied pointer, in the specified field
   */
  ref(pointer: Pointer, field: FieldName<K>, target: Pointer): Pointer
  ref(pointer: Pointer, field: FieldName<K>, target?: Pointer): Pointer {
    noNullPointer(pointer, target)
    const blockId = this.getBlockId(pointer)
    const index = this.getIndex(pointer)
    const fieldId = this.names[field]
    if (fieldId < 0) {
      throw errRawAsPointer(field)
    }
    const slab = this.blocks[blockId].fields[fieldId]
    if (!slab) {
      throw errUnknownPointerField(field)
    }
    if (target === undefined) {
      // look up the ref and return the pointer
      return slab[index] as Pointer
    } else {
      return (slab[index] = target)
    }
  }

  /**
   * Get the raw data from the supplied pointer, in the specified rawField
   */
  raw(pointer: Pointer, field: FieldName<R>): number
  /**
   * Set the raw data from the supplied pointer, in the specified rawField
   */
  raw(pointer: Pointer, field: FieldName<R>, val: number): number
  raw(pointer: Pointer, field: FieldName<R>, val?: number): number {
    noNullPointer(pointer, val)
    const blockId = this.getBlockId(pointer)
    const index = this.getIndex(pointer)
    const fieldId = this.names[field]
    if (fieldId >= 0) {
      throw errPointerAsRaw(field)
    }
    const slab = this.blocks[blockId].rawFields[~fieldId]
    if (!slab) {
      throw errUnknownRawField(field)
    }
    if (val === undefined) {
      return slab[index]
    } else {
      return (slab[index] = val)
    }
  }

  /**
   * Get the data for a given pointer from the `values` array
   */
  value(pointer: Pointer): T | undefined
  /**
   * Set the data for a given pointer in the `values` array
   */
  value(pointer: Pointer, val: T): T
  value(pointer: Pointer, val?: T): T | undefined {
    noNullPointer(pointer, val)
    const blockId = this.getBlockId(pointer)
    const index = this.getIndex(pointer)
    return val !== undefined
      ? (this.blocks[blockId].values[index] = val)
      : this.blocks[blockId].values[index]
  }

  /**
   * Drop block from the set, or `wipeBlock()` if the root block.
   * Only allowed on the last block in the stack.
   */
  drop() {
    if (this.blockId !== this.blocks.length - 1) {
      throw new Error('only the final block may be dropped')
    }
    if (this.blockId === 0) {
      this.wipeBlock()
    } else {
      this.blocksAvail.delete(this)
      this.blocks.pop()
    }
  }

  /**
   * Pop any empty blocks off the end of the stack.
   */
  dropEmpty(): void {
    const blocks = this.blocks
    for (let i = this.blocks.length - 1; i > 0; i--) {
      if (blocks[i].entryCount(i) === 0) {
        blocks[i].drop()
      }
    }
  }

  /**
   * number of entries in a given block
   */
  entryCount(blockId: number): number {
    if (blockId !== this.blockId) {
      return this.blocks[blockId].entryCount(blockId)
    }
    return this.nextFree - this.freeList.length
  }
  /**
   * number of available spaces in a given block
   */
  available(blockId: number): number {
    if (blockId !== this.blockId) {
      return this.blocks[blockId].available(blockId)
    }
    return this.blockSize - this.entryCount(blockId)
  }

  /**
   * Total number of entries in the entire PointerSet
   * Note that it is always at least 1, because the root
   * block's zero-entry is reserved for the nullPointer.
   */
  size(): number {
    let size = 0
    for (let i = 0; i < this.blocks.length; i++) {
      size += this.blocks[i].entryCount(i)
    }
    return size
  }
  /**
   * Total number of available spaces in the entire PointerSet.
   */
  totalAvailable(): number {
    let available = 0
    for (let i = 0; i < this.blocks.length; i++) {
      available += this.blocks[i].available(i)
    }
    return available
  }

  /**
   * Number of blocks in the PointerSet
   */
  blocksCount(): number {
    return this.blocks.length
  }

  // TODO: drop empty blocks off the end, but retain at least X
  // amount of free space, to efficiently compress to a given range.
  // Need to track how much is free space is available in the
  // entire set, which could be costly if done in a naive way,
  // or buggy/dangerous if done in a clever way without care.
}

/**
 * Class representing the root block of and public interface to a
 * PointerSet block store.
 */
export class PointerSet<
    T extends PointerSetValueType,
    K extends readonly string[],
    R extends readonly string[] = []
  >
  extends PointerSetBase<T, K, R>
  implements PointerSetBlock<T, K, R>
{
  blocks: PointerSetBlock<T, K, R>[] = [this]
  blocksAvail: Set<PointerSetBlock<T, K, R>> = new Set([this])
  // zero-index item in the root block always empty
  // this lets us treat a ref of 0 as "null"
  values: (T | undefined)[] = [undefined]
  nextFree: Index = 1 as Index
  blockId: BlockId = 0 as BlockId
  firstNextFree: FirstNextFree = 1 as FirstNextFree

  fields: Uint32Array[]
  rawFields: Uint32Array[]
  names: { [k in FieldName<K> | FieldName<R>]: FieldId }
  wordSize: WordSize
  shift: Shift
  mask: Mask
  blockIdMask: BlockIdMask
  blockSize: BlockSize

  shiftDownFix: ShiftDownFix

  // indexes of that have been freed
  freeList: Stack

  /**
   * Public interface to create a PointerSet, also representing the
   * first block of data.
   */
  constructor(fields: K, blockSize = 256, rawFields?: R) {
    super()
    this.blockSize = blockSize as BlockSize
    const ws = getWordSize(this.blockSize)
    if (ws !== 1 && ws !== 2) {
      throw new TypeError('block size must be less than or equal to 65536')
    }
    this.freeList = new Stack(this.blockSize)
    this.wordSize = ws
    this.shift = (this.wordSize === 1 ? 8 : 16) as Shift
    this.mask = (this.wordSize === 1 ? mask8 : mask16) as Mask
    this.blockIdMask = (
      this.wordSize === 1 ? mask24 : mask16
    ) as BlockIdMask
    this.fields = []
    this.names = Object.create(null)
    this.shiftDownFix = (ws === 1 ? max24 : max16) as ShiftDownFix

    // protected pointer fields
    for (const field of fields) {
      const f = field as FieldName<typeof fields>
      this.names[f] = this.fields.length as FieldId
      const slab = unsafeUint32Array(this.blockSize)
      // init null pointer
      slab[0] = 0
      this.fields.push(slab)
    }

    // just plain old uint32 fields
    this.rawFields = []
    if (rawFields) {
      for (const rawField of rawFields) {
        const f = rawField as FieldName<typeof rawFields>
        if (fields.includes(f)) {
          throw new Error(`invalid raw field ${f}, specified in ${fields}`)
        }
        this.names[f] = ~this.rawFields.length as FieldId
        const slab = unsafeUint32Array(this.blockSize)
        // init null pointer
        slab[0] = 0
        this.rawFields.push(slab)
      }
    }
  }
}

/**
 * Class representing an expanded block in a PointerSet data store.
 * These are created on demand, they are NOT intended to be instantiated
 * directly.
 *
 * Exported for the benefit of type checking and extension use cases.
 */
export class PointerSetBlock<
    T extends PointerSetValueType,
    K extends readonly string[],
    R extends readonly string[] = []
  >
  extends PointerSetBase<T, K, R>
  implements PointerSet<T, K, R>
{
  // set unique for each block
  nextFree: Index = 0 as Index
  firstNextFree: FirstNextFree = 0 as FirstNextFree
  values: (T | undefined)[] = []
  freeList: Stack
  blockId: BlockId
  fields: Uint32Array[]
  rawFields: Uint32Array[]
  shiftDownFix: ShiftDownFix

  // set to match parent block
  blocks: PointerSetBlock<T, K, R>[]
  blocksAvail: Set<PointerSetBlock<T, K, R>>
  names: { [k in FieldName<K> | FieldName<R>]: FieldId }
  wordSize: WordSize
  shift: Shift
  mask: Mask
  blockIdMask: BlockIdMask
  blockSize: BlockSize

  /**
   * Class representing an expanded block in a PointerSet data store.
   * These are created on demand, they are NOT intended to be instantiated
   * directly.
   *
   * Exported for the benefit of type checking and extension use cases.
   */
  constructor(
    blocks: PointerSetBlock<T, K, R>[],
    blocksAvail: Set<PointerSetBlock<T, K, R>>,
    names: { [k in FieldName<K> | FieldName<R>]: FieldId },
    wordSize: WordSize,
    shift: Shift,
    mask: Mask,
    blockIdMask: BlockIdMask,
    blockSize: BlockSize
  ) {
    super()
    this.blocks = blocks
    this.blocksAvail = blocksAvail
    this.names = names
    this.wordSize = wordSize
    this.shift = shift
    this.mask = mask as Mask
    this.blockIdMask = blockIdMask
    this.blockSize = blockSize
    this.shiftDownFix = (wordSize === 1 ? max24 : max16) as ShiftDownFix

    this.blockId = this.blocks.length as BlockId
    // if we're not still below 2**24, something is VERY wrong.
    if (this.blockId !== (this.blockId & blockIdMask)) {
      throw new RangeError('out of memory')
    }

    this.blocks.push(this)
    /* c8 ignore start */
    if (this.blocks[this.blockId] !== this) {
      throw new Error('impossible (??) blockId memory error')
    }
    /* c8 ignore stop */
    this.blocksAvail.add(this)

    this.freeList = new Stack(this.blockSize)
    this.fields = []
    for (let i = 0; i < this.blocks[0].fields.length; i++) {
      this.fields.push(unsafeUint32Array(this.blockSize))
    }
    this.rawFields = []
    for (let i = 0; i < this.blocks[0].rawFields.length; i++) {
      this.rawFields.push(unsafeUint32Array(this.blockSize))
    }
  }
}

/**
 * Helper method for inferring types, since TS generics are all-or-nothing
 * and we don't pass a value type in the constructor.
 *
 *     const fields = ['my', 'fields'] as const
 *     const rawFields = ['raw'] as const
 *     const store = PointerSetInfer<ValueType>()(fields, blockSize, rawFields)
 *     // note the empty () here --------------^^
 */
export const pointerSetInfer =
  <T extends PointerSetValueType>() =>
  <K extends readonly string[], R extends readonly string[] = []>(
    fields: K,
    blockSize?: number,
    rawFields?: R
  ) =>
    new PointerSet<T, K, R>(fields, blockSize, rawFields)

/**
 * Helper method for generating a class that infers the field and rawField
 * names, since TS generics are all-or-nothing, and we don't pass a value type
 * in the constructor.
 *
 *     const fields = ['my', 'fields'] as const
 *     const rawFields = ['raw'] as const
 *     const PSClass = PointerSetInferFields(fields, rawFields)
 *     const store = new PSClass<ValueType>(blockSize)
 */
export const PointerSetInferFields = <
  K extends readonly string[],
  R extends readonly string[] = []
>(
  fields: K,
  rawFields?: R
) =>
  class PointerSetInferFields<
    T extends PointerSetValueType
  > extends PointerSet<T, K, R> {
    constructor(blockSize?: number) {
      super(fields, blockSize, rawFields)
    }
  }
