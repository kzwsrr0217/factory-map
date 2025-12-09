import mongoose, { Schema, Document } from 'mongoose';

export interface IFloor extends Document {
  building_id: mongoose.Types.ObjectId;
  floor_number: number;
  name: string;
  map_file?: string;
  metadata?: {
    area?: number;
    ceiling_height?: number;
    [key: string]: any;
  };
  created_at: Date;
  updated_at: Date;
}

const FloorSchema: Schema = new Schema(
  {
    building_id: {
      type: Schema.Types.ObjectId,
      ref: 'Building',
      required: true,
    },
    floor_number: {
      type: Number,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    map_file: {
      type: String,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// ← ÚJ: Compound unique index
// Egy building-ben csak egy floor lehet adott floor_number-rel
FloorSchema.index({ building_id: 1, floor_number: 1 }, { unique: true });

export default mongoose.model<IFloor>('Floor', FloorSchema);