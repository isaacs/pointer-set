import { Pointer } from '../'
import { BinaryTree } from './binary-tree'
import { BinaryTreeUint32 } from './uint-binary-tree'

const N = 1000000
const max32 = 2 ** 32 - 1
const bigNums = process.argv[2] === 'bignums'
const getNum = (n: number) => (bigNums ? max32 - n : n)

const test = (B: typeof BinaryTree<number> | typeof BinaryTreeUint32) => {
  console.log('testing', B.name)
  const startctor = performance.now()
  const timector = performance.now() - startctor
  const bt = new B((a, b) => a - b, 65536)

  const startfill = performance.now()
  let root: Pointer = bt.add(getNum(N / 2))
  for (let i = 1; i < N; i++) {
    const node = bt.add(
      getNum(Math.floor(Math.random() * N)),
      root
    ) as Pointer
    root = root || node
  }
  const timefill = performance.now() - startfill

  // const m: Map<number, { [k: string]: any }> = new Map()
  let prev = 0
  const startwalk = performance.now()
  bt.walk(
    root as Pointer,
    value => {
      if (value < prev) {
        throw new Error('not sorted!')
      }
      prev = value
    },
    0
  )
  const timewalk = performance.now() - startwalk

  // now search for some stuff, see how deep we have to go
  let maxDepth = 0
  const depths: number[] = []
  const startsearch = performance.now()
  let failedSearches = 0
  for (let i = 1; i < N; i++) {
    bt.search(
      root,
      getNum(Math.floor(Math.random() * N)),
      (n: number | undefined, depth: number) => {
        if (n === undefined) {
          failedSearches++
        }
        depths.push(depth)
        maxDepth = Math.max(depth, maxDepth)
      }
    )
  }
  const timesearch = performance.now() - startsearch

  console.log({
    timector,
    timefill,
    avgtimewrite: timefill / N,
    timewalk,
    timesearch,
    avgtimesearch: timesearch / N,
  })

  console.log(`N=${N}`)
  console.log(`maxDepth=${maxDepth}`)
  const totalDepth = depths.reduce((a, b) => a + b, 0)
  console.log(`avgDepth=${totalDepth / depths.length}`)
  console.log(`log2(N): ${Math.log2(N)}`)

  // calculate a depth histogram
  const buckets: number[] = []
  const numBuckets = Math.min(Math.floor((maxDepth + 1) / 2), 40)
  for (let i = 0; i < numBuckets; i++) buckets[i] = 0
  const bucketSize = (maxDepth + 1) / numBuckets
  for (const d of depths) {
    const bucket = Math.floor(d / bucketSize)
    buckets[bucket]++
  }
  let maxHist = 0
  for (const bucket of buckets) {
    maxHist = Math.max(maxHist, bucket)
  }
  const histWidth = 40
  let hist = ''
  for (let i = 0; i < buckets.length; i++) {
    const bucket = buckets[i]
    const p = `         ${Math.ceil(bucketSize * i)}: `.slice(
      -1 * (`${maxDepth}`.length + 3)
    )
    const len = Math.ceil((bucket / maxHist) * histWidth)
    // if (len === 0) continue
    hist += `${p}${'*'.repeat(len)} ${Math.ceil(buckets[i])}\n`
  }

  console.log('depth histogram')
  console.log(hist)
}

test(BinaryTree<number>)
test(BinaryTreeUint32)
