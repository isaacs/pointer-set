# pointer-set

A general-purpose pointer implementation using an automatically
expanding set of UintArray blocks, for use in building linked
lists and other sorts of data structures.

Some minimal protections are in place if using this module with
TypeScript, but it will not prevent you from memory leaks,
dangling pointers, and other perils of manual memory management.

Use with caution!

## Caveats: When to (and when _not_ to) use this, and why

There is a common misconception that working with integers in a
UintArray slab is inherently always going to be faster than
working with plain old JavaScript objects.

This is not true!  But it contains a grain of truth, depending on
your workload, mostly owing to the nature of garbage collection
in JavaScript runtimes.

Modern JavaScript VMs optimize the most common behaviors of
JavaScript programs.  This means, usually, lots of more or less
consistently-shaped objects, most of which are created and then
discarded relatively quickly, and a handful of which are kept
pretty much for the life of the program.

VMs differ, of course, but a common approach is to divide up
objects into "young" and "old" generations.  Anything that's in
the young generation is expected to be discarded, so the GC keeps
it handy.  Anything that sticks around beyond that threshold, the
VM assumes you'll probably never delete it, so it moves it into a
longer term storage area, where it's not tracked in the same way.

If you _do_ lose the reference to that old object, though, it
needs to be garbage collected, and walking it in the object graph
is expensive because it needs to rebuild that information.

So, if you have a cache or something, where you're creating a lot
of objects, holding onto them for "a while" and then discarding
the oldest ones as more keep coming in, you're basically asking
the VM to do the one thing it's worst at.  In that case, using
manually managed memory in a pre-allocated slab is much better,
because there's nothing to garbage collect.

On the other hand, if you're creating objects and looking up
their properties very frequently, or if you're always keeping
these entries either for a very short time or essentially
forever, doing this by yourself with bitwise integer arithmetic
is _very unlikely_ to be more optimized than the code paths the
VM has to handle object property accesses.  Those are going to be
more optimized, because the VM is designed specifically for that
purpose.  And, it's going to be a much extremely inconvenient
besides.

Another thing that can be really slow is passing object
references from the JS environment to some other environment that
is not managed (or _separately_ managed) by the VM.  For example,
crosing the C++ and JS layers in a Node.js `.node` addon or
passing objects to Workers.  In these sorts of cases, the object
reference has to be tracked differently, because the garbage
collection semantics get more complicated.  But, if both sides
have a reference to the same block of memory in a Uint32Array,
then they can both update it, and they'll see the changes
immediately.  This is fast, powerful, and dangerous.

You should profile your program with realistic workloads before
embarking on a journey of performance optimization.  You should
_also_ profile your program with realistic workloads _after_
making a change intended to improve performance.

As it happens, the initial use case I had for this module made it
seem like a pointer-based solution would be promising.  And,
since I'd already done something similar for
[lru-cache](http://npm.im/lru-cache), I thought I'd try it.  As
it happens, it's about 40% slower than just using plain old
JavaScript objects, so I'm not sure what this module is even for
and won't be using it.  But it might be beneficial to someone
else, and it was fun to explore, so that's OSS working as
intended :)

**tl;dr**

- Profile before (and after) you optimize.
- Use pointers if your workload involves frequently discarding
  objects that have made it to the "older" generation of objects.
  If entries are usually discarded frequently after creation, or
  rarely discarded at all, JS objects are likely better.
- Use pointers if you need the data to be available to code that
  doesn't run on the JS VM (ie, a C++ `.node` binding, WASM,
  etc.)
- Otherwise, before you try some fancy data structure, maybe just
  use plain old JS objects and arrays, they're pretty fast
  actually.

## USAGE

Note that the example here and in the [examples](./examples)
folder are using very simple data structures, which would almost
certainly be more performant to just use plain old JavaScript
objects.  (See the caveats section above.)

But it's easier to show the API with a simple example than with a
complex one.

