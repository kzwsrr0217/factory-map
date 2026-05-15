/**
 * ConfirmDialog.tsx — Two-button confirmation modal built on top of Modal.
 *
 * Used before all destructive operations (delete building, remove connection,
 * deactivate user, etc.). Renders the confirm button with the specified
 * `variant` (defaults to 'danger') and disables both buttons while `loading`.
 *
 * Props match what every call-site needs: title, message, custom button labels,
 * variant override, and a loading flag to show a spinner on the confirm button.
 */
import React from 'react';
import Modal from './Modal';
import Button from './Button';
import styles from '../../styles/components/ConfirmDialog.module.css';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'primary' | 'secondary' | 'success' | 'outline';
  loading?: boolean;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  loading = false,
}) => {
  const footer = (
    <>
      <Button variant="outline" onClick={onClose} disabled={loading}>
        {cancelText}
      </Button>
      <Button variant={variant} onClick={onConfirm} loading={loading}>
        {confirmText}
      </Button>
    </>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} width="sm" footer={footer}>
      <div className={styles.message}>
        <p>{message}</p>
      </div>
    </Modal>
  );
};

export default ConfirmDialog;