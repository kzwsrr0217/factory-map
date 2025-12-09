import React, { useState, useRef } from 'react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import { floorService } from '../../services/floor.service';
import styles from '../../styles/components/FloorPlanUploadModal.module.css';

interface FloorPlanUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  floorId: string;
}

const FloorPlanUploadModal: React.FC<FloorPlanUploadModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  floorId,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    console.log('Selected file:', {
      name: selectedFile.name,
      type: selectedFile.type,
      size: selectedFile.size,
    });

    // Validate file type
    const validTypes = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/jpg'];
    if (!validTypes.includes(selectedFile.type)) {
      setError('Please select a valid image file (SVG, PNG, JPG)');
      return;
    }

    // Validate file size (max 5MB)
    if (selectedFile.size > 5 * 1024 * 1024) {
      setError('File size must be less than 5MB');
      return;
    }

    setError('');
    setFile(selectedFile);

    // Create preview
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      console.log('Preview data (first 200 chars):', result.substring(0, 200));
      setPreview(result);
    };
    reader.readAsDataURL(selectedFile);
  };

  const handleUpload = async () => {
    if (!file || !preview) return;

    setUploading(true);
    try {
      console.log('Uploading floor plan...');
      // Upload as base64
      await floorService.updateFloor(floorId, {
        svg_background: preview,
      });

      console.log('Upload successful!');
      onSuccess();
      onClose();
      resetForm();
    } catch (error) {
      console.error('Error uploading floor plan:', error);
      setError('Failed to upload floor plan. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    if (!window.confirm('Are you sure you want to remove the floor plan?')) {
      return;
    }

    setUploading(true);
    try {
      await floorService.updateFloor(floorId, {
        svg_background: undefined,
      });

      onSuccess();
      onClose();
      resetForm();
    } catch (error) {
      console.error('Error removing floor plan:', error);
      setError('Failed to remove floor plan. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const resetForm = () => {
    setFile(null);
    setPreview(null);
    setError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const footer = (
    <>
      <Button variant="outline" onClick={handleClose} disabled={uploading}>
        Cancel
      </Button>
      {preview && (
        <Button variant="danger" onClick={handleRemove} disabled={uploading}>
          Remove Current
        </Button>
      )}
      <Button
        variant="primary"
        onClick={handleUpload}
        disabled={!file}
        loading={uploading}
      >
        Upload
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Upload Floor Plan"
      width="lg"
      footer={footer}
    >
      <div className={styles.uploadContainer}>
        {/* Instructions */}
        <div className={styles.instructions}>
          <h4>📋 Instructions</h4>
          <ul>
            <li>Supported formats: SVG, PNG, JPG</li>
            <li>Maximum file size: 5MB</li>
            <li>The image will be displayed as a background on the floor map</li>
            <li>You can position work areas and assets on top of the floor plan</li>
          </ul>
        </div>

        {/* File Input */}
        <div className={styles.fileInputContainer}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg"
            onChange={handleFileSelect}
            className={styles.fileInput}
            id="floor-plan-upload"
          />
          <label htmlFor="floor-plan-upload" className={styles.fileInputLabel}>
            <div className={styles.uploadIcon}>📤</div>
            <p className={styles.uploadText}>
              {file ? file.name : 'Click to select floor plan image'}
            </p>
            <p className={styles.uploadHint}>SVG, PNG, or JPG (max 5MB)</p>
          </label>
        </div>

        {/* Error Message */}
        {error && (
          <div className={styles.error}>
            <span>⚠️ {error}</span>
          </div>
        )}

        {/* Preview */}
        {preview && (
          <div className={styles.previewContainer}>
            <h4>Preview:</h4>
            <div className={styles.preview}>
              <img src={preview} alt="Floor plan preview" />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default FloorPlanUploadModal;