```js
// hybrid module, either works
import { PointerSet } from 'pointer-set'
// or
const { PointerSet } = require('pointer-set')

// a doubly-linked list, block size of 256 pointers
// this will allocate 1kb per block (4 bytes per pointer)
// and expand in 1kb chunks up to a maximum of 2**24 blocks
// (ie, 2**32 pointers), which should be enough for most cases.
//
// The 'fields' argument should ideally always be an inline array
// of string literals, so that TypeScript can prevent errors
// that may occur from trying to get/set an invalid field.
const fields = ['next', 'prev'] as const
const store = new PointerSet<string, typeof fields, []>(fields, 256)

// typescript generics are all-or-nothing, so we can't do this:
// const store = new PointerSet<string>(fields, 256)
// but we can use a helper class:
import { PointerSetInferFields } from 'pointer-set'
const FieldsInferred = PointerSetInferFields(fields)
const storeInferred = new FieldsInferred<string>()

// to take bigger bytes of data, and do fewer allocations as a
// result, albeit with the downside of consuming more memory:
const store16 = new PointerSet<string, typeof fields, []>(fields, 65536)

// You CAN use blockSize of a number other than 256 or 65536,
// but doing so will limit the total number of items that can
// be stored, since the upper bound is 2**24 blocks for any
// block size <= 256, and 2**16 blocks for any block size between
// 256 and 65536, so these two values both result in a total
// number of items limited to 2**32, and it goes down from there
// This is because the pointer is a Uint32 that stores the
// block id and index in a single bit-shifted value.

// create a pointer and store its value.  Note that the
// first entry is always 1, because 0 is used as a null ref.
const zro = store.alloc('zro')

// alloc another pointer
const one = store.alloc('one')
// set zro's 'next' reference to it
store.ref(zro, 'next', one)
// set one's 'prev' reference back to zro
store.ref(one, 'prev', zro)

// store.ref() returns the ref, so we can do it this way, too
const two = store.ref(one, 'next', store.alloc('two'))
// create the link back from two to one
store.ref(two, 'prev', one)

// alloc() also can take an object of fields and pointers to set
const tre = store.alloc('tre', { prev: two })
store.ref(two, 'next', tre)

// or we can combine those two in one line
const fur = store.ref(tre, 'next', store.alloc('fur', { prev: one }))

// say we want to remove item tre
// Important to free the pointer, so that its space can be
// reused! There is no automatic gc in the pointer store.
store.free(tre)
// set two->fur
store.ref(two, 'next', fur)
// set two<-fur
store.ref(fur, 'prev', two)
// done!

// walk the list
for (let p = zro; p; p = store.ref(p, 'next')) {
  console.log(store.value(p))
}
// walk the list backwards, same thing just different field
for (let p = fur; p; p = store.ref(p, 'prev')) {
  if (p === tre) {
    store.value(p, 'ert')
  }
  console.log(store.value(p))
}
```

See the scripts in [`./examples`](./examples) for more.

## `PointerSetInferFields(fields: readonly string[], rawFields?: readonly string[]) => class`

Because TypeScript generics are all-or-nothing, we cannot do
this:

```
new PointerSet<string>(['field'] as const, blockSize)
//             ^-- Expected 2-3 type arguments, but got 1. (tsserver 2558)
```

and would instead have to do:

```ts
const fields = ['field'] as const
new PointerSet<string, typeof fields, []>(fields, blockSize)
```

specifying _all_ of the types in the generic, which can get
rather verbose.

To work around this, the `PointerSetInfer` method takes a const
array of field names, and a const array of raw field names, and
returns a class where those are fixed.

```ts
const fields = ['field'] as const
const MyClass = PointerSetInfer(fields)
const store = new MyClass<string>()
// now store's type knows what fields are defined,
// and sets the value type to `string`
```

The other option, of course, is to leave the value type
unspecified as well. Then the field and rawField names can be
inferred, but the value will be left as `any`, so there won't be
any type checking of the data passed to `store.value(pointer,
data)` method.

## `nullPointer: 0 as Pointer`

For convenience, a reference to the null pointer is exported.
It's just the number `0` cast to the `Pointer` type.

## type `Pointer`

A pointer is just a number in the unsigned 32 bit range (ie,
between `0` and `2**32 - 1`). The exported type is branded with
a unique symbol.

For safety, all methods that expect to get a `Pointer` will use
this branded type, to prevent you from accentally using a pointer
reference that was not provided by this library. However, for
cases where you may need to cast to the type, it's exported.

## Class `PointerSet<T, K extends readonly string[], R extends readonly string[] = []>`

This is the class that represents an expanding data store of
entries, where each entry is a value of type `T`, and a set of
pointers to other entries for each of the field names in `K`.

The type `T` can be anything except `undefined`. (If you aren't
storing JavaScript values, `null` is a good option.)

