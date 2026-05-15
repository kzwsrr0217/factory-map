/**
 * KeyboardShortcutsModal.tsx — Press ? anywhere to open this reference sheet.
 */
import React from 'react';
import Modal from './Modal';
import styles from '../../styles/components/KeyboardShortcutsModal.module.css';

interface ShortcutGroup {
  heading: string;
  items: { keys: string[]; desc: string }[];
}

const GROUPS: ShortcutGroup[] = [
  {
    heading: 'Global',
    items: [
      { keys: ['Ctrl', 'K'], desc: 'Open search' },
      { keys: ['Ctrl', 'N'], desc: 'New asset (from Dashboard)' },
      { keys: ['?'], desc: 'Show this help' },
      { keys: ['Esc'], desc: 'Close modal / clear selection' },
    ],
  },
  {
    heading: 'Dashboard',
    items: [
      { keys: ['Ctrl', 'N'], desc: 'Create new asset' },
      { keys: ['Ctrl', 'E'], desc: 'Export CSV' },
    ],
  },
  {
    heading: 'Floor Map',
    items: [
      { keys: ['E'], desc: 'Toggle edit mode' },
      { keys: ['W'], desc: 'Toggle wire (connection) mode' },
      { keys: ['Esc'], desc: 'Exit wire / placing mode' },
      { keys: ['Scroll'], desc: 'Zoom in / out' },
      { keys: ['Shift', 'Drag'], desc: 'Pan the canvas' },
    ],
  },
];

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({ isOpen, onClose }) => (
  <Modal isOpen={isOpen} onClose={onClose} title="Keyboard shortcuts" width="sm">
    <div className={styles.groups}>
      {GROUPS.map(group => (
        <div key={group.heading} className={styles.group}>
          <h4 className={styles.heading}>{group.heading}</h4>
          {group.items.map(({ keys, desc }) => (
            <div key={desc} className={styles.row}>
              <span className={styles.desc}>{desc}</span>
              <span className={styles.keys}>
                {keys.map((k, i) => (
                  <React.Fragment key={k}>
                    {i > 0 && <span className={styles.plus}>+</span>}
                    <kbd className={styles.kbd}>{k}</kbd>
                  </React.Fragment>
                ))}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  </Modal>
);

export default KeyboardShortcutsModal;
