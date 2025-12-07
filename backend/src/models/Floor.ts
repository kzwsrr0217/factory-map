import mongoose, { Schema, Document } from 'mongoose';
import { IFloor } from '../types/hierarchy.types';

export interface IFloorDocument extends Omit<IFloor, '_id'>, Document {}  

const FloorSchema: Schema = new Schema(
  {
    building_id: {
      type: Schema.Types.ObjectId,
      ref: 'Building',
      required: [true, 'Building ID is required'],
    },
    floor_number: {
      type: Number,
      required: [true, 'Floor number is required'],
    },
    name: {
      type: String,
      required: [true, 'Floor name is required'],
      trim: true,
      maxlength: [200, 'Floor name cannot exceed 200 characters'],
    },
    map_file: {
      type: String,
      trim: true,
    },
    map_metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'floors',
  }
);

// Indexes
FloorSchema.index({ building_id: 1, floor_number: 1 });

export default mongoose.model<IFloorDocument>('Floor', FloorSchema);