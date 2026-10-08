/** Orders strings by UTF-16 code unit, the order Array#sort uses without a comparator. */
export function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
