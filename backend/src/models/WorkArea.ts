import mongoose, { Schema, Document } from 'mongoose';
import { IWorkArea } from '../types/hierarchy.types';

export interface IWorkAreaDocument extends IWorkArea, Document {}

const WorkAreaSchema: Schema = new Schema(
  {
    floor_id: {
      type: Schema.Types.ObjectId,
      ref: 'Floor',
      required: [true, 'Floor ID is required'],
    },
    name: {
      type: String,
      required: [true, 'Work area name is required'],
      trim: true,
      maxlength: [200, 'Work area name cannot exceed 200 characters'],
    },
    type: {
      type: String,
      required: [true, 'Work area type is required'],
      trim: true,
    },
    svg_zone_id: {
      type: String,
      trim: true,
    },
    polygon_coordinates: [
      {
        x: Number,
        y: Number,
      },
    ],
    color: {
      type: String,
      trim: true,
    },
    manager: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'workareas',
  }
);

// Indexes
WorkAreaSchema.index({ floor_id: 1 });
WorkAreaSchema.index({ name: 1 });

export default mongoose.model<IWorkAreaDocument>('WorkArea', WorkAreaSchema);