function normalizeText(value, max = 500) {
  return String(value || "").trim().slice(0, max)
}

export function createCommandError(input = {}) {
  const error = {
    code: normalizeText(input.code, 80),
    stage: normalizeText(input.stage, 80),
    message: normalizeText(input.message, 240),
    detail: normalizeText(input.detail, 500),
    fallback: normalizeText(input.fallback, 80),
    at: normalizeText(input.at || new Date().toISOString(), 80)
  }

  return Object.fromEntries(
    Object.entries(error).filter(([, value]) => value)
  )
}

export function stringifyCommandError(input = {}) {
  const error = createCommandError(input)
  return JSON.stringify(error).slice(0, 500)
}

export function parseCommandError(rawValue) {
  const value = String(rawValue || "").trim()

  if (!value) {
    return null
  }

  try {
    const parsed = JSON.parse(value)

    if (!parsed || typeof parsed !== "object") {
      return null
    }

    return createCommandError(parsed)
  } catch {
    return null
  }
}
