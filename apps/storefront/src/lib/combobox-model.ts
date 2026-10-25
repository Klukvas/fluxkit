/**
 * The keyboard and open/close behaviour of the delivery step's comboboxes, as a pure reducer (WAI-ARIA Authoring Practices,
 * combobox with a listbox popup, editable, list autocomplete without inline completion). The component only maps DOM events
 * to these actions and applies the result, so every rule is tested without a browser (and again in the e2e suite).
 *
 * - ArrowDown opens the list on the first option (or moves down, wrapping from the last to the first).
 * - ArrowUp opens the list on the last option (or moves up, wrapping from the first to the last).
 * - Enter accepts the highlighted option and closes. With the list open and nothing highlighted Enter does NOT submit the
 *   form (the shopper is choosing); with the list closed it is left alone.
 * - Escape closes the list; it is left alone when the list is closed.
 * - Tab closes the list and moves on as usual: nothing traps the focus.
 * - Home and End stay with the text box (they move the caret).
 * - Typing opens the list with nothing highlighted; losing the focus closes it.
 */

export interface ComboboxState {
  open: boolean;
  /** Index of the highlighted option (`aria-activedescendant`), -1 for none. */
  activeIndex: number;
}

export const closedCombobox: ComboboxState = { open: false, activeIndex: -1 };

export type ComboboxAction =
  | { type: "key"; key: string; count: number }
  | { type: "typed" }
  | { type: "open" }
  | { type: "close" }
  | { type: "highlight"; index: number }
  /** The option list changed (a new answer): the highlight would point at another option. */
  | { type: "optionsChanged" };

export interface KeyOutcome {
  state: ComboboxState;
  /** Index of the option to accept, or `null`. */
  select: number | null;
  /** Whether the event's default action (caret move, form submit, scroll) must be cancelled. */
  preventDefault: boolean;
}

/** One key press on the text box. `count` is the number of options in the list right now. */
export function comboboxKey(state: ComboboxState, key: string, count: number): KeyOutcome {
  const unchanged: KeyOutcome = { state, select: null, preventDefault: false };
  switch (key) {
    case "ArrowDown": {
      if (!state.open) {
        return {
          state: { open: true, activeIndex: count > 0 ? 0 : -1 },
          select: null,
          preventDefault: true,
        };
      }
      if (count === 0) return { ...unchanged, preventDefault: true };
      return {
        state: { open: true, activeIndex: (state.activeIndex + 1) % count },
        select: null,
        preventDefault: true,
      };
    }
    case "ArrowUp": {
      if (!state.open) {
        return {
          state: { open: true, activeIndex: count > 0 ? count - 1 : -1 },
          select: null,
          preventDefault: true,
        };
      }
      if (count === 0) return { ...unchanged, preventDefault: true };
      return {
        state: {
          open: true,
          activeIndex: state.activeIndex <= 0 ? count - 1 : state.activeIndex - 1,
        },
        select: null,
        preventDefault: true,
      };
    }
    case "Enter": {
      if (!state.open) return unchanged;
      if (state.activeIndex >= 0 && state.activeIndex < count) {
        return { state: closedCombobox, select: state.activeIndex, preventDefault: true };
      }
      return { ...unchanged, preventDefault: true };
    }
    case "Escape":
      return state.open ? { state: closedCombobox, select: null, preventDefault: true } : unchanged;
    case "Tab":
      return state.open
        ? { state: closedCombobox, select: null, preventDefault: false }
        : unchanged;
    default:
      return unchanged;
  }
}

export function comboboxReducer(state: ComboboxState, action: ComboboxAction): ComboboxState {
  switch (action.type) {
    case "key":
      return comboboxKey(state, action.key, action.count).state;
    case "typed":
    case "open":
      return state.open && state.activeIndex === -1 ? state : { open: true, activeIndex: -1 };
    case "close":
      return state.open || state.activeIndex !== -1 ? closedCombobox : state;
    case "highlight":
      return state.activeIndex === action.index ? state : { ...state, activeIndex: action.index };
    case "optionsChanged":
      return state.activeIndex === -1 ? state : { ...state, activeIndex: -1 };
  }
}

/** `id` of option `index` of the list `listId`, used by `aria-activedescendant` and the option elements. */
export function optionId(listId: string, index: number): string {
  return `${listId}-option-${String(index)}`;
}
