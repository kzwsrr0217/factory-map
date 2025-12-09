import mongoose, { Schema, Document } from 'mongoose';

export interface IFloor extends Document {
  building_id: mongoose.Types.ObjectId;
  floor_number: number;
  name: string;
  map_file?: string;
  svg_background?: string; // ← ÚJ: Base64 vagy URL
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
    svg_background: {
      type: String, // Base64 encoded SVG or image URL
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

FloorSchema.index({ building_id: 1, floor_number: 1 }, { unique: true });

export default mongoose.model<IFloor>('Floor', FloorSchema);