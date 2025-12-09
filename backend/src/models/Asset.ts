import mongoose, { Schema, Document } from 'mongoose';
import { IAsset } from '../types/asset.types';

export interface IAssetDocument extends Omit<IAsset, '_id'>, Document {}  

const AssetSchema: Schema = new Schema(
  {
    hierarchy: {
      building_id: {
        type: Schema.Types.ObjectId,
        ref: 'Building',
        required: [true, 'Building ID is required'],
      },
      floor_id: {
        type: Schema.Types.ObjectId,
        ref: 'Floor',
        required: [true, 'Floor ID is required'],
      },
      workarea_id: {
        type: Schema.Types.ObjectId,
        ref: 'WorkArea',
        required: [true, 'Work area ID is required'],
      },
      section_id: {
        type: Schema.Types.ObjectId,
        ref: 'Section',
        required: [true, 'Section ID is required'],
      },
      workstation_id: {
        type: Schema.Types.ObjectId,
        ref: 'Workstation',
        required: [true, 'Workstation ID is required'],
      },
    },

    itsm: {
      hardware_id: {
        type: String,
        default: null,
      },
      is_managed: {
        type: Boolean,
        default: false,
      },
      last_synced: {
        type: Date,
        default: null,
      },
      sync_status: {
        type: String,
        enum: ['success', 'failed', 'never'],
        default: 'never',
      },
      sync_errors: [
        {
          timestamp: Date,
          error: String,
        },
      ],
    },

    basic_info: {
      display_name: {
        type: String,
        required: [true, 'Display name is required'],
        trim: true,
      },
      asset_tag: String,
      serial_number: String,
      model: String,
      manufacturer: String,
      status: String,
      os_type: String,
      os_version: String,
      mac_address: String,
    },

    technical_specs: {
      cpu: String,
      ram: String,
      storage: String,
      gpu: String,
      other_specs: Schema.Types.Mixed,
    },

    network: {
      ip_address: String,
      hostname: String,
      vlan: String,
      switch_port: String,
    },

    assigned_person: {
      person_id: String,
      full_name: String,
    },

    software: [
      {
        software_id: String,
        display_name: String,
        vendor: String,
        version: String,
        source: {
          type: String,
          enum: ['itsm', 'manual'],
          required: true,
        },
      },
    ],

    connected_hardware: [
      {
        hardware_id: String,
        display_name: String,
        model: String,
        source: {
          type: String,
          enum: ['itsm', 'manual'],
          required: true,
        },
      },
    ],

    tickets: [
      {
        ticket_id: String,
        itsm_url: String,
      },
    ],

location: {
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
  },
  icon_type: {
    type: String,
    default: 'computer',  // ← ÚJ: default érték
  },
  description: String,
  history: [
    {
      moved_at: Date,
      from_coordinates: {
        x: Number,
        y: Number,
      },
      to_coordinates: {
        x: Number,
        y: Number,
      },
      moved_by: String,
      reason: String,
    },
  ],
},

    custom_fields: {
      physical_condition: {
        type: String,
        enum: ['Good', 'Fair', 'Poor'],
      },
      environment: String,
      notes: String,
      tags: [String],
    },

    created_by: String,
    updated_by: String,
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'assets',
  }
);

// Indexes
AssetSchema.index({ 'hierarchy.building_id': 1 });
AssetSchema.index({ 'hierarchy.floor_id': 1 });
AssetSchema.index({ 'hierarchy.workarea_id': 1 });
AssetSchema.index({ 'hierarchy.workstation_id': 1 });
AssetSchema.index({ 'itsm.hardware_id': 1 });
AssetSchema.index({ 'basic_info.display_name': 1 });
AssetSchema.index({ 'basic_info.serial_number': 1 });
AssetSchema.index({ 'assigned_person.person_id': 1 });

export default mongoose.model<IAssetDocument>('Asset', AssetSchema);