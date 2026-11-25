export function randomInteger(minimum: number, maximum: number): number {
  const range = maximum - minimum + 1;
  const sampleSpace = 0x100000000;
  const limit = sampleSpace - (sampleSpace % range);
  const values = new Uint32Array(1);
  let value: number;

  do {
    crypto.getRandomValues(values);
    value = values[0];
  } while (value >= limit);

  return minimum + (value % range);
}