For notes on using type inferrence to set `K` and `R` types, see
the section above regarding the `PointerSetInferFields` method.

### `store = new PointerSet<T, K, R>(fieldNames: K, blockSize: number = 256, rawFieldNamess?: R)`

Create a new PointerSet to store entries with a value of `T`, and
the internal references named by `fieldNames`.

Any names in `rawFieldNames` will be marked as unsafe for pointer
dereferencing. They may be used to store arbitrary `uint32`
values, which is more efficient than filling up a `number[]`,
especially if multiple numbers are needed which would require a
`number[][]`.

#### `fieldNames` and `rawFieldNames`

When instantiating, `fieldNames` (and optionally `rawFieldNames`)
should be an inline array of string literals or a string array
marked with `as const` or `readonly`, so that TypeScript can
properly infer the list of types via static analysis.

For example:

```js
// good!
const treeStore = new PointerSet(['prev', 'next', 'children'], 256)
// also good!
const fields = ['prev', 'next', 'children'] as const
const treeStore = new PointerSet(fields, 256)
// another way
const fields: readonly string[] = ['prev', 'next', 'children']
const treeStore = new PointerSet(fields, 256)

// all of these also work with PointerSetInferFields, if you
// want to infer the field names, but leave the value type able
// to be set explicitly.

// using PointerSet as a type
// inline field names
class MyTree<T> {
  store: PointerSet<T, ['prev', 'next', 'children'], []>
  constructor() {
    this.store = new PointerSet<T, ['prev', 'next', 'children'], []>()
  }
}

// `as const` field names
const fields = ['prev', 'next', 'children'] as const
class MyTree<T> {
  store: PointerSet<T, typeof fields, []>
  constructor() {
    this.store = new PointerSet<T, fields>()
  }
}

// `readonly` field names
const fields: readonly string[] = ['prev', 'next', 'children']
class MyTree<T> {
  store: PointerSet<T, typeof fields, []>
  constructor() {
    this.store = new PointerSet<T, fields>()
  }
}
```

```
// not as good, doesn't type check or autocomplete field names
const fields = ['prev', 'next', 'children']
const treeStore = new PointerSet(fields, 256)
```

#### `blockSize`

The default blockSize value is 256, and affects the allocation
and storage behavior. In general, this module is tuned more for
speed than for memory efficiency, so it's wise to take the
trade-offs into account.

`blockSize` can be any number between 1 and 65536, and sets the
number of entries that can be stored in a single block.

##### `blockSize` Tuning

**tl;dr**

- Leave the default for a good trade-off between allocation
  speed, with the caveat that heap expansion allocations can
  occur at run time more frequently (at every multiple of 256
  items).
- Setting a larger value will mean fewer slower allocations.
- 256 and 65536 result in the maximum possible hard capacity
  limit.
- Setting any smaller value does **not** cause PointerSet to
  consume less memory (it'll be either 13 or 14 bytes per entry,
  regardless), but it does change the manner in which it is
  consumed.

If set to 256 or smaller, then each pointer will use a single
byte for the index within the block, and 3 bytes for the blockId.
If set to a number greater than 256 and less than 65535, then 2
bytes will be used for item index, and 2 bytes for block id.

If set to _either_ 256 or 65536, then `2**32` items can be
stored, allocating either in blocks of 256 or 65536,
respectively. In the first case, up to 16777216 blocks can be
allocated, each holding 256 items. In the second, up to 65536
blocks can be allocated, each storing 65536 items. Both result
in `2**32` items as an upper bound.

If set to some number other than 256 or 65536, then the total
allocation capacity will be limited to less than `2**32`, because
it'll still use the same number of bytes for item index and block
id, so this is something to keep in mind.

An internal `freeList` stack of free indexes is allocated as
well. When the `blockSize` is 256 or less, the `freeList` is a
`Uint8Array` of `blockSize` items. When the `blockSize` is
greater than `256`, the `freeList` is a `Uint16Array` of
`blockSize` items.

The storage capacity overhead for each block is thus:

```js
blockSize * 4 + fields.length * blockSize * 4 + freeListSize
```

So, for `new PointerSet<T>(['two', 'fields'], 256)`, that works
out to `256 * 4 + 2 * 256 * 4 + 256`, or 3328 bytes per block,
with a hard capacity limit of 4294967296 items, stored across
16777216 blocks, for a total allocation overhead of 52GiB,
averaging 13 bytes allocated per item at this limit.

