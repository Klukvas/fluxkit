/**
 * Paging model of a picker (attribute, option, category lists): a server list read 100 at a time, with a "load more"
 * button. The picker never filters a loaded page in the browser (a page is not the list): what is shown is what the server
 * returned, and asking for more is the only way to see further. Pure, tested first.
 */

/** The API's maximum page size (`limit`). */
export const PICKER_PAGE_SIZE = 100;
/** The API's maximum `offset`: no further page can be asked for (`docs/api/catalog.md`, Lists and pagination). */
export const PICKER_MAX_OFFSET = 10_000;

export interface PickerState<T> {
  status: "loading" | "ready" | "error";
  items: T[];
  total: number;
  loadingMore: boolean;
  /** The last request for more failed; the loaded items stay. */
  moreFailed: boolean;
}

export const initialPickerState: PickerState<never> = {
  status: "loading",
  items: [],
  total: 0,
  loadingMore: false,
  moreFailed: false,
};

export type PickerAction<T> =
  | { type: "loaded"; items: T[]; total: number }
  | { type: "failed" }
  | { type: "moreRequested" }
  | { type: "moreLoaded"; items: T[]; total: number }
  | { type: "moreFailed" }
  | { type: "reset" };

export function pickerReducer<T>(
  state: PickerState<T>,
  action: PickerAction<T>,
  keyOf: (item: T) => string,
): PickerState<T> {
  switch (action.type) {
    case "loaded":
      return {
        status: "ready",
        items: action.items,
        total: action.total,
        loadingMore: false,
        moreFailed: false,
      };
    case "failed":
      return { ...initialPickerState, status: "error" };
    case "moreRequested":
      return { ...state, loadingMore: true, moreFailed: false };
    case "moreLoaded": {
      const known = new Set(state.items.map(keyOf));
      const added = action.items.filter((item) => !known.has(keyOf(item)));
      return {
        ...state,
        items: [...state.items, ...added],
        total: action.total,
        loadingMore: false,
        moreFailed: false,
      };
    }
    case "moreFailed":
      return { ...state, loadingMore: false, moreFailed: true };
    case "reset":
      return initialPickerState;
  }
}

/** The `offset` of the next page. */
export function nextOffset(state: PickerState<unknown>): number {
  return state.items.length;
}

/** Whether a button for the next page is useful: the server has more, and the API still accepts that offset. */
export function canLoadMore(state: PickerState<unknown>): boolean {
  return (
    state.status === "ready" &&
    !state.loadingMore &&
    state.items.length < state.total &&
    state.items.length <= PICKER_MAX_OFFSET
  );
}
