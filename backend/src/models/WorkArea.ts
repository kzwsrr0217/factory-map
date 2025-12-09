import mongoose, { Schema, Document } from 'mongoose';

export interface IWorkArea extends Document {
  floor_id: mongoose.Types.ObjectId;
  name: string;
  type?: string;
  coordinates?: {
    x: number;
    y: number;
  };
  dimensions?: {
    width: number;
    height: number;
  };
  metadata?: {
    supervisor?: string;
    capacity?: number;
    [key: string]: any;
  };
  created_at: Date;
  updated_at: Date;
}

const WorkAreaSchema: Schema = new Schema(
  {
    floor_id: {
      type: Schema.Types.ObjectId,
      ref: 'Floor',
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    type: {
      type: String,
    },
    coordinates: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
    },
    dimensions: {
      width: { type: Number, default: 150 },
      height: { type: Number, default: 100 },
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

export default mongoose.model<IWorkArea>('WorkArea', WorkAreaSchema);