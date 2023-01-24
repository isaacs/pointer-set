// this compares the impact of managing a values array containing
// a mix of numbers and holes, with one containing a mix of
// numbers and undefined, a mix of undefineds and holes, and
// only undefined.
//
// Takeaways:
// - All of these operations are blazingly fast, and it's only in
//   extremely hot paths where it would *ever* matter.
// - The prior perf advice to avoid array holes like the plague
//   seems to be no longer relevant.  Holes perform about the same
//   as having undefined values in the array.
// - However! A *completely* empty array performs about 10x worse
//   for arbitrary writes in the middle or end.  So the thing to avoid
//   is an array with large stretches of holes.
// - No matter what type of array it is, and whether it's holey or
//   consistently typed, calculating the length and then writing
//   somewhere far from the end is way slower than anything else,
//   which is a bit mysterious.
// - Really, the thing to avoid is ever having to calculate the length,
//   if array performance is critical.
// - All of this applies equally to starting out with [] or new Array(len),
//   can't dodge the performance cost by knowing the length up front.

class Timer {
  start = {}
  times = {}
  s(t) {
    if (this.start[t]) throw new Error('dupe timer: ' + t)
    this.start[t] = performance.now()
  }
  e(t) {
    if (!this.start[t]) throw new Error('unknown timer: ' + t)
    this.times[t] = performance.now() - this.start[t]
  }
}

const f = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 5,
  minimumFractionDigits: 5,
})
const [t, s, e] = (() => {
  let timer
  const times = {}
  let count = 0
  const t = () => {
    if (timer) {
      count++
      for (const [t, v] of Object.entries(timer.times)) {
        times[t] = v
      }
    }
    timer = new Timer()
  }
  process.on('exit', () => {
    t()
    console.log(
      'times in ms/65536 operations, smaller is better\n' +
      Object.entries(times)
        .map(([t, v]) => [v, t])
        .sort(([a], [b]) => a - b)
        .map(([v, t]) =>
          [(' '.repeat(10) + f.format(v / count)).slice(-9), t].join('\t')
        )
        .join('\n')
    )
  })
  const s = t => timer.s(t)
  const e = t => timer.e(t)
  return [t, s, e]
})()

const fillNums = (arr = []) => {
  for (let i = 0; i < 2 ** 16; i++) {
    arr[i++] = i
    arr[i] = i
  }
  return arr
}

const fillNumHoles = (arr = []) => {
  for (let i = 0; i < 2 ** 16; i++) {
    arr[i++] = i
  }
  return arr
}

const fillNumUndefs = (arr = []) => {
  for (let i = 0; i < 2 ** 16; i++) {
    arr[i++] = i
    arr[i] = undefined
  }
  return arr
}

// just return the array.  all holes!
const fillEmpty = (arr = []) => {
  return arr
}

const fillAllHolesOneUndef = (arr = []) => {
  arr[2**16 - 1] = undefined
  return arr
}

const fillUndefHoles = (arr = []) => {
  for (let i = 0; i < 2 ** 16; i++) {
    arr[i++] = undefined
  }
  return arr
}

const fillUndefs = (arr = []) => {
  for (let i = 0; i < 2 ** 16; i++) {
    arr[i++] = undefined
    arr[i] = undefined
  }
  return arr
}

const writeEnd = (arr, name, N) => {
  s('write at end, using 2**16 ' + name)
  for (let n = 0; n < N; n++) {
    for (let i = 0; i < 2 ** 16; i++) {
      const target = 2 ** 16 - (i % 1000)
      arr[target] = i
    }
  }
  e('write at end, using 2**16 ' + name)
}

const writeEndLength = (arr, name, N) => {
  s('write at end, using length ' + name)
  for (let n = 0; n < N; n++) {
    for (let i = 0; i < 2 ** 16; i++) {
      const target = i.length - (i % 1000)
      arr[target] = i
    }
  }
  e('write at end, using length ' + name)
}

const writeMid = (arr, name, N) => {
  s('write middle, using 2**16/2 ' + name)
  for (let n = 0; n < N; n++) {
    for (let i = 0; i < 2 ** 16; i++) {
      const target = 2 ** 16 / 2 - (i % 1000)
      arr[target] = i
    }
  }
  e('write middle, using 2**16/2 ' + name)
}

const writeMidLength = (arr, name, N) => {
  s('write middle, using length ' + name)
  for (let n = 0; n < N; n++) {
    for (let i = 0; i < 2 ** 16; i++) {
      const target = arr.length / 2 - (i % 1000)
      arr[target] = i
    }
  }
  e('write middle, using length ' + name)
}

const calcMidNoWrite = (arr, name, N) => {
  s('calc middle, using length ' + name)
  for (let n = 0; n < N; n++) {
    for (let i = 0; i < 2 ** 16; i++) {
      const target = arr.length / 2 - (i % 1000)
      target
    }
  }
  e('calc middle, using length ' + name)
}


const writeStart = (arr, name) => {
  s('write start ' + name)
  for (let i = 0; i < 2 ** 16; i++) {
    const target = i % 1000
    arr[target] = i
  }
  e('write start ' + name)
}

const cases = [
  ['nums', fillNums],
  ['numUndefs', fillNumUndefs],
  ['numHoles', fillNumHoles],
  ['undefs', fillUndefs],
  ['undefHoles', fillUndefHoles],
  ['empty', fillEmpty],
  ['allHolesOneUndef', fillAllHolesOneUndef],
]

const N = 10
const arrs = [
  [ '[]', () => [] ],
  // no significant different found between these two
  // [ 'new Array(2**16)', () => new Array(2**16) ],
]
for (const [arrType, makeArr] of arrs) {
  for (let i = 0; i < 10; i++) {
    t()
    for (const [n, filler] of cases) {
      const name = arrType + ' ' + n
      const arr = filler(makeArr())
      writeEnd(arr, name, N)
      writeMid(arr, name, N)
      writeStart(arr, name, N)
      calcMidNoWrite(arr, name, N)
      writeMidLength(arr, name, N)
      writeEndLength(arr, name, N)
    }
  }
}
