

const beginsWith = (str, prefix) => (str.slice(0, prefix.length) === prefix)

const mapKey = (key, fromPrefix, toPrefix) => toPrefix + key.slice(fromPrefix.length)
const mapRange = (range, fromPrefix, toPrefix) => range.map(x => mapKey(x, fromPrefix, toPrefix))

const inRange = (x, range) => (x >= range[0] && x <= range[1])
const inRanges = (x, ranges) => ranges.some(range => inRange(x, range))

// Edits ranges in-place.
const normalizeRanges = (ranges) => {
  // first sort by starting key
  ranges.sort(([a0], [b0]) => a0 - b0)

  for (let i = 0; i < ranges.length - 1; i++) {
    let a1 = ranges[i][1]
    while (ranges[i+1][0] <= a1) {
      // Merge.
      let [b0, b1] = ranges[i+1]

      a1 = ranges[i][1] = max(a1, b1)
      ranges.splice(i+1, 1)
      if (i+1 >= ranges.length) break
    }
  }

  return ranges
}

module.exports = {beginsWith, mapKey, mapRange, inRange, inRanges, normalizeRanges}
