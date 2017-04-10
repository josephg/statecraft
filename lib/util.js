

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

const setIntersect = (set1, set2) => {
  const result = new Set
  if (set1.size > set2.size) [set1, set2] = [set2, set1]

  for (const v of set1) {
    if (set2.has(v)) result.add(v)
  }
  return result
}

const vintersect = (a, b) => b == null ? a : setIntersect(a, b)

const filterCapabilities = (c1, c2) => {
  // This is actually sort of an intersection of c1 and c2, but whatever.
  return {
    mutationTypes: vintersect(c1.mutationTypes, c2.mutationTypes),
    opTypes: vintersect(c1.opTypes, c2.opTypes),
    queryTypes: vintersect(c1.queryTypes, c2.queryTypes),
  }
}

module.exports = {beginsWith, mapKey, mapRange, inRange, inRanges, normalizeRanges, filterCapabilities}
