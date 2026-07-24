import { useCallback, useRef, useState } from 'react';

export interface UndoableAction {
  undo: () => void;
  redo: () => void;
}

/**
 * Generic undo/redo command stack for map-edit actions (see MapView.tsx /
 * FloorDetails.tsx move/resize handlers). Callers push an action with both
 * directions already bound to concrete before/after values — this hook only
 * manages the two stacks, it has no idea what a "move" or "resize" is.
 *
 * `push` clears the redo stack, matching standard undo/redo semantics: once
 * you make a new edit after undoing, the old redo branch is gone.
 */
export function useUndoRedo() {
  const undoStack = useRef<UndoableAction[]>([]);
  const redoStack = useRef<UndoableAction[]>([]);
  // Stacks live in refs (so push doesn't force a render on every drag frame);
  // this counter is bumped only when the stacks actually change, to drive
  // canUndo/canRedo in the UI (e.g. disabling the toolbar buttons).
  const [version, setVersion] = useState(0);

  const push = useCallback((action: UndoableAction) => {
    undoStack.current.push(action);
    redoStack.current = [];
    setVersion((v) => v + 1);
  }, []);

  const undo = useCallback(() => {
    const action = undoStack.current.pop();
    if (!action) return;
    action.undo();
    redoStack.current.push(action);
    setVersion((v) => v + 1);
  }, []);

  const redo = useCallback(() => {
    const action = redoStack.current.pop();
    if (!action) return;
    action.redo();
    undoStack.current.push(action);
    setVersion((v) => v + 1);
  }, []);

  const clear = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    setVersion((v) => v + 1);
  }, []);

  return {
    push,
    undo,
    redo,
    clear,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    // Referenced so the eslint exhaustive-deps rule doesn't flag `version` as
    // unused — it exists purely to trigger the re-render above.
    _version: version,
  };
}
