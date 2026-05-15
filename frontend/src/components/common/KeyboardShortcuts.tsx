import React from 'react';
import Modal from './Modal';
import styles from '../../styles/components/KeyboardShortcuts.module.css';

interface Shortcut { keys: string[]; description: string; }
interface Section   { category: string; shortcuts: Shortcut[]; }

const SHORTCUTS: Section[] = [
  {
    category: 'General',
    shortcuts: [
      { keys: ['?'],          description: 'Show keyboard shortcuts' },
      { keys: ['Esc'],        description: 'Close modal / dismiss panel' },
    ],
  },
  {
    category: 'Assets',
    shortcuts: [
      { keys: ['Ctrl', 'N'], description: 'Create new asset' },
    ],
  },
  {
    category: 'Navigation',
    shortcuts: [
      { keys: ['Alt', '←'],  description: 'Go back' },
      { keys: ['Alt', '→'],  description: 'Go forward' },
    ],
  },
];

interface KeyboardShortcutsProps {
  isOpen: boolean;
  onClose: () => void;
}

const KeyboardShortcuts: React.FC<KeyboardShortcutsProps> = ({ isOpen, onClose }) => (
  <Modal isOpen={isOpen} onClose={onClose} title="Keyboard Shortcuts" width="sm">
    <div className={styles.container}>
      {SHORTCUTS.map((section) => (
        <div key={section.category} className={styles.section}>
          <h4 className={styles.category}>{section.category}</h4>
          {section.shortcuts.map((s) => (
            <div key={s.description} className={styles.row}>
              <div className={styles.keys}>
                {s.keys.map((k, i) => (
                  <React.Fragment key={k}>
                    {i > 0 && <span className={styles.plus}>+</span>}
                    <kbd className={styles.key}>{k}</kbd>
                  </React.Fragment>
                ))}
              </div>
              <span className={styles.desc}>{s.description}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  </Modal>
);

export default KeyboardShortcuts;
