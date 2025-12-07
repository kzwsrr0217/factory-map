import mongoose, { Schema, Document } from 'mongoose';
import { ISection } from '../types/hierarchy.types';

export interface ISectionDocument extends Omit<ISection, '_id'>, Document {} 

const SectionSchema: Schema = new Schema(
  {
    workarea_id: {
      type: Schema.Types.ObjectId,
      ref: 'WorkArea',
      required: [true, 'Work area ID is required'],
    },
    name: {
      type: String,
      required: [true, 'Section name is required'],
      trim: true,
      maxlength: [200, 'Section name cannot exceed 200 characters'],
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
    capacity: {
      type: Number,
      min: [0, 'Capacity cannot be negative'],
    },
    shift_schedule: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'sections',
  }
);

// Indexes
SectionSchema.index({ workarea_id: 1 });

export default mongoose.model<ISectionDocument>('Section', SectionSchema);