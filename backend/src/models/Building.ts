import mongoose, { Schema, Document } from 'mongoose';
import { IBuilding } from '../types/hierarchy.types';

export interface IBuildingDocument extends Omit<IBuilding, '_id'>, Document {}  

const BuildingSchema: Schema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Building name is required'],
      trim: true,
      maxlength: [200, 'Building name cannot exceed 200 characters'],
    },
    address: {
      type: String,
      trim: true,
      maxlength: [500, 'Address cannot exceed 500 characters'],
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'buildings',
  }
);

// Indexes
BuildingSchema.index({ name: 1 });

export default mongoose.model<IBuildingDocument>('Building', BuildingSchema);