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