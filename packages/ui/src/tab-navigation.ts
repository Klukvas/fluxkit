/**
 * Index of the tab that a key press moves to (WAI-ARIA tabs pattern, horizontal): arrows move by one and wrap,
 * Home and End jump to the first and last enabled tab. Disabled tabs are skipped. Returns `null` when the key does not
 * navigate or no tab is enabled, so the caller leaves the event alone.
 */
export function nextTabIndex(
  current: number,
  key: string,
  disabled: readonly boolean[],
): number | null {
  const count = disabled.length;
  const isEnabled = (index: number): boolean => disabled[index] === false;
  if (!disabled.some((flag) => !flag)) {
    return null;
  }
  const step = (from: number, direction: 1 | -1): number => {
    for (let offset = 1; offset <= count; offset += 1) {
      const index = (((from + direction * offset) % count) + count) % count;
      if (isEnabled(index)) {
        return index;
      }
    }
    return from;
  };
  switch (key) {
    case "ArrowRight":
      return step(current, 1);
    case "ArrowLeft":
      return step(current, -1);
    case "Home":
      return isEnabled(0) ? 0 : step(0, 1);
    case "End":
      return isEnabled(count - 1) ? count - 1 : step(count - 1, -1);
    default:
      return null;
  }
}
