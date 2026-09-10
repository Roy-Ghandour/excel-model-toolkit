// Shared Driver code

/** Error message helper, renders a value cleanly */
function describe(value) {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/**
 * Refuse to write anything that is not a finite number.
 */
export function assertWritable(name, value) {
  if (!Number.isFinite(value)) {
    throw new Error(
      `'${name}' must be written as a finite number, received: ${describe(
        value
      )}`
    );
  }
}
