import mongoose, { Schema, Document } from 'mongoose';
import { IWorkstation } from '../types/hierarchy.types';

export interface IWorkstationDocument extends IWorkstation, Document {}

const WorkstationSchema: Schema = new Schema(
  {
    section_id: {
      type: Schema.Types.ObjectId,
      ref: 'Section',
      required: [true, 'Section ID is required'],
    },
    name: {
      type: String,
      required: [true, 'Workstation name is required'],
      trim: true,
      maxlength: [200, 'Workstation name cannot exceed 200 characters'],
    },
    coordinates: {
      x: {
        type: Number,
        required: [true, 'X coordinate is required'],
      },
      y: {
        type: Number,
        required: [true, 'Y coordinate is required'],
      },
    },
    rotation: {
      type: Number,
      default: 0,
      min: [0, 'Rotation cannot be less than 0'],
      max: [360, 'Rotation cannot exceed 360'],
    },
    type: {
      type: String,
      required: [true, 'Workstation type is required'],
      trim: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'maintenance'],
      default: 'active',
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'workstations',
  }
);

// Indexes
WorkstationSchema.index({ section_id: 1 });
WorkstationSchema.index({ status: 1 });

export default mongoose.model<IWorkstationDocument>('Workstation', WorkstationSchema);