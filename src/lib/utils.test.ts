import { stringify } from "./utils"
import { describe, it, expect } from "vitest"

describe("stringify utility", () => {
  it("should stringify an object with a bigint", () => {
    const obj = {
      a: 1,
      b: 2n,
      c: {
        d: 3n,
      },
    }
    const result = stringify(obj)
    expect(result).toBe('{"a":1,"b":"2","c":{"d":"3"}}')
  })

  it("should work with arrays containing bigints", () => {
    const arr = [1n, 2n, 3n]
    const result = stringify(arr)
    expect(result).toBe('["1","2","3"]')
  })

  it("should respect the space parameter", () => {
    const obj = { a: 1n }
    const result = stringify(obj, 2)
    expect(result).toBe('{\n  "a": "1"\n}')
  })
})
