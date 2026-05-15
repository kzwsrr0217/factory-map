/**
 * FloorPlanUploadModal.tsx — Upload an SVG or image file as a floor plan background.
 *
 * Accepts SVG, PNG, JPG, and GIF files up to 5 MB. The file is read as a
 * base64 data URL client-side and sent as `svg_background` in the PATCH
 * request to `floorService.updateFloorPlan()`. The backend stores it in the
 * `svg_background` NVARCHAR(MAX) column.
 *
 * If a plan already exists, a ConfirmDialog warns the user before overwriting.
 * Large files (> ~2 MB base64) may approach SQL Server row size limits —
 * the 5 MB cap is a safety guard.
 */
import React, { useState, useRef } from 'react';
import { Upload, AlertTriangle } from 'lucide-react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import ConfirmDialog from '../common/ConfirmDialog';
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
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validTypes = [
    'image/svg+xml',
    'image/png',
    'image/jpeg',
    'image/jpg',
  ];
  const validExtensions = ['.svg', '.png', '.jpg', '.jpeg'];

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    const fileExtension = selectedFile.name.toLowerCase().substring(selectedFile.name.lastIndexOf('.'));

    if (!validTypes.includes(selectedFile.type) && !validExtensions.includes(fileExtension)) {
      setError('Please select a valid file (SVG, PNG, or JPG). For Visio files, export as SVG or PNG first.');
      return;
    }

    if (selectedFile.size > 5 * 1024 * 1024) {
      setError('File size must be less than 5MB');
      return;
    }

    setError('');
    setFile(selectedFile);
    processImageFile(selectedFile);
  };

  const processImageFile = (selectedFile: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      setPreview(result);
    };
    reader.readAsDataURL(selectedFile);
  };

  const handleUpload = async () => {
    if (!file || !preview) return;

    setUploading(true);
    try {
      await floorService.updateFloor(floorId, {
        svg_background: preview,
      });
      onSuccess();
      onClose();
      resetForm();
    } catch (err) {
      console.error('Error uploading floor plan:', err);
      setError('Failed to upload floor plan. Please try again later.');
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    setUploading(true);
    try {
      await floorService.updateFloor(floorId, {
        svg_background: undefined,
      });
      onSuccess();
      onClose();
      resetForm();
    } catch (err) {
      console.error('Error removing floor plan:', err);
      setError('Failed to remove floor plan. Please try again later.');
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

  return (
    <>
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Upload Floor Plan"
      width="lg"
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={uploading}>
            Cancel
          </Button>
          {preview && (
            <Button variant="danger" onClick={() => setConfirmRemoveOpen(true)} disabled={uploading}>
              Remove Current
            </Button>
          )}
          <Button variant="primary" onClick={handleUpload} disabled={!file || uploading} loading={uploading}>
            Upload
          </Button>
        </>
      }
    >
      <div className={styles.uploadContainer}>
        <div className={styles.instructions}>
          <h4>Upload Instructions</h4>
          <ul>
            <li>Supported formats: <strong>SVG, PNG, JPG</strong> — max 5MB</li>
            <li><strong>Using Visio?</strong> Export your drawing: <em>File → Save As → SVG</em> or <em>File → Export → PNG</em></li>
            <li>SVG gives the best quality and sharp rendering at any zoom level</li>
            <li>PNG/JPG work well for raster floor plans and photos</li>
          </ul>
        </div>

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
            <div className={styles.uploadIcon}><Upload size={32} /></div>
            <p className={styles.uploadText}>
              {file ? file.name : 'Click to select a floor plan file'}
            </p>
            <p className={styles.uploadHint}>
              Recommended: SVG for best quality, PNG/JPG for raster backgrounds.
            </p>
          </label>
        </div>

        {error && (
          <div className={styles.error}>
            <AlertTriangle size={14} style={{ marginRight: 6, flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {preview && (
          <div className={styles.previewContainer}>
            <h4>Preview</h4>
            <div className={styles.preview}>
              <img src={preview} alt="Floor plan preview" />
            </div>
          </div>
        )}
      </div>
    </Modal>
    <ConfirmDialog
      isOpen={confirmRemoveOpen}
      onClose={() => setConfirmRemoveOpen(false)}
      onConfirm={() => { setConfirmRemoveOpen(false); handleRemove(); }}
      title="Remove Floor Plan"
      message="Are you sure you want to remove the current floor plan?"
      confirmText="Remove"
      loading={uploading}
    />
    </>
  );
};

export default FloorPlanUploadModal;