For `new Pointer<T>(['two', 'fields'], 65536)`, that is `65536 *
4 + 2 * 65536 * 4 + 65536 * 2`, or 896kb per block. At full
capacity of 65536 blocks, this results in 56GiB, or 14 bytes per
item. Each block allocation will take significantly longer, but
they will happen 1/256 as often, making it a reasonable trade
off in many cases.

If the blockSize is set to `32768`, then the block count will
still be limited to 65536, but each block will contain 1/2 as
many times, for a total capacity limit of 2,147,483,648 items
(that is, half as many as with a blockSize of 256 or 65536).
In the case of a PointerSet with two fields, each block will be
`32768 * 4 + 2 * 32768 * 4 + 32768 * 2` or 448KiB per block. At
full capacity, this results in 14GiB of allocation overhead, or
14 bytes per item.

This scheme ensures that all reference lookups between blocks
are `O(1)`, because there is never any need to scan the list of
blocks. It also prevents excessive garbage collection of
JavaScript objects, because there aren't many; each pointer is
just a number.

#### When to use `rawFields`

If the value that you would be storing can be expressed as one or
more unsigned 32-bit integer values, then you can get more
efficient and performant storage by specifying them as
`rawFields` rather than setting them in the value type.

This is handy if you want to store a string _and_ some other
arbitrary numbers, because managing an array of a large number of
small objects can be very slow due to garbage collection
overhead.

You should _not_ use this if your value property would otherwise be
JavaScript numbers, since those are highly optimized, and a
JavaScript array of integers is slightly _more_ performant in
many cases than a Uint32Array.

However, if it saves putting _objects_ into the values array (for
example, if you are storing an object that is just 3 integers),
then it can be worthwhile.

For example:

```js
// a linked list where each entry stores a 3-d point
interface Point {
  x: number
  y: number
  z: number
}
const fields = ['prev', 'next'] as const
const store = new PointerSet<Point, typeof fields, []>(fields)
const p = store.alloc(new Point(1,3,7))
// stores 'prev' and 'next' as internal references,
// and pushes [2, 3] to store.values as a javascript object
const x = store.value(p).x
const y = store.value(p).y
const z = store.value(p).z
```

Since we know the number is going to be between 0 and `2**32`, we
can get a better result by doing it this way:

```ts
const fields = ['prev', 'next'] as const
const raw = ['x', 'y', 'z'] as const
const store = new PointerSet<null, typeof fields, typeof raw>(
  fields,
  256,
  raw
)
const p = store.alloc(null)
// stores 'prev' and 'next' as internal references,
// stores 'x', 'y', and 'z' in the raw value buffers
const x = store.raw(p, 'x')
const y = store.raw(p, 'y')
const z = store.raw(p, 'z')
```

Tradeoffs:

- Using raw values increases the allocation size of each block.
  However, it does _not_ increase overall memory usage in the
  full block state as much as using almost any JavaScript value
  type would. It's just pre-allocating rather than allocating it
  on demand.
- raw values are limited to integers in the range from `0` to
  `2**32-1`, and there is no type checking to prevent overflow.
- raw values avoids JavaScript garbage collection costs incurred
  by having to track and clean up the entries in the block's
  `values` array. This becomes relevant for complex value types;
  it's rarely beneficial if you would only be storing a single
  number anyway.

### `store.size(): number`

The total number of entries stored in all blocks in the
PointerSet.

### `store.totalAvailable(): number`

The total number of available entry slots in all blocks in the
PointerSet. Note that the storage will expand on demand, so this
is actually just the number of entries that can be set before
another allocation will occur.

### `store.entryCount(blockId: number): number`

The number of entries stored in a given block.

### `store.available(blockId: number): number`

The number of available entry slots in a given block.

### `store.alloc(value: T, refs?: {[k: string]: Pointer}) => Pointer`

Allocate a new memory location, and set the stored value to
`value`. If `refs` is provided, then each of the fields in refs
will be set to the provided pointer value.

### `store.free(pointer: Pointer) => void`

Remove the pointer's value from the store, and mark its memory
location as available for reuse.

Note that this does _not_ unset any entries that reference this
pointer, or erase any data from any of the pointer fields. It
only drops the value and marks the index as available for
reuse.

### `store.erase(pointer: Pointer) => void`

Calls `store.free(pointer)` and also sets all of its field
references to null.

Note that this does _not_ unset any entries that reference this
pointer.

### `store.ref(pointer: Pointer, field: string) => Pointer`

Get the value of the specified field. If `0` is returned (a null
pointer) then the field is unset.

### `store.ref(pointer: Pointer, field: string, target: Pointer) => Pointer`

Set the value of the field on the referenced pointer to the
target. Returns the target pointer.

### `store.refAll(pointer: Pointer }) => refs`

Get a JavaScript object containing all references from the
pointer provided. Returned object has a key with each of the
`fieldNames` provided, where the value is a `Pointer` (or the
`nullPointer` if not yet set).

### `store.refAll(pointer: Pointer, refs: { [k: string]: Pointer }) => refs`

Iterate over the keys in `refs`, calling `store.ref(pointer, key,
refs[key])`.

Returns the `refs` object provided.

### `store.value(pointer: Pointer) => T | undefined`

Returns the value stored for the supplied pointer, or undefined
if no value provided.

Always returns `undefined` for a null pointer.

### `store.value(pointer: Pointer, value: T) => T`

Set the value store for the pointer to the supplied value.
Returns the supplied value.

### `store.raw(pointer: Pointer, field: FieldName<R>): number`

Specify one of the names provided in the `rawFields` list, and
get the number value between `0` and `2**32` stored at the
apporpriate address.

### `store.raw(pointer: Pointer, field: FieldName<R>, val: number): number`

Specify one of the names provided in the `rawFields` list, and
set the number value between `0` and `2**32` stored at the
apporpriate address to the provided value.

### `store.raw8(pointer: Pointer, field: FieldName<R>): Uint8ArrayLength4`

Specify one of the names provided in the `rawFields` list, and
get an editable 4-byte Uint8Array view of the underlying bytes.

Note that the type is set to prevent accidentally attempting to
read or write past the known length.

### `store.raw8(pointer: Pointer, field: FieldName<R>, val: Uint8Array): Uint8ArrayLength4`

Specify one of the names provided in the `rawFields` list, and
set the bytes to those specified in the supplied 4-byte
Uint8Array. Returns an editable 4-byte Uint8Array view of the
underlying bytes.

Note that the type is set to prevent accidentally attempting to
read or write past the known length.

### `store.raw16(pointer: Pointer, field: FieldName<R>): Uint16ArrayLength2`

Specify one of the names provided in the `rawFields` list, and
get an editable 2-word Uint16Array view of the underlying bytes.

Note that the type is set to prevent accidentally attempting to
read or write past the known length.

### `store.raw16(pointer: Pointer, field: FieldName<R>, val: Uint16Array): Uint16ArrayLength2`

Specify one of the names provided in the `rawFields` list, and
set the bytes to those specified in the supplied 2-word
Uint16Array. Returns an editable 2-word Uint16Array view of the
underlying bytes.

Note that the type is set to prevent accidentally attempting to
read or write past the known length.

### `store.raw32(pointer: Pointer, field: FieldName<R>): Uint32ArrayLength1`

Specify one of the names provided in the `rawFields` list, and
get an editable 1-word Uint32Array view of the underlying bytes.

Note that the type is set to prevent accidentally attempting to
read or write past the known length.

### `store.raw32(pointer: Pointer, field: FieldName<R>, val: Uint32Array): Uint32ArrayLength1`

Specify one of the names provided in the `rawFields` list, and
set the bytes to those specified in the supplied 1-word
Uint32Array. Returns an editable 1-word Uint32Array view of the
underlying bytes.

Note that the type is set to prevent accidentally attempting to
read or write past the known length.

### `store.rawAll(pointer: Pointer) => raws`

Get all the raw values as a JavaScript object, where the keys are
the field names and the values are the numbers stored in the
slab.

### `store.rawAll(pointer: Pointer, raws: { [k: string]: number }) => raws`

Set zero or more raw values. Returns the same values object
provided.

### `store.wipeBlock() => void`

Erases all entries on a given block.

### `store.dropEmpty() => void`

Drop any empty blocks from the end of the set.

### `store.drop() => void`

**Internal Method**

Remove a block from the set.

Throws if the block has entries, or if any subsequent blocks
exist. When called on the root block, calls `store.wipeBlock()`
instead.
